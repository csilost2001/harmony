/**
 * flowStore.ts (v3 Phase 3-β、#561)
 * フロープロジェクトの永続化ストア。
 *
 * 永続化境界 (v3):
 * - 業務情報: data/harmony.json (FlowProject の v1 inline shape は維持、Phase 4 で entities ネスト化)
 * - UI 座標: data/screen-layout.json (Phase 3-β で新設、screenLayoutStore 経由)
 *
 * UI 側は ScreenNode / ScreenEdge / ScreenGroup (types/flow) で合成型を扱う。
 * load 時に両方を merge、save 時に書き分ける。
 *
 * 永続化は wsBridge backend 経由のサーバー側ファイル書き込みに一本化されている (#923 シリーズで
 * localStorage fallback は廃止)。`_backend` 未設定で load/save を呼ぶと throw する。ただし
 * 既存ユーザーの旧 localStorage データを backend 接続時に 1 度きり救済する migration は維持。
 */
import type {
  FlowProject,
  ScreenNode,
  ScreenEdge,
  ScreenGroup,
  ProcessFlowMeta,
} from "../types/flow";
import type {
  ScreenId,
  ScreenGroupId,
  ScreenKind,
  ScreenLayout,
  Position,
  Timestamp,
  ScreenTransitionEntry,
  Project,
  ProjectId,
  LocalId,
  ProcessFlowId,
} from "../types/v3";
import { SCREEN_KIND_LABELS, TRIGGER_LABELS } from "../types/flow";
import { generateUUID } from "../utils/uuid";
import { saveDraft, clearDraft, loadDraft } from "../utils/draftStorage";
import { renumber, nextNo } from "../utils/listOrder";
import {
  loadScreenLayout,
  saveScreenLayout,
  removePosition as layoutRemovePosition,
  removeTransitionLayout as layoutRemoveTransition,
} from "./screenLayoutStore";
import { assertValidProject } from "../utils/validateProject";

// ─── ストレージバックエンド ──────────────────────────────────────────────

export interface FlowStorageBackend {
  loadProject(): Promise<unknown>;
  saveProject(project: unknown): Promise<void>;
  deleteScreenData(screenId: string): Promise<void>;
}

let _backend: FlowStorageBackend | null = null;

export function setFlowStorageBackend(b: FlowStorageBackend | null): void {
  _backend = b;
}

function requireBackend(): FlowStorageBackend {
  if (!_backend) {
    throw new Error("flowStore: backend が初期化されていません (wsBridge 未接続)");
  }
  return _backend;
}

// ─── ドラフトモード ──────────────────────────────────────────────────────

const FLOW_DRAFT_KIND = "flow";
const FLOW_DRAFT_ID = "project";
let _draftMode = false;
const _draftSaveListeners: Set<() => void> = new Set();

export function setFlowDraftMode(enabled: boolean): void {
  _draftMode = enabled;
}
export function isFlowDraftMode(): boolean {
  return _draftMode;
}
export function loadFlowDraft(): FlowProject | null {
  return loadDraft<FlowProject>(FLOW_DRAFT_KIND, FLOW_DRAFT_ID);
}
export function clearFlowDraft(): void {
  clearDraft(FLOW_DRAFT_KIND, FLOW_DRAFT_ID);
}
export function subscribeToFlowDraftSaves(cb: () => void): () => void {
  _draftSaveListeners.add(cb);
  return () => _draftSaveListeners.delete(cb);
}

// ─── localStorage 1 度きり migration キー (#923 シリーズで本体 fallback は廃止) ──

const FLOW_PROJECT_KEY = "v3-project";
const LEGACY_FLOW_PROJECT_KEY = "flow-project";
const SCREEN_DATA_PREFIX = "gjs-screen-";
const LEGACY_KEY = "gjs-designer-project";
const PROJECT_SCHEMA_REF = "../schemas/v3/harmony.v3.schema.json";

export const DEFAULT_NODE_SIZE = { width: 200, height: 100 };

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// ─── 業務情報のみの永続化 shape (harmony.json 用) ──────────────────────
//
// Phase 3-β: 業務情報のみで永続化する。座標 (position/size/thumbnail) は
// screen-layout.json に分離する。Phase 4 で v3 Project (entities ネスト) に
// 完全移行する際に、本 shape は ScreenEntry / ScreenGroupEntry / ScreenTransitionEntry の
// project.entities ネスト構造へ再編する。

