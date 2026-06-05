import type {
  Screen,
  ScreenId,
  ScreenKind,
  Timestamp,
  Uuid,
} from "../types/v3";
import { generateUUID } from "../utils/uuid";
import { loadProject, loadRawProject } from "./flowStore";
import { resolveEditorKind } from "../utils/resolveEditorKind";
import { resolveCssFramework } from "../utils/resolveCssFramework";
import { validatePuckScreen } from "../utils/puckScreenValidation";
import type { PuckScreenValidationError } from "../utils/puckScreenValidation";
import {
  validateScreenRefs,
  type ScreenGenericDefinitionNames,
} from "../utils/screenRefValidation";

export interface ScreenStorageBackend {
  loadScreenEntity(screenId: string): Promise<unknown>;
  saveScreenEntity(screenId: string, data: unknown): Promise<void>;
}

let _backend: ScreenStorageBackend | null = null;

export function setScreenStorageBackend(b: ScreenStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): ScreenStorageBackend {
  if (!_backend) {
    throw new Error("screenStore: backend が初期化されていません (wsBridge 未接続)");
  }
  return _backend;
}

const SCREEN_SCHEMA_REF = "../schemas/v3/screen.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function buildDefaultScreen(screenId: string): Promise<Screen> {
  const ts = nowTs();
  const [project, raw] = await Promise.all([loadProject(), loadRawProject()]);
  const meta = project.screens.find((s) => s.id === screenId);
  // editorKind / cssFramework を project.techStack.designer から解決し、project default 値を内包した
  // Screen entity を返す。呼び出し側 (handleScreenSave / mcpBridge) が画面固有値で上書きする前提。
  // saveScreenEntity (本ファイル下方) で designFileRef / puckDataRef の排他性を最終保証する。
  // 仕様書 multi-editor-puck.md § 2.5: "designFileRef と puckDataRef はどちらか一方のみ"
  const editorKind = resolveEditorKind(undefined, raw.techStack);
  const cssFramework = resolveCssFramework(undefined, raw.techStack);
  const isPuck = editorKind === "puck";
  return {
    $schema: SCREEN_SCHEMA_REF,
    id: screenId as ScreenId,
    // RFC #1284 / Round 6 Phase B: uuid は不変識別子 (UUID v4)、創成時に発番。
    // loadScreenEntity の spread merge で raw.uuid があれば優先される (保存済 entity 保護)。
    uuid: generateUUID() as Uuid,
    name: meta?.name ?? screenId,
    createdAt: (meta?.createdAt ?? meta?.updatedAt ?? ts) as Timestamp,
    updatedAt: (meta?.updatedAt ?? ts) as Timestamp,
    kind: (meta?.kind ?? "other") as ScreenKind,
    path: meta?.path ?? "",
    groupId: meta?.groupId,
    items: [],
    design: isPuck
      ? { editorKind, cssFramework, puckDataRef: "puck-data.json" }
      : { editorKind, cssFramework, designFileRef: `${screenId}.design.json` },
  };
}

export async function loadScreenEntity(screenId: string): Promise<Screen> {
  const raw = await requireBackend().loadScreenEntity(screenId);
  if (isRecord(raw)) {
    const defaultScreen = await buildDefaultScreen(screenId);
    // 保存済みの design を優先。ただし designFileRef を Puck 画面に混入させない (Sh-4)。
    // 仕様書 multi-editor-puck.md § 2.5: "designFileRef と puckDataRef はどちらか一方のみ"
    const rawDesign = isRecord(raw.design) ? raw.design : {};
    const resolvedEditorKind = typeof rawDesign.editorKind === "string"
      ? rawDesign.editorKind
      : defaultScreen.design?.editorKind;
    const isPuck = resolvedEditorKind === "puck";
    const mergedDesign = { ...rawDesign };
    if (isPuck) {
      // Puck 画面: designFileRef を削除し、puckDataRef を補完
      delete mergedDesign.designFileRef;
      if (!mergedDesign.puckDataRef) mergedDesign.puckDataRef = "puck-data.json";
    } else {
      // GrapesJS 画面: puckDataRef を削除し、designFileRef を補完
      delete mergedDesign.puckDataRef;
      if (!mergedDesign.designFileRef) mergedDesign.designFileRef = `${screenId}.design.json`;
    }
    return {
      ...defaultScreen,
      ...(raw as Partial<Screen>),
      $schema: SCREEN_SCHEMA_REF,
      id: (typeof raw.id === "string" ? raw.id : screenId) as ScreenId,
      kind: (typeof raw.kind === "string" ? raw.kind : "other") as ScreenKind,
      path: typeof raw.path === "string" ? raw.path : "",
      items: Array.isArray(raw.items) ? raw.items as Screen["items"] : [],
      design: mergedDesign as Screen["design"],
    };
  }
  return buildDefaultScreen(screenId);
}

