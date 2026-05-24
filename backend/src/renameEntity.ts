/**
 * 7 top-level entity (Screen / Table / ProcessFlow / Sequence / View / ViewDefinition / PageLayout)
 * の id (kebab-case EntityId) を rename する公開 API (#1298 I-6, RFC #1284)。
 *
 * - preview: state を変更せず影響範囲 (file renames + ref update 件数) を返す
 * - rename: atomic に主ファイル rename + 参照側 update。失敗時は snapshot から完全 restore
 * - undo: 直近 1 件の rename を完全 revert (in-memory 5 分 TTL)
 *
 * uuid 不変保証: rename 後 read し直して meta.uuid (ProcessFlow) / root.uuid (その他) が
 * snapshot と一致することを assert する。
 *
 * 参考: backend/src/renameScreenItem.ts (#332) の countRefsInValue / renameRefsInValue を
 * generic 化。entity 種別ごとに ref field 名は entity-meta-driven で扱う。
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import {
  resolveDataRoot,
  listExistingEntityIds,
  readProject,
  readScreenEntity,
  writeScreenEntity,
  readTable,
  writeTable,
  readProcessFlow,
  writeProcessFlow,
  listProcessFlows,
  readSequence,
  writeSequence,
  readView,
  writeView,
  listAllViews,
  readViewDefinition,
  writeViewDefinition,
  listAllViewDefinitions,
  readPageLayout,
  writePageLayout,
  listAllPageLayouts,
  listAllTables,
  readScreenFlowPositions,
  type TopLevelEntityKind,
} from "./projectStorage.js";

// ── Public types ────────────────────────────────────────────────────────────

/** rename 対象として許容される entity 種別 (RFC #1284、7 entity type 限定) */
export type RenameEntityType = TopLevelEntityKind;

/** 参照位置 1 件 (RFC 6901 jsonPointer + 旧値) */
export interface RefLocation {
  /** dataRoot 相対 path (例: "process-flows/order-create.json") */
  filePath: string;
  /** 参照元 entity 種別 ("processFlow" 等) */
  entityKind: string;
  /** 参照元 entity の id */
  entityId: string;
  /** 参照位置の RFC 6901 pointer (例: "/steps/0/inputs/2/tableId") */
  jsonPointer: string;
  /** 置換前の値 (= oldId) */
  oldValue: string;
}

export interface PreviewResult {
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  /** newId が同 entity 種別内で未使用か (true なら衝突なし) */
  uniqueOk: boolean;
  /** oldId が実在するか */
  oldExists: boolean;
  /** 他 session が edit lock を保持しているか */
  lockedByOther: boolean;
  /** 主ファイル + design 等を含む rename 対象 file path 群 (dataRoot 相対) */
  fileRenames: Array<{ from: string; to: string }>;
  /** 参照側 update の全位置 */
  refUpdates: RefLocation[];
  /** refUpdates.length (UI 表示用に明示) */
  totalRefs: number;
}

export interface RenameOperation {
  /** undo 用 operation id (uuid v4) */
  operationId: string;
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  /** uuid 不変保証チェック用 (rename 後 read で一致 assert) */
  uuid: string;
  /** TTL 計算用 (ms epoch) */
  ts: number;
  /** dataRoot 相対 path + 元 content (undo 時の restore 用) */
  fileRenames: Array<{ from: string; to: string; originalContent: string }>;
  /** ref 側 update の dataRoot 相対 path + 元 content + 新 content */
  refUpdates: Array<{ filePath: string; originalContent: string; newContent: string }>;
}

/** rename 中 lock 検査で参照する EditSession 抽象 (テスト容易性のため最小契約) */
export interface EditSessionLike {
  state: "Active" | "Discarded";
  participants: Map<string, { sessionId: string; role: "Edit" | "View" }>;
}

export interface RenameOpts {
  /**
   * 自セッションは lock 衝突から除外する (sessionId が participants.Edit に含まれていても OK)。
   * UI から rename を実行する経路で active edit session を持っている前提に対応。
   */
  sessionId?: string;
  /**
   * lock check 用 EditSession 一覧 inject (テスト容易性 / handler 経由で bridge から取得)。
   * 省略時は lock check skip (test path / standalone path 用)。
   */
  editSessions?: ReadonlyArray<EditSessionLike>;
}