interface PersistedScreen {
  id: ScreenId;
  no: number;
  name: string;
  kind: ScreenKind;
  description: string;
  path: string;
  hasDesign: boolean;
  groupId?: ScreenGroupId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface PersistedGroup {
  id: ScreenGroupId;
  name: string;
  color?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface PersistedEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  trigger: ScreenTransitionEntry["trigger"];
}

export interface LegacyFlowProject {
  version: 1;
  name: string;
  screens: PersistedScreen[];
  groups: PersistedGroup[];
  edges: PersistedEdge[];
  tables?: FlowProject["tables"];
  processFlows?: ProcessFlowMeta[];
  sequences?: FlowProject["sequences"];
  views?: FlowProject["views"];
  updatedAt: Timestamp;
}

type PersistedFlowProject = Project;

// ─── 合成・分解 ─────────────────────────────────────────────────────────

function defaultPositionFor(index: number): Position {
  return {
    x: 100 + index * 250,
    y: 150,
    width: DEFAULT_NODE_SIZE.width,
    height: DEFAULT_NODE_SIZE.height,
  };
}

function defaultGroupPosition(): Position {
  return { x: 0, y: 0, width: 360, height: 280 };
}

/** Persisted harmony.json + screen-layout.json を UI 合成型 FlowProject に。 */
export function composeFlowProject(
  persisted: Project,
  layout: ScreenLayout,
): FlowProject {
  const entities = persisted.entities ?? {};
  const screens: ScreenNode[] = (entities.screens ?? []).map((s, i) => {
    const pos = layout.positions[s.id] ?? defaultPositionFor(i);
    return {
      id: s.id,
      no: s.no,
      name: s.name,
      kind: (s.kind ?? "other") as ScreenKind,
      description: "",
      path: s.path ?? "",
      position: { x: pos.x, y: pos.y },
      size: {
        width: pos.width ?? DEFAULT_NODE_SIZE.width,
        height: pos.height ?? DEFAULT_NODE_SIZE.height,
      },
      hasDesign: s.hasDesign ?? false,
      groupId: s.groupId,
      thumbnail: pos.thumbnail,
      createdAt: s.updatedAt,
      updatedAt: s.updatedAt,
    };
  });
  const groups: ScreenGroup[] = (entities.screenGroups ?? []).map((g) => {
    const pos = layout.positions[g.id] ?? defaultGroupPosition();
    return {
      id: g.id,
      name: g.name,
      color: g.color ?? pos.color,
      position: { x: pos.x, y: pos.y },
      size: {
        width: pos.width ?? 360,
        height: pos.height ?? 280,
      },
      createdAt: persisted.meta.createdAt,
      updatedAt: persisted.meta.updatedAt,
    };
  });
  const edges: ScreenEdge[] = (entities.screenTransitions ?? []).map((e) => {
    const tl = layout.transitions?.[e.id];
    return {
      id: e.id,
      source: e.sourceScreenId,
      target: e.targetScreenId,
      sourceHandle: tl?.sourceHandle,
      targetHandle: tl?.targetHandle,
      label: e.label ?? "",
      trigger: e.trigger,
    };
  });
  return {
    version: 1,
    name: persisted.meta.name,
    screens,
    groups,
    edges,
    tables: entities.tables,
    processFlows: entities.processFlows?.map((f) => ({
      ...f,
      type: (f.kind ?? "other"),
    })),
    sequences: entities.sequences,
    views: entities.views,
    updatedAt: persisted.meta.updatedAt,
  };
}

/**
 * UI 合成型 FlowProject を Persisted (harmony.json) と ScreenLayout に分解。
 *
 * existingRaw を渡すことで、FlowProject に含まれないフィールド
 * (techStack / extensionsApplied / meta.id / meta.description 等) を保持する。
 * round-trip preservation (#835 バグ修正)。
 */
export function decomposeFlowProject(
  project: FlowProject,
  baseLayout: ScreenLayout,
  existingRaw?: Project,
): { project: Project; layout: ScreenLayout } {
  const ts = project.updatedAt || nowTs();
  const persisted: Project = {
    $schema: PROJECT_SCHEMA_REF,
    schemaVersion: "v3",
    // dataDir を既存から保持。存在しない場合は推奨デフォルト "harmony"
    dataDir: existingRaw?.dataDir ?? "harmony",
    meta: {
      // existingRaw.meta.id を保持。新規プロジェクト or existing なし時は generateUUID()
      id: (existingRaw?.meta?.id ?? generateUUID()) as ProjectId,
      name: project.name,
      // existingRaw.meta.createdAt を保持。なければ現在時刻
      createdAt: existingRaw?.meta?.createdAt ?? ts,
      updatedAt: ts,
      mode: existingRaw?.meta?.mode ?? "upstream",
      maturity: existingRaw?.meta?.maturity ?? "draft",
      // description を保持
      ...(existingRaw?.meta?.description !== undefined
        ? { description: existingRaw.meta.description }
        : {}),
    },
    // extensionsApplied を既存から保持。存在しない場合は空配列
    extensionsApplied: existingRaw?.extensionsApplied ?? [],
    // techStack を既存から保持。FlowProject には techStack がないため常に existing を使う
    ...(existingRaw?.techStack !== undefined ? { techStack: existingRaw.techStack } : {}),
    entities: {
      screens: project.screens.map((s) => {
        // existing 同 id 画面があれば、既存の不明フィールド (html 等) を保持してマージ
        const existingScreen = existingRaw?.entities?.screens?.find((es) => es.id === s.id);
        if (existingScreen) {
          return {
            ...existingScreen,
            id: s.id,
            no: s.no,
            name: s.name,
            kind: s.kind,
            path: s.path,
            hasDesign: s.hasDesign,
            groupId: s.groupId,
            updatedAt: s.updatedAt,
          };
        }
        return {
          id: s.id,
          no: s.no,
          name: s.name,
          kind: s.kind,
          path: s.path,
          hasDesign: s.hasDesign,
          groupId: s.groupId,
          updatedAt: s.updatedAt,
        };
      }),
      screenGroups: project.groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
      })),
      screenTransitions: project.edges.map((e) => ({
        id: e.id,
        sourceScreenId: e.source,
        targetScreenId: e.target,
        ...(e.label ? { label: e.label } : {}),
        trigger: e.trigger,
      })),
      tables: project.tables,
      processFlows: project.processFlows?.map((entry) => {
        // composeFlowProject で UI 用に追加した type フィールドを除去 (unevaluatedProperties: false 対策)
        const { type: _t, ...rest } = entry as ProcessFlowMeta & { type?: unknown };
        void _t;
        return {
          ...rest,
          id: rest.id as ProcessFlowId,
          screenId: rest.screenId as ScreenId | undefined,
        };
      }),
      sequences: project.sequences,
      views: project.views,
    },
  };

  const positions: ScreenLayout["positions"] = {};
  for (const s of project.screens) {
    positions[s.id] = {
      x: s.position.x,
      y: s.position.y,
      width: s.size.width,
      height: s.size.height,
      thumbnail: s.thumbnail,
    };
  }
  for (const g of project.groups) {
    positions[g.id] = {
      x: g.position.x,
      y: g.position.y,
      width: g.size.width,
      height: g.size.height,
      color: g.color,
    };
  }

  const transitions: ScreenLayout["transitions"] = {};
  for (const e of project.edges) {
    if (e.sourceHandle || e.targetHandle) {
      transitions[e.id] = {
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      };
    }
  }

  return {
    project: persisted,
    layout: {
      ...baseLayout,
      positions,
      transitions,
      updatedAt: nowTs(),
    },
  };
}