/**
 * 全画面の validation エラーマップを返す (puck 検証 + cross-resource ref 整合性検証)。
 *
 * - **Puck 検証** (`validatePuckScreen`): editorKind=puck の画面のみ
 * - **Cross-resource ref 検証** (`validateScreenRefs`, #1318): editorKind 不問
 *   - dialog/messageArea/options 参照の実在検証
 *   - genericDefinitionNames が未指定の場合は ref 検査は silent pass
 *
 * 関数名は loadPuckScreenValidationMap のままだが、Phase 2 で screen 全体の validation
 * orchestrator に責務拡張済み (loadTableValidationMap / loadViewValidationMap と同階層)。
 */
export async function loadPuckScreenValidationMap(options?: {
  genericDefinitionNames?: ScreenGenericDefinitionNames;
}): Promise<Map<ScreenId, PuckScreenValidationError[]>> {
  const project = await loadProject();
  const validationMap = new Map<ScreenId, PuckScreenValidationError[]>();
  const backend = requireBackend();

  // raw entity データを直接読み、loadScreenEntity の自動補完を回避する。
  // loadScreenEntity は editorKind=puck 画面に puckDataRef を自動補完するため、
  // 「puckDataRef 欠落」エラーが validatePuckScreen で検出されなくなる。
  // raw data を Screen 型として扱い、補完なしで validatePuckScreen に渡す。
  const rawEntities = await Promise.all(
    project.screens.map(async (entry) => {
      const raw = await backend.loadScreenEntity(entry.id);
      if (!isRecord(raw)) return null;
      return {
        ...raw,
        id: (typeof raw.id === "string" ? raw.id : entry.id) as ScreenId,
        design: isRecord(raw.design) ? raw.design : {},
      } as unknown as Screen;
    }),
  );
  const allEntities = rawEntities.filter((entity): entity is Screen => entity !== null);
  const puckEntities = allEntities.filter(
    (entity) => entity.design?.editorKind === "puck",
  );

  // Puck data 検証 (editorKind=puck のみ)
  for (const entity of puckEntities) {
    validationMap.set(
      entity.id as ScreenId,
      validatePuckScreen(entity, puckEntities, /* customComponents */ []),
    );
  }

  // Cross-resource ref 検証 (#1090 Phase 2、editorKind 不問)。
  // ScreenRefIssue は { severity, message, field, code } を持つが、
  // PuckScreenValidationError との互換のため code を捨てて merge する。
  for (const entity of allEntities) {
    const refIssues = validateScreenRefs(entity, options);
    if (refIssues.length === 0) continue;
    const id = entity.id as ScreenId;
    const existing = validationMap.get(id) ?? [];
    const converted: PuckScreenValidationError[] = refIssues.map((iss) => ({
      severity: iss.severity,
      message: iss.message,
      field: iss.field,
    }));
    validationMap.set(id, [...existing, ...converted]);
  }

  return validationMap;
}

export async function saveScreenEntity(screen: Screen): Promise<void> {
  // editorKind に応じて designFileRef / puckDataRef を排他設定する (Sh-4 / multi-editor-puck.md § 2.5)。
  // 旧実装は無条件で `designFileRef: ${id}.design.json` を上書きしていたため、Puck 画面の
  // entity に designFileRef が誤って混入する regression があった (#815 PR #822 Codex 指摘)。
  const baseDesign = (screen.design ?? {}) as Record<string, unknown>;
  const editorKind = typeof baseDesign.editorKind === "string" ? baseDesign.editorKind : undefined;
  const isPuck = editorKind === "puck";
  const cleanedDesign: Record<string, unknown> = { ...baseDesign };
  if (isPuck) {
    delete cleanedDesign.designFileRef;
    if (!cleanedDesign.puckDataRef) cleanedDesign.puckDataRef = "puck-data.json";
  } else {
    delete cleanedDesign.puckDataRef;
    if (!cleanedDesign.designFileRef) cleanedDesign.designFileRef = `${screen.id}.design.json`;
  }
  const toSave: Screen = {
    ...screen,
    $schema: SCREEN_SCHEMA_REF,
    updatedAt: nowTs(),
    design: cleanedDesign as Screen["design"],
  };
  await requireBackend().saveScreenEntity(toSave.id, toSave);
}