// ── 内部定数 ────────────────────────────────────────────────────────────────

/** 各 entity 種別の主 dir (dataRoot 相対) */
const ENTITY_PRIMARY_DIR: Record<RenameEntityType, string> = {
  screen: "screens",
  table: "tables",
  processFlow: "process-flows",
  sequence: "sequences",
  view: "views",
  viewDefinition: "view-definitions",
  pageLayout: "page-layouts",
};

/** ProcessFlow legacy dir (#1141 互換、actions/<id>.json も rename 対象) */
const PROCESS_FLOW_LEGACY_DIR = "actions";

/**
 * 各 entity 種別を参照する側の field 名 map (RFC #1284 I-6 設計コメント)。
 *
 * 単純な scalar field のみリスト。複合 ref ({tableColumnRef: {tableId, columnId}} 等) は
 * 別途 specialRefHandlers で扱う。
 *
 * 例: rename target が "table" の場合、参照側 JSON 内の `tableId: "<oldId>"` を更新する。
 */
const SCALAR_REF_FIELDS: Record<RenameEntityType, string[]> = {
  screen: ["screenId", "initialScreen"],
  table: ["tableId"],
  processFlow: ["processFlowId"],
  sequence: ["sequenceId"],
  view: ["viewId"],
  viewDefinition: ["viewDefinitionId"],
  pageLayout: ["pageLayoutId"],
};

/**
 * 複合 ref 構造 (entity 種別 → 親 field 名 → 内部 sub-field 名)。
 *
 * 例: rename target が "table" → 親 "tableColumnRef" → sub "tableId" を更新。
 */
const COMPOSITE_REF_FIELDS: Record<RenameEntityType, Array<{ parent: string; sub: string }>> = {
  screen: [{ parent: "screenItemRef", sub: "screenId" }],
  table: [{ parent: "tableColumnRef", sub: "tableId" }],
  processFlow: [
    { parent: "processFlowResponseRef", sub: "processFlowId" },
    { parent: "actionRef", sub: "processFlowId" },
    { parent: "actionStepRef", sub: "processFlowId" },
  ],
  sequence: [],
  view: [{ parent: "viewColumnRef", sub: "viewId" }],
  viewDefinition: [],
  pageLayout: [],
};

// ── In-memory undo store (workspace root → 最新 1 件、5 分 TTL) ───────────────

const UNDO_TTL_MS = 5 * 60 * 1000;
/** key = workspace root path, value = 最新の RenameOperation 1 件 (5 分 TTL) */
const _undoStore = new Map<string, RenameOperation>();

function pushUndo(root: string, op: RenameOperation): void {
  _undoStore.set(root, op);
}

function popUndo(root: string, operationId: string): RenameOperation | null {
  const op = _undoStore.get(root);
  if (!op || op.operationId !== operationId) return null;
  if (Date.now() - op.ts > UNDO_TTL_MS) {
    _undoStore.delete(root);
    return null;
  }
  _undoStore.delete(root);
  return op;
}

/** test-only: undo store を全 root についてクリア */
export function _clearUndoStoreForTest(): void {
  _undoStore.clear();
}

// ── helpers ────────────────────────────────────────────────────────────────