// ─── ローカルユーティリティ ─────────────────────────────────────────────

function createEmptyProject(): FlowProject {
  return {
    version: 1,
    name: "新規プロジェクト",
    screens: [],
    groups: [],
    edges: [],
    updatedAt: nowTs(),
  };
}

/** v1 → 内部 PersistedFlowProject へ最低限の field 補完。 */
function normalizeLegacyPersisted(raw: unknown): LegacyFlowProject {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const screensRaw = (obj.screens as Array<Record<string, unknown>> | undefined) ?? [];
  const groupsRaw = (obj.groups as Array<Record<string, unknown>> | undefined) ?? [];
  const edgesRaw = (obj.edges as Array<Record<string, unknown>> | undefined) ?? [];

  // v1 互換: type → kind rename (まだ harmony.json に type が残っていた場合の救済)
  const screens: PersistedScreen[] = screensRaw.map((s, i) => ({
    id: (s.id as ScreenId) ?? (generateUUID() as ScreenId),
    no: typeof s.no === "number" ? s.no : i + 1,
    name: String(s.name ?? ""),
    kind: ((s.kind as ScreenKind) ?? (s.type as ScreenKind) ?? "other") as ScreenKind,
    description: String(s.description ?? ""),
    path: String(s.path ?? ""),
    hasDesign: !!s.hasDesign,
    groupId: (s.groupId as ScreenGroupId | undefined) ?? undefined,
    createdAt: (s.createdAt as Timestamp) ?? nowTs(),
    updatedAt: (s.updatedAt as Timestamp) ?? nowTs(),
  }));
  const groups: PersistedGroup[] = groupsRaw.map((g) => ({
    id: (g.id as ScreenGroupId) ?? (generateUUID() as ScreenGroupId),
    name: String(g.name ?? ""),
    color: (g.color as string | undefined) ?? undefined,
    createdAt: (g.createdAt as Timestamp) ?? nowTs(),
    updatedAt: (g.updatedAt as Timestamp) ?? nowTs(),
  }));
  const edges: PersistedEdge[] = edgesRaw.map((e) => ({
    id: String(e.id ?? generateUUID()),
    source: String(e.source ?? ""),
    target: String(e.target ?? ""),
    label: String(e.label ?? ""),
    trigger: (e.trigger as ScreenTransitionEntry["trigger"]) ?? "click",
  }));

  return {
    version: 1,
    name: String(obj.name ?? "新規プロジェクト"),
    screens,
    groups,
    edges,
    tables: obj.tables as LegacyFlowProject["tables"],
    processFlows: obj.processFlows as ProcessFlowMeta[] | undefined,
    sequences: obj.sequences as LegacyFlowProject["sequences"],
    views: obj.views as LegacyFlowProject["views"],
    updatedAt: (obj.updatedAt as Timestamp) ?? nowTs(),
  };
}

