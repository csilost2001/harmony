import type {
  Screen,
  ScreenId,
  ScreenKind,
  Timestamp,
  Uuid,
} from "../types/v3";
import { generateUUID } from "../utils/uuid";
import { validateLayoutWithComponents, type LayoutComponentDef } from "@harmony/shared";
import { loadProject } from "./flowStore";
import { loadLayoutComponents } from "./layoutComponentStore";
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

/** 画面の検証結果 1 件 (画面一覧のバッジ表示用) */
export interface ScreenValidationIssue {
  severity: "error" | "warning";
  message: string;
  field?: string;
}

/**
 * 新しい画面 (空の業務部品レイアウト付き)。画面名の見出しだけを置いた状態から始める。
 * 呼び出し側 (画面一覧の追加 / mcpBridge) が画面固有値で上書きする前提。
 */
export async function buildDefaultScreen(screenId: string): Promise<Screen> {
  const ts = nowTs();
  const project = await loadProject();
  const meta = project.screens.find((s) => s.id === screenId);
  const name = meta?.name ?? screenId;
  return {
    $schema: SCREEN_SCHEMA_REF,
    id: screenId as ScreenId,
    // RFC #1284 / Round 6 Phase B: uuid は不変識別子 (UUID v4)、創成時に発番。
    // loadScreenEntity の spread merge で raw.uuid があれば優先される (保存済 entity 保護)。
    uuid: generateUUID() as Uuid,
    name,
    createdAt: (meta?.createdAt ?? meta?.updatedAt ?? ts) as Timestamp,
    updatedAt: (meta?.updatedAt ?? ts) as Timestamp,
    kind: (meta?.kind ?? "other") as ScreenKind,
    path: meta?.path ?? "",
    groupId: meta?.groupId,
    items: [],
    layout: { version: 1, nodes: [{ id: "pageTitle", type: "heading", props: { text: name, level: 1 } }] },
  };
}

export async function loadScreenEntity(screenId: string): Promise<Screen> {
  const raw = await requireBackend().loadScreenEntity(screenId);
  if (isRecord(raw)) {
    // 保存済みの画面に既定の layout を補ってはならない: layout が無い旧形式の画面は
    // 業務部品デザイナの開始画面 (旧デザインからの自動変換) で扱う。補うのは新規作成時 (buildDefaultScreen) だけ
    const { layout: _defaultLayout, ...defaultScreen } = await buildDefaultScreen(screenId);
    void _defaultLayout;
    return {
      ...defaultScreen,
      ...(raw as Partial<Screen>),
      $schema: SCREEN_SCHEMA_REF,
      id: (typeof raw.id === "string" ? raw.id : screenId) as ScreenId,
      kind: (typeof raw.kind === "string" ? raw.kind : "other") as ScreenKind,
      path: typeof raw.path === "string" ? raw.path : "",
      items: Array.isArray(raw.items) ? raw.items as Screen["items"] : [],
    };
  }
  return buildDefaultScreen(screenId);
}

/**
 * 全画面の検証結果マップを返す (画面一覧のバッジ用)。
 *
 * - 他の設計資源への参照整合 (dialog / messageArea / options の実在、#1318)
 * - 業務部品レイアウトの整合 (存在しない画面項目・独自部品・遷移先、置けない位置など。情報レベルは除く)
 */
export async function loadScreenValidationMap(options?: {
  genericDefinitionNames?: ScreenGenericDefinitionNames;
}): Promise<Map<ScreenId, ScreenValidationIssue[]>> {
  const project = await loadProject();
  const validationMap = new Map<ScreenId, ScreenValidationIssue[]>();
  const backend = requireBackend();
  const defs: LayoutComponentDef[] = await loadLayoutComponents().catch(() => []);
  const screenIds = new Set(project.screens.map((s) => s.id as string));

  // raw entity データを直接読み、loadScreenEntity の補完を介さずに検証する
  const rawEntities = await Promise.all(
    project.screens.map(async (entry) => {
      const raw = await backend.loadScreenEntity(entry.id);
      if (!isRecord(raw)) return null;
      return { ...raw, id: (typeof raw.id === "string" ? raw.id : entry.id) as ScreenId } as unknown as Screen;
    }),
  );
  for (const entity of rawEntities.filter((e): e is Screen => e !== null)) {
    const issues: ScreenValidationIssue[] = validateScreenRefs(entity, options).map((iss) => ({
      severity: iss.severity, message: iss.message, field: iss.field,
    }));
    if (entity.layout) {
      for (const li of validateLayoutWithComponents(entity.layout, (entity.items ?? []) as unknown as Array<{ id: string }>, defs, screenIds)) {
        if (li.severity === "info") continue;
        issues.push({ severity: li.severity, message: li.message, field: li.nodeId ? `layout:${li.nodeId}` : "layout" });
      }
    }
    if (issues.length) validationMap.set(entity.id as ScreenId, issues);
  }
  return validationMap;
}

export async function saveScreenEntity(screen: Screen): Promise<void> {
  const toSave: Screen = { ...screen, $schema: SCREEN_SCHEMA_REF, updatedAt: nowTs() };
  await requireBackend().saveScreenEntity(toSave.id, toSave);
}