function escapeJsonPointerToken(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * walk: 値 v 内の参照 (field 名一致 + 値一致) を再帰的に走査し、
 * onMatch(jsonPointer, oldValue) を呼ぶ + 必要に応じて値を newId に置換した copy を返す。
 *
 * - mutate しない (新 object/array を返す。input は変更されない)
 * - scalar field: `{ [fieldName]: oldId }` を発見したら置換
 * - composite ref: `{ [parent]: { ..., [sub]: oldId, ... } }` を発見したら置換
 */
type WalkOpts = {
  scalarFields: Set<string>;
  compositeFields: Array<{ parent: string; sub: string }>;
  oldId: string;
  newId: string;
  onMatch: (jsonPointer: string, oldValue: string) => void;
};

function walkAndReplace(value: unknown, pointer: string, opts: WalkOpts): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((v, i) => walkAndReplace(v, `${pointer}/${i}`, opts));
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    const childPointer = `${pointer}/${escapeJsonPointerToken(key)}`;

    // composite ref check: 親 field 名一致 + 内部の sub field 一致
    const composite = opts.compositeFields.find((c) => c.parent === key);
    if (composite && v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      if (inner[composite.sub] === opts.oldId) {
        // ヒット: sub field を置換
        opts.onMatch(`${childPointer}/${escapeJsonPointerToken(composite.sub)}`, opts.oldId);
        const newInner = { ...inner, [composite.sub]: opts.newId };
        // composite parent 配下の他 field は再帰的に walk (multiple ref in same parent 対応は不要だが defensive)
        result[key] = walkAndReplace(newInner, childPointer, opts);
        continue;
      }
    }

    // scalar field check: field 名一致 + 値一致 (string)
    if (opts.scalarFields.has(key) && typeof v === "string" && v === opts.oldId) {
      opts.onMatch(childPointer, opts.oldId);
      result[key] = opts.newId;
      continue;
    }

    // 通常再帰
    result[key] = walkAndReplace(v, childPointer, opts);
  }
  return result;
}

/** read raw file content (utf-8) — restore 用に bytes ではなく string を保持 */
async function readFileContentOrNull(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

async function writeFileContent(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, "utf-8");
}

async function tryUnlink(absPath: string): Promise<void> {
  try { await fs.unlink(absPath); } catch { /* ignore */ }
}

async function fileExists(absPath: string): Promise<boolean> {
  try { await fs.access(absPath); return true; } catch { return false; }
}

/** dataRoot 相対 path 表示用 (snapshot/preview の filePath カラム表記) */
function toRel(absPath: string, dataRoot: string): string {
  return path.relative(dataRoot, absPath).replace(/\\/g, "/");
}

// ── EntityType 別 read/write thin wrapper (uuid preserve のため) ──────────────

async function readEntityRaw(
  entityType: RenameEntityType, id: string, root: string,
): Promise<unknown | null> {
  switch (entityType) {
    case "screen":         return readScreenEntity(id, root);
    case "table":          return readTable(id, root);
    case "processFlow":    return readProcessFlow(id, root);
    case "sequence":       return readSequence(id, root);
    case "view":           return readView(id, root);
    case "viewDefinition": return readViewDefinition(id, root);
    case "pageLayout":     return readPageLayout(id, root);
  }
}

/** entity の `id` field (top-level) を newId に書き換えた copy を返す (ProcessFlow も top-level `id` を持つ) */
function withRewrittenId(entityType: RenameEntityType, data: unknown, newId: string): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  // ProcessFlow は meta.id も持つ場合あり
  if (entityType === "processFlow") {
    const meta = obj.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
      ? { ...(obj.meta as Record<string, unknown>) } : null;
    if (meta && typeof meta.id === "string") meta.id = newId;
    return { ...obj, id: newId, ...(meta ? { meta } : {}) };
  }
  return { ...obj, id: newId };
}

/** entity から uuid を取得 (ProcessFlow は meta.uuid、それ以外は root.uuid) */
function extractUuid(entityType: RenameEntityType, data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (entityType === "processFlow") {
    const meta = obj.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
      ? (obj.meta as Record<string, unknown>) : null;
    const u = meta?.uuid;
    return typeof u === "string" && u.length > 0 ? u : null;
  }
  const u = obj.uuid;
  return typeof u === "string" && u.length > 0 ? u : null;
}

// ── 主ファイル path 解決 (rename の from / to 計算 + design.json 同伴) ─────────

interface PrimaryFilePlan {
  /** dataRoot 配下の絶対 path (from / to) */
  from: string;
  to: string;
}

/**
 * rename 対象の主ファイル + sub-file (design 等) の (from, to) ペア配列を返す。
 *
 * 注: ProcessFlow legacy actions/<id>.json も存在すれば rename 対象に含める。
 */