export function legacyToProject(legacy: LegacyFlowProject): Project {
  return {
    $schema: PROJECT_SCHEMA_REF,
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: generateUUID() as ProjectId,
      name: legacy.name,
      createdAt: legacy.updatedAt,
      updatedAt: legacy.updatedAt,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    entities: {
      screens: legacy.screens.map((s) => ({
        id: s.id,
        no: s.no,
        name: s.name,
        kind: s.kind,
        path: s.path,
        groupId: s.groupId,
        hasDesign: s.hasDesign,
        updatedAt: s.updatedAt,
      })),
      screenGroups: legacy.groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
      })),
      screenTransitions: legacy.edges.map((e) => ({
        id: e.id as LocalId,
        sourceScreenId: e.source as ScreenId,
        targetScreenId: e.target as ScreenId,
        ...(e.label ? { label: e.label } : {}),
        trigger: e.trigger,
      })),
      tables: legacy.tables,
      processFlows: legacy.processFlows?.map((entry) => ({
        ...entry,
        id: entry.id as ProcessFlowId,
        screenId: entry.screenId as ScreenId | undefined,
      })),
      sequences: legacy.sequences,
      views: legacy.views,
    },
  };
}

/** v1/v3 persisted shape を v3 Project root に正規化する。 */
function normalizePersisted(raw: unknown): PersistedFlowProject {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (obj.schemaVersion === "v3" && obj.meta && typeof obj.meta === "object") {
    const project = obj as unknown as Project;
    return {
      ...project,
      $schema: project.$schema ?? PROJECT_SCHEMA_REF,
      entities: {
        screens: project.entities?.screens ?? [],
        screenGroups: project.entities?.screenGroups ?? [],
        screenTransitions: project.entities?.screenTransitions ?? [],
        tables: project.entities?.tables,
        processFlows: project.entities?.processFlows,
        sequences: project.entities?.sequences,
        views: project.entities?.views,
      },
    };
  }
  return legacyToProject(normalizeLegacyPersisted(raw));
}