async function planFileRenames(
  entityType: RenameEntityType, oldId: string, newId: string, dataRoot: string,
): Promise<PrimaryFilePlan[]> {
  const plans: PrimaryFilePlan[] = [];
  const dir = path.join(dataRoot, ENTITY_PRIMARY_DIR[entityType]);

  if (entityType === "processFlow") {
    // 主 (current): process-flows/<id>.json
    const currentFrom = path.join(dir, `${oldId}.json`);
    if (await fileExists(currentFrom)) {
      plans.push({ from: currentFrom, to: path.join(dir, `${newId}.json`) });
    }
    // legacy: actions/<id>.json
    const legacyDir = path.join(dataRoot, PROCESS_FLOW_LEGACY_DIR);
    const legacyFrom = path.join(legacyDir, `${oldId}.json`);
    if (await fileExists(legacyFrom)) {
      plans.push({ from: legacyFrom, to: path.join(legacyDir, `${newId}.json`) });
    }
    return plans;
  }

  // 通常 entity: <dir>/<id>.json
  const primaryFrom = path.join(dir, `${oldId}.json`);
  if (await fileExists(primaryFrom)) {
    plans.push({ from: primaryFrom, to: path.join(dir, `${newId}.json`) });
  }
  // screen / pageLayout は <id>.design.json も rename 対象
  if (entityType === "screen" || entityType === "pageLayout") {
    const designFrom = path.join(dir, `${oldId}.design.json`);
    if (await fileExists(designFrom)) {
      plans.push({ from: designFrom, to: path.join(dir, `${newId}.design.json`) });
    }
  }
  return plans;
}

// ── ref scan (preview 計算 + 実際の update に共通利用) ─────────────────────────

interface RefScanResult {
  /** 各参照 location */
  locations: RefLocation[];
  /** ref 更新を伴う各 file の更新後 content (JSON.stringify, indent=2) */
  perFileUpdate: Map<string, { original: string; updated: string; updatedData: unknown }>;
}

interface RefSourceFile {
  /** 探索対象 entity 種別ラベル (snapshot の entityKind に入る) */
  entityKind: string;
  /** 参照元 entity の id (snapshot の entityId に入る) */
  entityId: string;
  /** dataRoot 配下絶対 path */
  absPath: string;
  /** 当該 file の生 JSON object (parsed) */
  data: unknown;
}

/**
 * 参照側 entity を全種類リストし、各 file 内の ref を scan + 置換 plan を作る。
 *
 * 注: harmony.json / screen-flow-positions.json も参照側として走査する (screen rename 等)。
 */