/** 旧 v1 (gjs-designer-project) → 新構造へマイグレーション。 */
function migrateLegacyLocalStorage(): PersistedFlowProject | null {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  const screenId = generateUUID() as ScreenId;
  const screen: PersistedScreen = {
    id: screenId,
    no: 1,
    name: "メイン画面",
    kind: "other",
    description: "既存デザインから移行",
    path: "/",
    hasDesign: true,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  localStorage.setItem(`${SCREEN_DATA_PREFIX}${screenId}`, raw);
  const project: LegacyFlowProject = {
    version: 1,
    name: "マイプロジェクト",
    screens: [screen],
    groups: [],
    edges: [],
    updatedAt: nowTs(),
  };
  const migrated = legacyToProject(project);
  localStorage.setItem(FLOW_PROJECT_KEY, JSON.stringify(migrated));
  return migrated;
}

function loadPersistedFromLocalStorage(): PersistedFlowProject | null {
  const raw = localStorage.getItem(FLOW_PROJECT_KEY);
  if (raw) {
    try {
      return normalizePersisted(JSON.parse(raw));
    } catch { /* 破損時は無視 */ }
  }
  const legacyRaw = localStorage.getItem(LEGACY_FLOW_PROJECT_KEY);
  if (legacyRaw) {
    try {
      const migrated = normalizePersisted(JSON.parse(legacyRaw));
      localStorage.setItem(FLOW_PROJECT_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_FLOW_PROJECT_KEY);
      return migrated;
    } catch { /* ignore */ }
  }
  return migrateLegacyLocalStorage();
}

// ─── 公開 API ────────────────────────────────────────────────────────────

function ensureProjectDefaults(project: FlowProject): FlowProject {
  if (!project.groups) project.groups = [];
  for (const s of project.screens) {
    if (s.groupId === undefined) s.groupId = undefined;
  }
  project.screens = renumber(project.screens);
  if (project.tables) project.tables = renumber(project.tables);
  if (project.processFlows) project.processFlows = renumber(project.processFlows);
  return project;
}

function hasPersistedData(project: Project | null | undefined): boolean {
  const entities = project?.entities;
  return !!entities &&
    ((entities.screens?.length ?? 0) > 0 ||
      (entities.tables?.length ?? 0) > 0 ||
      (entities.processFlows?.length ?? 0) > 0);
}

/**
 * プロジェクトを読み込み (harmony.json + screen-layout.json 合成)。
 *
 * !!! データ消失バグ修正 (2026-04-22) !!!
 * 以前は backend.loadProject() が null を返した場合、createEmptyProject() を
 * 即座に backend に書き戻していた。これが race condition でデータ消失を引き起こしていたため
 * 今後は null を受け取っても backend への書き戻しは行わない。
 */
export async function loadProject(): Promise<FlowProject> {
  const backend = requireBackend();
  const data = await backend.loadProject();
  if (data) {
    const persisted = normalizePersisted(data);
    if (!((data as Record<string, unknown>).schemaVersion === "v3")) {
      // AJV validation: schema 違反があれば migration 書き戻しを中断し例外を投げる (#836)
      assertValidProject(persisted);
      await backend.saveProject(persisted);
    }
    const layout = await loadScreenLayout();
    return ensureProjectDefaults(composeFlowProject(persisted, layout));
  }
  // backend が空応答の場合のみ、旧 localStorage データを 1 度きり救済して backend に書き戻す
  const local = loadPersistedFromLocalStorage();
  if (local && hasPersistedData(local)) {
    // localStorage 側に保存されている screen-layout も合わせて backend に migrate する。
    // 業務情報のみを backend に書き写し、座標を localStorage に置いたままにすると
    // 次回ロード時に backend layout (空) で localStorage layout を上書きしてしまうため。
    const layout = await loadScreenLayout();
    try {
      // AJV validation: schema 違反があれば localStorage→backend migration 書き戻しを中断し例外を投げる (#836)
      assertValidProject(local);
      await backend.saveProject(local);
      if (Object.keys(layout.positions).length > 0 || Object.keys(layout.transitions ?? {}).length > 0) {
        await saveScreenLayout(layout);
      }
      console.log("[flowStore] Migrated project (and screen-layout) from localStorage to file");
    } catch (e) {
      console.warn("[flowStore] migration save failed, returning local without persist", e);
    }
    return ensureProjectDefaults(composeFlowProject(local, layout));
  }
  return createEmptyProject();
}

/**
 * プロジェクトの生 Project 定義を読み込む (techStack.designer.cssFramework 等の参照用)。
 * FlowProject へ合成する loadProject() とは異なり、harmony.json の raw shape を返す。
 * techStack field は FlowProject には含まれないため、本関数で取得する (#793 子 5 / #826)。
 */
export async function loadRawProject(): Promise<Project> {
  const data = await requireBackend().loadProject();
  if (data) return normalizePersisted(data);
  // backend が空応答の場合のみ、旧 localStorage データを 1 度きり救済として読み出す
  const local = loadPersistedFromLocalStorage();
  if (local) return local;
  return normalizePersisted({});
}

/**
 * project.techStack を更新して永続化する (#826)。
 * FlowProject には techStack フィールドがないため、raw Project を直接 patch する専用関数。
 */
export async function saveTechStack(techStack: Project["techStack"]): Promise<void> {
  const raw = await loadRawProject();
  const patched: Project = { ...raw, techStack };
  // AJV validation: schema 違反があれば保存を中断し例外を投げる (#835)
  assertValidProject(patched);
  await requireBackend().saveProject(patched);
}

async function persistFlowProject(project: FlowProject): Promise<void> {
  const baseLayout = await loadScreenLayout();
  // 既存 raw を読み込んで round-trip preservation に使う (#835)
  const existingRaw = await loadRawProject().catch(() => undefined);
  const { project: persisted, layout } = decomposeFlowProject(project, baseLayout, existingRaw);
  // AJV validation: schema 違反があれば保存を中断し例外を投げる (#835)
  assertValidProject(persisted);
  await requireBackend().saveProject(persisted);
  await saveScreenLayout(layout);
}

/**
 * プロジェクトを保存 (draftMode 有効時は localStorage の draft に書き込む)。
 *
 * !!! データ消失防止ガード (2026-04-22) !!!
 */
export async function saveProject(project: FlowProject): Promise<void> {
  project.updatedAt = nowTs();
  if (_draftMode) {
    saveDraft(FLOW_DRAFT_KIND, FLOW_DRAFT_ID, project);
    _draftSaveListeners.forEach((cb) => cb());
    return;
  }
  const backend = requireBackend();
  const isProjectEmpty =
    (project.screens?.length ?? 0) === 0 &&
    (project.tables?.length ?? 0) === 0 &&
    (project.processFlows?.length ?? 0) === 0;
  if (isProjectEmpty) {
    try {
      const currentRaw = await backend.loadProject();
      const current = currentRaw ? normalizePersisted(currentRaw) : null;
      const hasExistingData = hasPersistedData(current);
      if (hasExistingData) {
        console.warn(
          "[flowStore] saveProject canceled: refusing to overwrite non-empty file with empty project (data-loss guard)",
        );
        return;
      }
    } catch {
      /* read 失敗は書き込みを続行 */
    }
  }
  await persistFlowProject(project);
}

/** ドラフトを介さず必ず永続化する (明示的保存ボタン用)。 */
export async function persistProject(project: FlowProject): Promise<void> {
  project.updatedAt = nowTs();
  const backend = requireBackend();
  const isProjectEmpty =
    (project.screens?.length ?? 0) === 0 &&
    (project.tables?.length ?? 0) === 0 &&
    (project.processFlows?.length ?? 0) === 0;
  if (isProjectEmpty) {
    try {
      const currentRaw = await backend.loadProject();
      const current = currentRaw ? normalizePersisted(currentRaw) : null;
      const hasExistingData = hasPersistedData(current);
      if (hasExistingData) {
        console.warn(
          "[flowStore] persistProject canceled: refusing to overwrite non-empty file with empty project (data-loss guard)",
        );
        return;
      }
    } catch {
      /* read 失敗は書き込みを続行 */
    }
  }
  await persistFlowProject(project);
  clearDraft(FLOW_DRAFT_KIND, FLOW_DRAFT_ID);
}

/** 画面を追加するときの省略可能オプション。 */
export interface AddScreenOptions {
  path?: string;
  position?: { x: number; y: number };
  /** 画面作成時に固定するエディタ種別。省略時は呼び出し側で project.techStack.designer から解決して screen entity に書く。 */
  editorKind?: "grapesjs" | "puck";
  /** 画面作成時に固定する CSS フレームワーク。省略時は呼び出し側で project.techStack.designer から解決して screen entity に書く。 */
  cssFramework?: "bootstrap" | "tailwind";
}

/** 画面を追加。 */
export async function addScreen(
  project: FlowProject,
  name: string,
  kind: ScreenKind,
  opts?: AddScreenOptions,
): Promise<ScreenNode> {
  const id = generateUUID() as ScreenId;
  const screen: ScreenNode = {
    id,
    no: nextNo(project.screens),
    name,
    kind,
    description: "",
    path: opts?.path ?? "",
    position: opts?.position ?? { x: 100 + project.screens.length * 250, y: 150 },
    size: { ...DEFAULT_NODE_SIZE },
    hasDesign: false,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  project.screens.push(screen);
  project.screens = renumber(project.screens);
  await saveProject(project);
  return screen;
}

/** 画面メタを更新。 */
export async function updateScreen(
  project: FlowProject,
  screenId: string,
  patch: Partial<Pick<ScreenNode, "name" | "kind" | "description" | "path" | "position" | "size">>,
): Promise<ScreenNode | null> {
  const screen = project.screens.find((s) => s.id === screenId);
  if (!screen) return null;
  Object.assign(screen, patch, { updatedAt: nowTs() });
  await saveProject(project);
  return screen;
}

/** 画面を削除 (関連エッジ + デザインデータ + screen-layout.positions も削除)。 */
export async function removeScreen(project: FlowProject, screenId: string): Promise<boolean> {
  const idx = project.screens.findIndex((s) => s.id === screenId);
  if (idx === -1) return false;
  project.screens.splice(idx, 1);
  project.screens = renumber(project.screens);
  project.edges = project.edges.filter((e) => e.source !== screenId && e.target !== screenId);
  await requireBackend().deleteScreenData(screenId);
  await saveProject(project);
  // 念のため screen-layout 側からも明示削除 (project.screens にもう存在しないので
  // decomposeFlowProject で positions[id] は再構築されないが、過去 layout の残骸を確実に消す)
  const baseLayout = await loadScreenLayout();
  const cleared = layoutRemovePosition(baseLayout, screenId);
  if (cleared !== baseLayout) {
    await saveScreenLayout(cleared);
  }
  return true;
}

/** エッジを追加。 */
export async function addEdge(
  project: FlowProject,
  source: string,
  target: string,
  label: string,
  trigger: ScreenTransitionEntry["trigger"] = "click",
  sourceHandle?: string,
  targetHandle?: string,
): Promise<ScreenEdge> {
  const edge: ScreenEdge = {
    id: generateUUID() as LocalId,
    source: source as ScreenId,
    target: target as ScreenId,
    sourceHandle,
    targetHandle,
    label,
    trigger,
  };
  project.edges.push(edge);
  await saveProject(project);
  return edge;
}

/** エッジを更新。 */
export async function updateEdge(
  project: FlowProject,
  edgeId: string,
  patch: Partial<Pick<ScreenEdge, "label" | "trigger" | "sourceHandle" | "targetHandle">>,
): Promise<ScreenEdge | null> {
  const edge = project.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  Object.assign(edge, patch);
  await saveProject(project);
  return edge;
}

/** エッジを削除。 */
export async function removeEdge(project: FlowProject, edgeId: string): Promise<boolean> {
  const idx = project.edges.findIndex((e) => e.id === edgeId);
  if (idx === -1) return false;
  project.edges.splice(idx, 1);
  await saveProject(project);
  const baseLayout = await loadScreenLayout();
  const cleared = layoutRemoveTransition(baseLayout, edgeId);
  if (cleared !== baseLayout) {
    await saveScreenLayout(cleared);
  }
  return true;
}

/** 画面のサムネイルを更新 (ScreenLayout.positions[id].thumbnail に格納)。 */
export async function updateScreenThumbnail(
  project: FlowProject,
  screenId: string,
  thumbnail: string,
): Promise<void> {
  const screen = project.screens.find((s) => s.id === screenId);
  if (!screen) return;
  screen.thumbnail = thumbnail;
  screen.updatedAt = nowTs();
  await saveProject(project);
}

/** 画面のデザインデータ有無を更新。 */
export async function markScreenHasDesign(
  project: FlowProject,
  screenId: string,
  has: boolean,
): Promise<void> {
  const screen = project.screens.find((s) => s.id === screenId);
  if (screen && screen.hasDesign !== has) {
    screen.hasDesign = has;
    await saveProject(project);
  }
}

/**
 * 画面のストレージキー。
 * 本体 fallback は #923 シリーズで廃止済み。本関数は legacyLocalStorageRescue
 * (旧 GrapesJS autosave データの 1 度きり救済) からのみ参照される。
 */
export function screenStorageKey(screenId: string): string {
  return `${SCREEN_DATA_PREFIX}${screenId}`;
}

/** 画面が存在するか。 */
export function screenExists(project: FlowProject, screenId: string): boolean {
  return project.screens.some((s) => s.id === screenId);
}

// ─── グループ操作 ──────────────────────────────────────────────────────

/** グループを追加。 */
export async function addGroup(
  project: FlowProject,
  name: string,
  position: { x: number; y: number },
): Promise<ScreenGroup> {
  const group: ScreenGroup = {
    id: generateUUID() as ScreenGroupId,
    name,
    position,
    size: { width: 360, height: 280 },
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  project.groups.push(group);
  await saveProject(project);
  return group;
}

/** グループを更新。 */
export async function updateGroup(
  project: FlowProject,
  groupId: string,
  patch: Partial<Pick<ScreenGroup, "name" | "position" | "size" | "color">>,
): Promise<ScreenGroup | null> {
  const group = project.groups.find((g) => g.id === groupId);
  if (!group) return null;
  Object.assign(group, patch, { updatedAt: nowTs() });
  await saveProject(project);
  return group;
}

/** グループを削除 (所属画面は ungrouped に戻す)。 */
export async function removeGroup(project: FlowProject, groupId: string): Promise<boolean> {
  const idx = project.groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return false;
  project.groups.splice(idx, 1);
  for (const s of project.screens) {
    if ((s.groupId as string | undefined) === groupId) {
      s.groupId = undefined;
    }
  }
  await saveProject(project);
  const baseLayout = await loadScreenLayout();
  const cleared = layoutRemovePosition(baseLayout, groupId);
  if (cleared !== baseLayout) {
    await saveScreenLayout(cleared);
  }
  return true;
}

/** 画面をグループに割り当て (undefined でグループ解除)。 */
export async function assignScreenGroup(
  project: FlowProject,
  screenId: string,
  groupId: ScreenGroupId | undefined,
): Promise<void> {
  const screen = project.screens.find((s) => s.id === screenId);
  if (!screen) return;
  screen.groupId = groupId;
  screen.updatedAt = nowTs();
  await saveProject(project);
}

// ─── エクスポート / インポート ──────────────────────────────────────────

export function exportProjectJSON(project: FlowProject): string {
  return JSON.stringify(project, null, 2);
}

export async function importProjectJSON(json: string): Promise<FlowProject> {
  const parsed = JSON.parse(json) as FlowProject;
  if (parsed.version !== 1 || !Array.isArray(parsed.screens) || !Array.isArray(parsed.edges)) {
    throw new Error("不正なプロジェクトファイルです");
  }
  const current = await loadProject();
  const backend = requireBackend();
  for (const s of current.screens) {
    await backend.deleteScreenData(s.id);
  }
  await saveProject(parsed);
  return parsed;
}

// ─── Mermaid 生成 ───────────────────────────────────────────────────────

function mermaidEscape(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/[[\](){}]/g, "");
}

export function generateMermaid(project: FlowProject): string {
  if (project.screens.length === 0) return "flowchart TD\n  empty[画面なし]";

  const lines: string[] = ["flowchart TD"];
  const idMap = new Map<string, string>();
  project.screens.forEach((s, i) => idMap.set(s.id, `S${i}`));

  for (const s of project.screens) {
    const sid = idMap.get(s.id)!;
    const label = mermaidEscape(s.name);
    const sub = s.path ? `<br/>${mermaidEscape(s.path)}` : "";
    const kindLabel = SCREEN_KIND_LABELS[s.kind] ?? s.kind;
    lines.push(`    ${sid}["${label}${sub}<br/><small>${kindLabel}</small>"]`);
  }
  for (const e of project.edges) {
    const src = idMap.get(e.source);
    const tgt = idMap.get(e.target);
    if (!src || !tgt) continue;
    const edgeLabel = e.label ? mermaidEscape(e.label) : (TRIGGER_LABELS[e.trigger] ?? "");
    if (edgeLabel) {
      lines.push(`    ${src} -->|${edgeLabel}| ${tgt}`);
    } else {
      lines.push(`    ${src} --> ${tgt}`);
    }
  }
  return lines.join("\n");
}

export function generateFlowMarkdown(project: FlowProject): string {
  const mermaid = generateMermaid(project);
  const screenRows = project.screens.map((s) => {
    const kind = SCREEN_KIND_LABELS[s.kind] ?? s.kind;
    const desc = s.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
    return `| ${s.name} | ${kind} | ${s.path || "—"} | ${desc || "—"} | ${s.hasDesign ? "✓" : "—"} |`;
  });
  const edgeRows = project.edges.map((e) => {
    const src = project.screens.find((s) => s.id === e.source)?.name ?? e.source;
    const tgt = project.screens.find((s) => s.id === e.target)?.name ?? e.target;
    const trigger = TRIGGER_LABELS[e.trigger] ?? e.trigger;
    return `| ${src} | → | ${tgt} | ${e.label || "—"} | ${trigger} |`;
  });

  return [
    `# ${project.name} — 画面フロー図`,
    "",
    "```mermaid",
    mermaid,
    "```",
    "",
    "## 画面一覧",
    "",
    "| 画面名 | 種別 | URL | 説明 | デザイン |",
    "|--------|------|-----|------|----------|",
    ...screenRows,
    "",
    "## 遷移一覧",
    "",
    "| 遷移元 | | 遷移先 | ラベル | トリガー |",
    "|--------|---|--------|--------|----------|",
    ...edgeRows,
    "",
    `> 生成日時: ${new Date().toLocaleString("ja-JP")}`,
    "",
  ].join("\n");
}