async function scanAllRefs(
  entityType: RenameEntityType, oldId: string, newId: string, root: string,
): Promise<RefScanResult> {
  const dataRoot = await resolveDataRoot(root);
  const scalarFields = new Set(SCALAR_REF_FIELDS[entityType]);
  const compositeFields = COMPOSITE_REF_FIELDS[entityType];

  // 探索対象 file 群を収集
  const sources: RefSourceFile[] = [];

  // 1. ProcessFlow 全件 (ほぼ全 entity rename で対象)
  const pfList = (await listProcessFlows(root)) as Array<Record<string, unknown>>;
  for (const pf of pfList) {
    const pfId = typeof pf.id === "string" ? pf.id
      : (pf.meta && typeof pf.meta === "object" ? (pf.meta as Record<string, unknown>).id as string : null);
    if (!pfId) continue;
    // current / legacy どちらかから読まれた data。実 file path を再特定するため、両 candidate を試す
    const currentAbs = path.join(dataRoot, "process-flows", `${pfId}.json`);
    const legacyAbs  = path.join(dataRoot, "actions", `${pfId}.json`);
    let absPath: string;
    if (await fileExists(currentAbs)) absPath = currentAbs;
    else if (await fileExists(legacyAbs)) absPath = legacyAbs;
    else continue;
    sources.push({ entityKind: "processFlow", entityId: pfId, absPath, data: pf });
  }

  // 2. Screen entity (items 内 ref を参照: tableId / screenId / viewDefinitionId etc.)
  const screenIds = await listExistingEntityIds("screen", root);
  for (const sid of screenIds) {
    const screen = await readScreenEntity(sid, root);
    if (!screen) continue;
    sources.push({
      entityKind: "screen", entityId: sid,
      absPath: path.join(dataRoot, "screens", `${sid}.json`),
      data: screen,
    });
  }

  // 3. View
  const views = (await listAllViews(root)) as Array<Record<string, unknown>>;
  for (const v of views) {
    const vid = typeof v.id === "string" ? v.id : null;
    if (!vid) continue;
    sources.push({
      entityKind: "view", entityId: vid,
      absPath: path.join(dataRoot, "views", `${vid}.json`),
      data: v,
    });
  }

  // 4. ViewDefinition
  const vds = (await listAllViewDefinitions(root)) as Array<Record<string, unknown>>;
  for (const vd of vds) {
    const vdid = typeof vd.id === "string" ? vd.id : null;
    if (!vdid) continue;
    sources.push({
      entityKind: "viewDefinition", entityId: vdid,
      absPath: path.join(dataRoot, "view-definitions", `${vdid}.json`),
      data: vd,
    });
  }

  // 5. PageLayout (主 entity のみ、design.json は GrapesJS HTML 用なので skip)
  const pls = (await listAllPageLayouts(root)) as Array<Record<string, unknown>>;
  for (const pl of pls) {
    const pid = typeof pl.id === "string" ? pl.id : null;
    if (!pid) continue;
    sources.push({
      entityKind: "pageLayout", entityId: pid,
      absPath: path.join(dataRoot, "page-layouts", `${pid}.json`),
      data: pl,
    });
  }

  // 6. Table (column.references / 他 table 参照は scope 外だが、念のため全 table を走査)
  const tables = (await listAllTables(root)) as Array<Record<string, unknown>>;
  for (const t of tables) {
    const tid = typeof t.id === "string" ? t.id : null;
    if (!tid) continue;
    sources.push({
      entityKind: "table", entityId: tid,
      absPath: path.join(dataRoot, "tables", `${tid}.json`),
      data: t,
    });
  }

  // 7. harmony.json (screen rename で initialScreen / screenFlow nodes 参照)
  const projectData = await readProject(root);
  if (projectData) {
    sources.push({
      entityKind: "project", entityId: "harmony.json",
      absPath: path.join(root, "harmony.json"),
      data: projectData,
    });
  }

  // 8. screen-flow-positions.json (screen rename で node id 参照)
  const sfp = await readScreenFlowPositions(root);
  if (sfp) {
    sources.push({
      entityKind: "screenFlowPositions", entityId: "screen-flow-positions.json",
      absPath: path.join(dataRoot, "screen-flow-positions.json"),
      data: sfp,
    });
  }

  // ── walk + update plan 作成 ────────────────────────────────
  const locations: RefLocation[] = [];
  const perFileUpdate = new Map<string, { original: string; updated: string; updatedData: unknown }>();

  for (const src of sources) {
    // self-reference は rename 対象側でカバーされるので skip
    // (entityType === src.entityKind && src.entityId === oldId) はファイル自体を rename するため
    // 参照側 update には含めない
    if (src.entityKind === entityType && src.entityId === oldId) continue;

    let hitCount = 0;
    const updated = walkAndReplace(src.data, "", {
      scalarFields, compositeFields, oldId, newId,
      onMatch: (jsonPointer, oldValue) => {
        hitCount++;
        locations.push({
          filePath: toRel(src.absPath, dataRoot),
          entityKind: src.entityKind,
          entityId: src.entityId,
          jsonPointer,
          oldValue,
        });
      },
    });
    if (hitCount > 0) {
      const originalContent = await readFileContentOrNull(src.absPath);
      if (originalContent !== null) {
        perFileUpdate.set(src.absPath, {
          original: originalContent,
          updated: JSON.stringify(updated, null, 2),
          updatedData: updated,
        });
      }
    }
  }

  return { locations, perFileUpdate };
}

// ── lock check ───────────────────────────────────────────────────────────────

function detectLockedByOther(
  editSessions: ReadonlyArray<EditSessionLike> | undefined,
  selfSessionId: string | undefined,
): boolean {
  if (!editSessions || editSessions.length === 0) return false;
  for (const es of editSessions) {
    if (es.state !== "Active") continue;
    for (const [, participant] of es.participants) {
      if (participant.role !== "Edit") continue;
      if (selfSessionId && participant.sessionId === selfSessionId) continue;
      return true;
    }
  }
  return false;
}

/** entityType → editSessionStore で使う resourceType への mapping */
export function entityTypeToResourceType(entityType: RenameEntityType): string {
  switch (entityType) {
    case "screen":         return "screen";
    case "table":          return "table";
    case "processFlow":    return "process-flow";
    case "sequence":       return "sequence";
    case "view":           return "view";
    case "viewDefinition": return "view-definition";
    case "pageLayout":     return "page-layout";
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * rename の影響範囲を返す (state 変更なし)。
 *
 * - oldId 不在 → oldExists=false
 * - newId 衝突 → uniqueOk=false
 * - 他 session 編集中 → lockedByOther=true
 * - 参照側 update 件数 + file rename 件数を返す
 */
export async function previewEntityRename(
  entityType: RenameEntityType,
  oldId: string,
  newId: string,
  root: string,
  opts?: RenameOpts,
): Promise<PreviewResult> {
  if (oldId === newId) {
    return {
      entityType, oldId, newId,
      uniqueOk: true, oldExists: true, lockedByOther: false,
      fileRenames: [], refUpdates: [], totalRefs: 0,
    };
  }

  const dataRoot = await resolveDataRoot(root);
  const existingIds = await listExistingEntityIds(entityType, root);
  const oldExists = existingIds.includes(oldId);
  const uniqueOk = !existingIds.includes(newId);
  const lockedByOther = detectLockedByOther(opts?.editSessions, opts?.sessionId);

  // 主ファイル plan
  const filePlans = await planFileRenames(entityType, oldId, newId, dataRoot);
  const fileRenames = filePlans.map((p) => ({
    from: toRel(p.from, dataRoot),
    to: toRel(p.to, dataRoot),
  }));

  // ref 走査
  const refScan = await scanAllRefs(entityType, oldId, newId, root);

  return {
    entityType, oldId, newId,
    uniqueOk, oldExists, lockedByOther,
    fileRenames,
    refUpdates: refScan.locations,
    totalRefs: refScan.locations.length,
  };
}

/**
 * rename を実行する。atomic に主ファイル + 参照側 update。
 *
 * 失敗時は snapshot から完全 restore (元の file 内容に byte-identical 復元)。
 *
 * uuid 不変保証: rename 後 read し直して uuid 一致を assert (不一致なら restore + throw)。
 *
 * undo は in-memory 1 件 (5 分 TTL or 次 rename で上書き)。
 */
export async function renameEntityId(
  entityType: RenameEntityType,
  oldId: string,
  newId: string,
  root: string,
  opts?: RenameOpts,
): Promise<{ operation: RenameOperation; preview: PreviewResult }> {
  if (oldId === newId) {
    throw new Error(`oldId と newId が同一です: "${oldId}"`);
  }

  const dataRoot = await resolveDataRoot(root);

  // pre-check
  const existingIds = await listExistingEntityIds(entityType, root);
  if (!existingIds.includes(oldId)) {
    throw new Error(`${entityType} id "${oldId}" が見つかりません`);
  }
  if (existingIds.includes(newId)) {
    throw new Error(`${entityType} id "${newId}" は既に同 workspace 内で使用されています (RFC #1284: entity type 内 unique)`);
  }
  if (detectLockedByOther(opts?.editSessions, opts?.sessionId)) {
    throw new Error(`${entityType} "${oldId}" は他 session が編集中です。lock 解放を待つか、編集を引き取ってください。`);
  }

  // 主 entity の snapshot + uuid 取得
  const primaryData = await readEntityRaw(entityType, oldId, root);
  if (!primaryData) {
    throw new Error(`${entityType} "${oldId}" の読み込みに失敗しました`);
  }
  const expectedUuid = extractUuid(entityType, primaryData);
  if (!expectedUuid) {
    throw new Error(`${entityType} "${oldId}" に uuid がありません。I-2 migration 完了後に再実行してください。`);
  }

  // 主ファイル plan + ref 走査
  const filePlans = await planFileRenames(entityType, oldId, newId, dataRoot);
  if (filePlans.length === 0) {
    throw new Error(`${entityType} "${oldId}" の物理ファイルが見つかりません`);
  }
  const refScan = await scanAllRefs(entityType, oldId, newId, root);

  // snapshot 構築 (失敗時 restore 用)
  const fileRenameSnapshots: Array<{ from: string; to: string; originalContent: string }> = [];
  for (const plan of filePlans) {
    const content = await readFileContentOrNull(plan.from);
    if (content === null) {
      throw new Error(`rename 元ファイル ${toRel(plan.from, dataRoot)} の読み込みに失敗しました`);
    }
    fileRenameSnapshots.push({
      from: toRel(plan.from, dataRoot),
      to: toRel(plan.to, dataRoot),
      originalContent: content,
    });
  }
  const refUpdateSnapshots: Array<{ filePath: string; originalContent: string; newContent: string }> = [];
  for (const [absPath, entry] of refScan.perFileUpdate) {
    refUpdateSnapshots.push({
      filePath: toRel(absPath, dataRoot),
      originalContent: entry.original,
      newContent: entry.updated,
    });
  }

  // ── 実行 (失敗時 rollback) ────────────────────────────────
  const writtenFiles: string[] = []; // rollback 対象 (新規 write した path)
  const restoreActions: Array<{ absPath: string; originalContent: string }> = [];

  try {
    // (a) 参照側 update を全 file write
    for (const [absPath, entry] of refScan.perFileUpdate) {
      restoreActions.push({ absPath, originalContent: entry.original });
      await writeFileContent(absPath, entry.updated);
    }

    // (b) 主ファイル新規 path に write (oldId → newId に rewrite した copy で)
    //     uuid は preserve される必要があるが、preserveOrAssignUuid は新規ファイルなら supplied を採用するので OK
    //     ProcessFlow と通常 entity の write 関数を使い分け、`id` field を newId に書き換えた data を渡す
    const rewrittenPrimary = withRewrittenId(entityType, primaryData, newId);

    // 主ファイル new write は writeX 関数経由で行う (uuid preserve + schema annotate + path containment)
    await writeEntityById(entityType, newId, rewrittenPrimary, root);
    writtenFiles.push(path.join(dataRoot, ENTITY_PRIMARY_DIR[entityType], `${newId}.json`));

    // ProcessFlow 主ファイルが legacy actions/ 配下にあった場合は writeProcessFlow が legacy 側に
    // 新規 file を作る挙動 (新 id 不在のため current path に新規) を取るため、ファイル位置確認
    // → writeProcessFlow は両 candidate を見て不在なら current path に書く実装なので OK (新規 = current 側)

    // screen / pageLayout の design.json は writeX が触らないため、別途 raw copy で対応
    if (entityType === "screen") {
      const oldDesignAbs = path.join(dataRoot, "screens", `${oldId}.design.json`);
      const newDesignAbs = path.join(dataRoot, "screens", `${newId}.design.json`);
      const oldDesignContent = await readFileContentOrNull(oldDesignAbs);
      if (oldDesignContent !== null) {
        await writeFileContent(newDesignAbs, oldDesignContent);
        writtenFiles.push(newDesignAbs);
      }
    } else if (entityType === "pageLayout") {
      const oldDesignAbs = path.join(dataRoot, "page-layouts", `${oldId}.design.json`);
      const newDesignAbs = path.join(dataRoot, "page-layouts", `${newId}.design.json`);
      const oldDesignContent = await readFileContentOrNull(oldDesignAbs);
      if (oldDesignContent !== null) {
        // writePageLayoutDesign は dir mkdir + writeJSON を行うが、ここでは raw content 保持優先
        await writeFileContent(newDesignAbs, oldDesignContent);
        writtenFiles.push(newDesignAbs);
      }
    }

    // (c) uuid 不変 assert: 新 path から再 read して uuid を確認
    const reread = await readEntityRaw(entityType, newId, root);
    const newUuid = extractUuid(entityType, reread);
    if (newUuid !== expectedUuid) {
      throw new Error(
        `uuid immutability violation: rename 後の uuid (${newUuid}) が元の uuid (${expectedUuid}) と不一致。`,
      );
    }

    // (d) 旧ファイル削除 — ここまで成功なら旧ファイルは不要
    for (const plan of filePlans) {
      await tryUnlink(plan.from);
    }
    // screen / pageLayout の旧 design.json も削除
    if (entityType === "screen") {
      await tryUnlink(path.join(dataRoot, "screens", `${oldId}.design.json`));
    } else if (entityType === "pageLayout") {
      await tryUnlink(path.join(dataRoot, "page-layouts", `${oldId}.design.json`));
    }
  } catch (err) {
    // rollback: 新規 write した file を消す + 参照側を元に戻す
    for (const abs of writtenFiles) {
      await tryUnlink(abs);
    }
    for (const r of restoreActions) {
      try { await writeFileContent(r.absPath, r.originalContent); } catch { /* best effort */ }
    }
    throw err;
  }

  // PreviewResult 再構築 (実行後の正常 case を返す)
  const preview: PreviewResult = {
    entityType, oldId, newId,
    uniqueOk: true, oldExists: true, lockedByOther: false,
    fileRenames: fileRenameSnapshots.map((s) => ({ from: s.from, to: s.to })),
    refUpdates: refScan.locations,
    totalRefs: refScan.locations.length,
  };

  // ── snapshot に design.json も含めて undo を完備 ──
  // filePlans は design.json 含むため fileRenameSnapshots と整合
  const operation: RenameOperation = {
    operationId: crypto.randomUUID(),
    entityType, oldId, newId,
    uuid: expectedUuid,
    ts: Date.now(),
    fileRenames: fileRenameSnapshots,
    refUpdates: refUpdateSnapshots,
  };
  pushUndo(root, operation);

  return { operation, preview };
}

/**
 * 直近の rename 1 件を完全 revert する (5 分 TTL 内 / operationId 一致時のみ)。
 *
 * - newId 側の主ファイル削除 → oldId 側の原 content を rewrite
 * - 参照側 entity を rename 前の content (snapshot) で上書き
 *
 * 戻り値: 復元した file 数 (主 + design + ref 側 合計)。
 */
export async function undoEntityRename(
  operationId: string, root: string,
): Promise<{ restoredFiles: number }> {
  const op = popUndo(root, operationId);
  if (!op) {
    throw new Error(`Undo 対象が見つかりません (operationId=${operationId})。TTL 5 分を超えた / 他 rename で上書きされた可能性。`);
  }

  const dataRoot = await resolveDataRoot(root);
  let restored = 0;

  // (a) ref 側 file を snapshot の original で完全上書き
  for (const r of op.refUpdates) {
    const absPath = path.join(dataRoot, r.filePath);
    await writeFileContent(absPath, r.originalContent);
    restored++;
  }

  // (b) 主ファイル + design ファイルを oldId 側に restore
  for (const f of op.fileRenames) {
    const fromAbs = path.join(dataRoot, f.from); // 元の path (oldId 側)
    const toAbs   = path.join(dataRoot, f.to);   // rename 後の path (newId 側)
    await writeFileContent(fromAbs, f.originalContent);
    // newId 側 file を削除
    await tryUnlink(toAbs);
    restored++;
  }

  return { restoredFiles: restored };
}

// ── internal: entity 種別ごとの write ───────────────────────────────────────

async function writeEntityById(
  entityType: RenameEntityType, id: string, data: unknown, root: string,
): Promise<void> {
  switch (entityType) {
    case "screen":         return writeScreenEntity(id, data, root);
    case "table":          return writeTable(id, data, root);
    case "processFlow":    return writeProcessFlow(id, data, root);
    case "sequence":       return writeSequence(id, data, root);
    case "view":           return writeView(id, data, root);
    case "viewDefinition": return writeViewDefinition(id, data, root);
    case "pageLayout":     return writePageLayout(id, data, root);
  }
}

// Note: design.json (screen / pageLayout) と harmony.json / screen-flow-positions.json
// の rewrite は all (writeFileContent) の raw fs path 経由で行う。projectStorage の
// dedicated writer (writePageLayoutDesign / writeProject / writeScreenFlowPositions) は
// schema annotation や mtime mark 等の副作用を伴うため、byte-identical 保持 + rollback
// 完全性のために本 module 内では raw write/restore のみ用いる。
