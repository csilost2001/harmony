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
  readErLayout,
  erLayoutFile,
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

/**
 * Phase G M-1 (Codex round 2 独立レビュー): 別 entity type に同名 entity が存在し、かつ
 * `View.dependencies[]` (untyped EntityId 配列、Table or View どちらでも可) で参照されている
 * ambiguous なケースを表す。silent data corruption を防ぐため preview / execute を block する。
 */
export interface AmbiguousDependencyRef {
  /** ambiguous dependency を抱える View の id */
  viewId: string;
  /** 対象 entity と同名の別 entity type ("table" or "view") */
  conflictingEntityType: RenameEntityType;
  /** filePath (dataRoot 相対) */
  filePath: string;
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
  /**
   * Phase G M-1 (Codex round 2): cross-type ambiguous dependency が検出された View 一覧。
   * 空配列なら通常実行可。空でない場合は rename を block (execute 側で throw)。
   * UI は本配列を error として表示し、設計者に「先に同名の別 entity を rename / 削除」を促す。
   */
  ambiguousDependencies: AmbiguousDependencyRef[];
  /**
   * Phase G M-4 (Codex round 2): 参照側 entity を編集中の active EditSession が存在する場合に列挙。
   * 1 件でも入っていれば rename を block (execute 側で throw)。後続 save で rename 済 ref を
   * 巻き戻して orphan 再生成するリスクを防ぐ。
   */
  concurrentEditRefs: Array<{ entityKind: string; entityId: string; sessionId: string }>;
  /**
   * Phase H N-2 (Opus round 2 独立レビュー): rename を block せず通せるが設計者へ通知すべき
   * 状況のメッセージ列。execute はこれを理由に block しない (情報通知のみ)。
   *
   * 例:
   * - その他の非 fatal な scan warning (将来追加余地)
   *
   * Phase I round 3+4 で `screen-flow-positions` / `er-layout` の positions oldId+newId
   * 同時存在は blocker に格上げ (`positionsCollisions` 専用 field、execute throw)。
   * 旧 `warnings` 経路に乗せていた positions collision メッセージは `positionsCollisions`
   * に分離されたため、本配列には現状他の通知のみが入る (将来拡張用)。
   *
   * UI は本配列を warning として preview / 実行後 toast に表示する。
   */
  warnings: string[];
  /**
   * Phase I round 3+4 Must-fix D (3 AI 全員指摘): positions KEY (object key) に oldId と
   * newId が同時存在する場合、旧実装は KEY 移行を skip して warning 扱いで rename 成功させ
   * ていた。これは screen-flow-positions / er-layout で本来移行すべき座標 entry を orphan
   * 化させる data corruption リスクのため、blocker に格上げする。
   *
   * 空配列なら通常実行可。空でない場合は rename を block (execute 側で throw、UI dialog
   * で execute button disable + error 表示)。設計者は先に stale な positions entry を
   * 手動で除去してから rename を再実行する必要がある。
   */
  positionsCollisions: string[];
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
  /**
   * Phase G M-4 (Codex round 2): rename は ref scan で更新する参照側 entity (ProcessFlow /
   * Screen / View / Table / PageLayout / ViewDefinition 等) を committed file に直接 write
   * するため、別 session が当該 ref 側 entity を Edit 中だと後続 save で rename 済 ref を
   * 旧 id に巻き戻して orphan を再生成する。
   *
   * 本 callback は (entityKind, entityId) を受け取り、active Edit session 一覧を返す。
   * 1 件でも返れば preview に concurrentEditRefs として記録 + execute は throw する。
   * 省略時 (test path / standalone path) は ref-side lock check skip。
   *
   * entityKind は EditSessionStore の DraftResourceType 文字列で来るが、refScan が出力する
   * entityKind は本 module の internal 名 ("processFlow" / "viewDefinition" 等) のため、
   * caller (handler) 側で kebab 形式に変換して bridge を呼ぶ責務を持つ。
   */
  fetchEditSessionsForRef?: (
    entityKind: string,
    entityId: string,
  ) => ReadonlyArray<EditSessionLike>;
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
 *
 * M-2/M-3 (Opus 独立レビュー): 各種スキーマ上の追加 ref field を追補:
 * - table: sourceTableId (view-definition.v3 §25), targetTableId (er-layout.v3 §41),
 *   referencedTableId (table.v3 §195 FK)
 * - screen: sourceScreenId / targetScreenId (harmony.v3 §290 ScreenTransitions、
 *   process-flow.v3 §1244 ScreenTransitionStep)
 *
 * Phase F M-1 (Codex 独立レビュー): ProcessFlow を参照する追加 field:
 * - handlerFlowId (screen-item.v3 §114 ScreenItemEvent — 画面項目 click 等の handler)
 * - refId (process-flow.v3 §1193 CommonProcessStep — 他 ProcessFlow を呼ぶ step)
 * 同一 PF を `processFlowId` と `handlerFlowId` 両方で参照する fixture (retail global-header) あり。
 *
 * Phase H N-1 (Opus round 2 独立レビュー): screen 側から `initialScreen` を削除。
 * `harmony.v3.schema.json` top-level は `additionalProperties: false` で `initialScreen` を
 * 許容しないため、実 harmony.json には present しない (dead code、`grep initialScreen
 * schemas/v3/harmony.v3.schema.json` で 0 hit)。test fixture のみで artificial に seed
 * していたため、misleading な map entry を排除。
 */
const SCALAR_REF_FIELDS: Record<RenameEntityType, string[]> = {
  screen: ["screenId", "sourceScreenId", "targetScreenId"],
  table: ["tableId", "sourceTableId", "targetTableId", "referencedTableId"],
  processFlow: ["processFlowId", "handlerFlowId", "refId"],
  sequence: ["sequenceId"],
  view: ["viewId"],
  viewDefinition: ["viewDefinitionId"],
  pageLayout: ["pageLayoutId"],
};

/**
 * 複合 ref 構造 (entity 種別 → 親 field 名 → 内部 sub-field 名)。
 *
 * 例: rename target が "table" → 親 "tableColumnRef" → sub "tableId" を更新。
 *
 * S-1 (Opus 独立レビュー): 実 schema (`schemas/v3/`) 全 grep を根拠に整理:
 * - `screenItemRef` (common.v3.schema.json §408 ScreenItemRef): 実在
 * - `tableColumnRef` (view-definition.v3.schema.json §197 + 他): 実在
 * - `viewColumnRef` / `processFlowResponseRef` / `actionRef` / `actionStepRef`:
 *   全 schema で 0 hit のため削除 (dead code、misleading)
 */
const COMPOSITE_REF_FIELDS: Record<RenameEntityType, Array<{ parent: string; sub: string }>> = {
  screen: [{ parent: "screenItemRef", sub: "screenId" }],
  table: [{ parent: "tableColumnRef", sub: "tableId" }],
  processFlow: [],
  sequence: [],
  view: [],
  viewDefinition: [],
  pageLayout: [],
};

/**
 * array<EntityId> 形の ref field (entity 種別 → 親 field 名)。
 *
 * Phase F M-3 (Codex 独立レビュー): walker は scalar string match のみだったため
 * array<string> 形の ref を取りこぼしていた。schema に基づき:
 * - View.dependencies[]: items=EntityId (Table or View どちらの id も入る、view.v3 §27)
 * - ProcessFlow.tableIds[] (CdcStep): items=EntityId (Table のみ、process-flow.v3 §1722)
 *
 * 当該 array に oldId と一致する string が含まれる場合、新 id に置換する。
 */
const ARRAY_REF_FIELDS: Record<RenameEntityType, string[]> = {
  screen: [],
  table: ["dependencies", "tableIds"],
  processFlow: [],
  sequence: [],
  view: ["dependencies"],
  viewDefinition: [],
  pageLayout: [],
};

/**
 * object map で値が EntityId の ref field (entity 種別 → 親 field 名)。
 *
 * Phase F M-3 (Codex 独立レビュー): walker は scalar string match のみだったため
 * map value 形の ref を取りこぼしていた。schema に基づき:
 * - PageLayout.assignments: {regionName: EntityId} (gadget Screen を参照、page-layout.v3 §26)
 *
 * 当該 map の value 群を走査し、oldId と一致する value を新 id に置換する。
 */
const MAP_VALUE_REF_FIELDS: Record<RenameEntityType, string[]> = {
  screen: ["assignments"],
  table: [],
  processFlow: [],
  sequence: [],
  view: [],
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
  arrayFields: Set<string>;
  mapValueFields: Set<string>;
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
        // N-3 (Opus 独立レビュー #1298): 旧実装は composite ヒット後に `walkAndReplace(newInner, ...)`
        // を呼んでいたが、sub field 値は既に newId に置換済で scalar match を再発火させる余地は無く
        // (oldId とは一致しない)、他 field 走査は外側 entries loop で実施されないため再帰は redundant。
        // 直接 `{ ...inner, [sub]: newId }` を結果に格納する。
        opts.onMatch(`${childPointer}/${escapeJsonPointerToken(composite.sub)}`, opts.oldId);
        result[key] = { ...inner, [composite.sub]: opts.newId };
        continue;
      }
    }

    // Phase F M-3 (Codex): array<EntityId> 形の ref (View.dependencies / CdcStep.tableIds)
    if (opts.arrayFields.has(key) && Array.isArray(v)) {
      let arrayMutated = false;
      const newArr = v.map((item, i) => {
        if (typeof item === "string" && item === opts.oldId) {
          opts.onMatch(`${childPointer}/${i}`, opts.oldId);
          arrayMutated = true;
          return opts.newId;
        }
        return item;
      });
      // 配列内に sub-object が混在するケースは想定外 (schema 上 items=EntityId のみ) だが、
      // 安全策として置換が無ければ通常再帰で内部 sub-object を走査する余地を残す。
      if (arrayMutated) {
        result[key] = newArr;
        continue;
      }
    }

    // Phase F M-3 (Codex): object map で value が EntityId (PageLayout.assignments)
    if (opts.mapValueFields.has(key) && v && typeof v === "object" && !Array.isArray(v)) {
      const innerMap = v as Record<string, unknown>;
      let mapMutated = false;
      const newMap: Record<string, unknown> = {};
      for (const [mk, mv] of Object.entries(innerMap)) {
        if (typeof mv === "string" && mv === opts.oldId) {
          opts.onMatch(`${childPointer}/${escapeJsonPointerToken(mk)}`, opts.oldId);
          newMap[mk] = opts.newId;
          mapMutated = true;
        } else {
          newMap[mk] = mv;
        }
      }
      if (mapMutated) {
        result[key] = newMap;
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

/**
 * 旧ファイル削除 (strict)。Phase F M-6 (Codex 独立レビュー)。
 *
 * ENOENT (既に削除済 / 存在しない) のみ tolerant、それ以外の error (permission denied / I/O error 等) は
 * throw する。commit phase の旧ファイル削除に使用し、削除失敗時は同一 uuid file が複数残らないよう
 * 上位 catch で snapshot から完全 restore する。
 *
 * Test seam: `_setStrictUnlinkOverrideForTest()` で fault injection 可能 (`*  as fs` の namespace import
 * は vi.spyOn で差し替えできないため、module-level の差し替え seam を用意する)。
 */
let _strictUnlinkOverride: ((absPath: string) => Promise<void>) | null = null;

async function strictUnlink(absPath: string): Promise<void> {
  if (_strictUnlinkOverride) {
    return _strictUnlinkOverride(absPath);
  }
  try {
    await fs.unlink(absPath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return; // 既に存在しない: tolerant
    throw e;
  }
}

/** test-only: strictUnlink を fault inject 用に差し替える (test 終了時に null で reset 必須) */
export function _setStrictUnlinkOverrideForTest(
  override: ((absPath: string) => Promise<void>) | null,
): void {
  _strictUnlinkOverride = override;
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

/** entity の id を newId に書き換えた copy を返す。
 *
 * - ProcessFlow は **meta.id** を持つ (top-level id は schema 違反 — process-flow.v3.schema.json
 *   は `additionalProperties: false` で root を `meta` / `actions` 等に限定)。
 *   M-1/M-5 (Opus 独立レビュー): top-level `id` を付けず、meta.id を常時 set する。
 * - 他 6 entity (Screen / Table / Sequence / View / ViewDefinition / PageLayout) は
 *   EntityMeta を直接展開して top-level に `id` を持つ。
 */
function withRewrittenId(entityType: RenameEntityType, data: unknown, newId: string): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  if (entityType === "processFlow") {
    const baseMeta = obj.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)
      ? (obj.meta as Record<string, unknown>) : null;
    const meta = baseMeta ? { ...baseMeta, id: newId } : { id: newId };
    // top-level id を意図せず混入させない (process-flow.v3 schema: additionalProperties: false)
    const { id: _droppedTopLevelId, ...rest } = obj;
    void _droppedTopLevelId;
    return { ...rest, meta };
  }
  return { ...obj, id: newId };
}

/**
 * 主 entity 内の **自己参照** (例: Table の constraints[].referencedTableId が自己 id)
 * を newId に書き換えた copy を返す。Phase F M-4 (Codex 独立レビュー)。
 *
 * `withRewrittenId` は identity field (`id` / `meta.id`) のみ書き換え、自己 ref は触らない。
 * その後本関数で同じ rename 規約 (SCALAR / COMPOSITE / ARRAY / MAP) を適用して自己参照も rewrite する。
 *
 * 注: identity field は既に newId に確定しているため、walker (value === oldId のみ match) で
 * 二重置換されない。自己参照 (例: referencedTableId === oldId) のみが置換される。
 *
 * `pageLayout` の `processFlowId` (kind=pageLayout が ProcessFlow を参照) のような entity 跨り
 * 参照は ARRAY/MAP/COMPOSITE/SCALAR 全部 entity rename 対象 entityType に紐付くため、自己 entity 型
 * の rename ではマッチしない。
 */
function rewriteSelfRefsInPrimary(
  entityType: RenameEntityType, data: unknown, oldId: string, newId: string,
): { rewritten: unknown; hits: number } {
  let hits = 0;
  const rewritten = walkAndReplace(data, "", {
    scalarFields: new Set(SCALAR_REF_FIELDS[entityType]),
    compositeFields: COMPOSITE_REF_FIELDS[entityType],
    arrayFields: new Set(ARRAY_REF_FIELDS[entityType]),
    mapValueFields: new Set(MAP_VALUE_REF_FIELDS[entityType]),
    oldId,
    newId,
    onMatch: () => { hits++; },
  });
  return { rewritten, hits };
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
    //
    // Phase G M-2 (Codex round 2): legacy rename は to を **canonical 移行** とする。
    // 理由: writeProcessFlow(newId, ...) は両 candidate 不在 → canonical (`process-flows/`)
    // に書く実装のため、to を `actions/<newId>.json` のままにすると plan と実 write 先が
    // 乖離して undo orphan を生む。canonical 化により plan / 実 write / undo restore が整合。
    // undo 時は actions/<oldId>.json に restore + process-flows/<newId>.json を unlink する。
    const legacyDir = path.join(dataRoot, PROCESS_FLOW_LEGACY_DIR);
    const legacyFrom = path.join(legacyDir, `${oldId}.json`);
    if (await fileExists(legacyFrom)) {
      // currentFrom 同名が両方ある場合は currentFrom rename plan が既に同 to を持つため、
      // legacy → canonical の to は currentFrom と衝突。実運用ではどちらか片方のみ存在する
      // (writeProcessFlow が既存 path に書くため) が、defense-in-depth で同 to の場合は
      // legacy plan 側を skip して current 経路に委ねる。
      const canonicalTo = path.join(dir, `${newId}.json`);
      const alreadyPlanned = plans.some((p) => p.to === canonicalTo);
      if (!alreadyPlanned) {
        plans.push({ from: legacyFrom, to: canonicalTo });
      }
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
  // Phase I round 3+4 Must-fix F (Codex round 4 M-5): Puck screen は payload を
  // `screens/<screenId>/puck-data.json` (subdirectory) に持つ。旧実装はこれを rename plan に
  // 含めず、Puck screen を rename すると payload が old directory に残り新 id から不可視になる
  // (data corruption)。schema 上 editorKind は固定なので screen entity の editorKind を判定して
  // 該当 case のみ追加する。
  if (entityType === "screen") {
    const puckFrom = path.join(dir, oldId, "puck-data.json");
    if (await fileExists(puckFrom)) {
      plans.push({ from: puckFrom, to: path.join(dir, newId, "puck-data.json") });
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
  /**
   * Phase H N-2 (Opus round 2): scan 中に発生した非 fatal な異常 (stale data 等) のメッセージ。
   * preview / 実行を block しないが、設計者へ通知すべき情報。
   */
  warnings: string[];
  /**
   * Phase I round 3+4 Must-fix D: positions oldId+newId 同時存在 (blocker)。
   * scanAllRefs 側で specialized handler (rewriteScreenFlowPositionsKeys /
   * rewriteErLayoutPositionsKeys) から onCollision callback 経由で集積。
   */
  positionsCollisions: string[];
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
  const arrayFields = new Set(ARRAY_REF_FIELDS[entityType]);
  const mapValueFields = new Set(MAP_VALUE_REF_FIELDS[entityType]);

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

  // 7. harmony.json (screen rename で screenTransitions / entities.screens[].id 参照)
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

  // 9. er-layout.json (Phase F M-2): Table rename で positions[KEY] / logicalRelations 参照
  //    Codex 独立レビュー指摘: SCALAR_REF_FIELDS に targetTableId を追加しただけでは scan source
  //    に er-layout.json が含まれず実走査されない。logicalRelations の sourceTableId/targetTableId
  //    は汎用 walker で拾えるが、positions の object KEY は専用 handler が必要。
  const erLayout = await readErLayout(root);
  if (erLayout) {
    sources.push({
      entityKind: "erLayout", entityId: "er-layout.json",
      absPath: erLayoutFile(dataRoot),
      data: erLayout,
    });
  }

  // 10. generic-definitions/<kind>/*.json (Phase I round 3+4 Must-fix E、Antigravity M-6)
  //     `relations[].ref` に top-level entity への path 形式 ref が記述される (例:
  //     "tables/transactions", "screens/dashboard", "process-flows/createTransaction" 等)。
  //     rename 時にこれを更新しないと orphan ref が永続化されるため、ここで scan source に含める。
  //     generic-definitions 自体の rename は I-6 scope 外 (top-level 7 entity rename のみ)。
  const gdDir = path.join(dataRoot, "generic-definitions");
  try {
    const kindDirs = await fs.readdir(gdDir, { withFileTypes: true });
    for (const kindEntry of kindDirs) {
      if (!kindEntry.isDirectory()) continue;
      const kind = kindEntry.name;
      const kindAbs = path.join(gdDir, kind);
      let files: string[];
      try {
        files = await fs.readdir(kindAbs);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const absPath = path.join(kindAbs, f);
        let data: unknown = null;
        try {
          const content = await fs.readFile(absPath, "utf-8");
          data = JSON.parse(content);
        } catch {
          continue; // 壊れた JSON は skip
        }
        if (!data || typeof data !== "object") continue;
        const name = f.replace(/\.json$/, "");
        sources.push({
          entityKind: "genericDefinition",
          entityId: `${kind}/${name}`,
          absPath,
          data,
        });
      }
    }
  } catch {
    // generic-definitions/ 不在は通常 case (workspace 初期化直後等) — 例外で 0 source 化のみ
  }

  // ── walk + update plan 作成 ────────────────────────────────
  const locations: RefLocation[] = [];
  const perFileUpdate = new Map<string, { original: string; updated: string; updatedData: unknown }>();
  // Phase H N-2 (Opus round 2): scan 中の非 fatal な異常を集積。
  const warnings: string[] = [];
  const onScanWarn = (msg: string) => warnings.push(msg);
  // Phase I round 3+4 Must-fix D: positions oldId+newId 同時存在は blocker として別 channel に分離。
  const positionsCollisions: string[] = [];
  const onCollision = (msg: string) => positionsCollisions.push(msg);

  for (const src of sources) {
    // Phase F M-4 (Codex 独立レビュー): 旧実装は rename 対象 entity 自身を ref scan から常に
    // 除外していたため、自己参照 (例: Table の constraints[].referencedTableId === 自己 id、
    // self-referential ProcessFlow / Screen) が更新されず orphan ref を残していた。
    // 主 entity の identity (`id` / `meta.id`) は `withRewrittenId` で別途書換えるが、
    // それ以外の自己 ref は walker で拾わせるため、本 src skip は廃止した。
    //
    // 識別の二重置換は発生しない:
    //   - `withRewrittenId` で identity を `newId` に確定後、本 walker は scalarFields に対し
    //     value === oldId のみマッチするため、置換済 identity (=newId) は再 hit しない。
    //   - 自己参照 ref 値 (constraints[].referencedTableId 等) は oldId のままなのでマッチする。
    //
    // ただし、主ファイル自体は filePlans (rename 対象、新 path に書く) で扱うため、ref scan で
    // perFileUpdate には載せない (= 旧 path に upload しない)。代わりに「主 entity の自己 ref を
    // 含む新 content」を `renameEntityId` 本体で `withRewrittenId` 後にこの walker で再走査して
    // 構築する。ここでは「他 entity から自己 entity への参照を漏らさず拾う」目的で skip を解除。
    //
    // ファイル位置で言うと、主ファイルは「rename 対象 entity 自身」(`src.entityKind === entityType
    // && src.entityId === oldId`) で、そのファイルへの書き込みは `writeEntityById(newId, ...)`
    // が新 path に行う。本 walker でこれを `perFileUpdate.set(主ファイル absPath, ...)` してしまうと
    // 旧 path に対して書き込もうとして衝突するため、絶対 path 一致での skip 条件にする:
    const isPrimaryFile = src.entityKind === entityType && src.entityId === oldId;

    // Phase F M-4 (Codex): screen-flow-positions / harmony.json / er-layout.json は walker の
    // VALUE 一致ロジックでは捕捉できない (object KEY / entry 自身の id field) ため、専用 handler
    // で先に走査 + plan 化する。汎用 walker は変更しない (KEY 走査の generic 化は scope 外)。
    let specializedUpdated: unknown = src.data;
    let specializedHits = 0;
    const onSpecialMatch = (jsonPointer: string) => {
      specializedHits++;
      locations.push({
        filePath: toRel(src.absPath, dataRoot),
        entityKind: src.entityKind,
        entityId: src.entityId,
        jsonPointer,
        oldValue: oldId,
      });
    };
    if (src.entityKind === "screenFlowPositions" && entityType === "screen") {
      // Phase I round 3+4 Must-fix D: positions collision は blocker channel に分離
      specializedUpdated = rewriteScreenFlowPositionsKeys(
        src.data, oldId, newId, onSpecialMatch, onCollision,
      );
    } else if (src.entityKind === "project") {
      specializedUpdated = rewriteHarmonyEntitiesId(
        src.data, entityType, oldId, newId, onSpecialMatch,
      );
    } else if (src.entityKind === "erLayout" && entityType === "table") {
      // Phase F M-2: er-layout.json の positions[oldId] (object KEY) を新 id に migrate。
      // logicalRelations[].sourceTableId/targetTableId は SCALAR_REF_FIELDS で拾われる。
      // Phase I round 3+4 Must-fix D: positions collision は blocker channel に分離
      specializedUpdated = rewriteErLayoutPositionsKeys(
        src.data, oldId, newId, onSpecialMatch, onCollision,
      );
    }
    // Phase I round 3+4 Must-fix E (Antigravity M-6): generic-definitions の path 形式 ref も走査
    if (src.entityKind === "genericDefinition") {
      specializedUpdated = rewriteGenericDefinitionPathRefs(
        specializedUpdated, entityType, oldId, newId, onSpecialMatch,
      );
    }
    // onScanWarn は将来の非 fatal warning 拡張余地のため引き続き保持 (現状未使用)
    void onScanWarn;

    // 汎用 walker (scalar / composite ref VALUE 一致 + array / map value)
    let hitCount = 0;
    const updated = walkAndReplace(specializedUpdated, "", {
      scalarFields, compositeFields, arrayFields, mapValueFields, oldId, newId,
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
    const totalHits = hitCount + specializedHits;
    if (totalHits > 0) {
      // 主ファイルは新 path に書き出されるため perFileUpdate には載せない (locations のみ反映)
      if (isPrimaryFile) continue;
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

  return { locations, perFileUpdate, warnings, positionsCollisions };
}

// ── specialized handlers (M-4): KEY / entry self-id ─────────────────────────

/** entityType → harmony.json `entities.<kind>[]` array key 名 mapping */
const ENTITY_TYPE_TO_HARMONY_KIND_KEY: Record<RenameEntityType, string> = {
  screen: "screens",
  table: "tables",
  processFlow: "processFlows",
  sequence: "sequences",
  view: "views",
  viewDefinition: "viewDefinitions",
  pageLayout: "pageLayouts",
};

/**
 * harmony.json の `entities.<kind>[].id` を新 id に書き換える (KEY ではなく entry 自身の id field)。
 *
 * 汎用 walker は scalar `id` field を rename 対象 entity に紐付けて識別できないため、本専用 handler
 * で `entities.<kind>` 配下に限定して `id === oldId` を検出 + 置換する。
 *
 * 注: ScreenTransition の `sourceScreenId` / `targetScreenId` は SCALAR_REF_FIELDS で
 * 既に拾われるため、ここでは扱わない (汎用 walker 側で処理)。
 */
function rewriteHarmonyEntitiesId(
  data: unknown,
  entityType: RenameEntityType,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const entities = obj.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) return data;
  const ent = entities as Record<string, unknown>;
  const kindKey = ENTITY_TYPE_TO_HARMONY_KIND_KEY[entityType];
  const arr = ent[kindKey];
  if (!Array.isArray(arr)) return data;

  let mutated = false;
  const newArr = arr.map((entry, i) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      if (e.id === oldId) {
        mutated = true;
        onMatch(`/entities/${escapeJsonPointerToken(kindKey)}/${i}/id`);
        return { ...e, id: newId };
      }
    }
    return entry;
  });

  if (!mutated) return data;
  return { ...obj, entities: { ...ent, [kindKey]: newArr } };
}

/**
 * screen-flow-positions.json の `positions[oldId]` (object KEY) と `positions[oldId].* ` の
 * 値を新 id に migrate する。Screen rename 専用 (他 entity は positions に含まれない)。
 *
 * KEY 走査のため walker (VALUE 一致のみ) では捕捉できない。
 */
function rewriteScreenFlowPositionsKeys(
  data: unknown,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
  onCollision?: (message: string) => void,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const positions = obj.positions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) return data;
  const p = positions as Record<string, unknown>;
  if (!(oldId in p)) return data;
  // newId 既存衝突は preview の uniqueOk で検出済 (同 entity 内 unique 保証)
  // ただし screen-flow-positions は ScreenGroup id も同 propertyNames に並ぶため、念のため検査
  if (newId in p) {
    // 既に存在 — Phase I round 3+4 Must-fix D: 旧実装は silent skip + warning だったが、
    // 当該 entry の座標が orphan 化する data corruption リスクを優先し blocker に格上げ。
    // 設計者は先に stale entry を手動で除去してから rename 再実行する責務を負う。
    onCollision?.(
      `screen-flow-positions.json: positions に旧 id "${oldId}" と新 id "${newId}" が同時存在 — ` +
      `KEY 衝突。先に stale entry "${oldId}" または "${newId}" を手動で削除してください。`,
    );
    return data;
  }
  onMatch(`/positions/${escapeJsonPointerToken(oldId)}`);
  const { [oldId]: moved, ...rest } = p;
  return { ...obj, positions: { ...rest, [newId]: moved } };
}

/**
 * er-layout.json の `positions[oldId]` (object KEY) を新 id に migrate する。
 * Phase F M-2 (Codex 独立レビュー)。Table rename 専用。
 *
 * `logicalRelations[].sourceTableId` / `.targetTableId` は SCALAR_REF_FIELDS で汎用 walker が
 * 拾うため、ここでは扱わない (object KEY のみ専用 handler)。
 */
function rewriteErLayoutPositionsKeys(
  data: unknown,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
  onCollision?: (message: string) => void,
): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  const positions = obj.positions;
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) return data;
  const p = positions as Record<string, unknown>;
  if (!(oldId in p)) return data;
  if (newId in p) {
    // Phase I round 3+4 Must-fix D: 旧実装は silent skip + warning だったが、blocker に格上げ。
    // 当該 entry の座標が orphan 化する data corruption リスクを優先する。
    onCollision?.(
      `er-layout.json: positions に旧 id "${oldId}" と新 id "${newId}" が同時存在 — ` +
      `KEY 衝突。先に stale entry "${oldId}" または "${newId}" を手動で削除してください。`,
    );
    return data;
  }
  onMatch(`/positions/${escapeJsonPointerToken(oldId)}`);
  const { [oldId]: moved, ...rest } = p;
  return { ...obj, positions: { ...rest, [newId]: moved } };
}

/**
 * Phase I round 3+4 Must-fix E (Antigravity M-6): generic-definitions の `ref` field 内に
 * 記述される top-level entity への path 形式参照 (例: "tables/transactions",
 * "screens/dashboard") を rename target に合わせて更新する。
 *
 * 対応形式: `<entity-primary-dir>/<oldId>` のみ (exact match)。
 * generic-definitions 内の `generic-definitions/<kind>/<name>` 形式自己参照は
 * top-level 7 entity rename の対象外なので touch しない (本 ISSUE は top-level entity 限定)。
 *
 * walker は再帰的に object を走査し、key === "ref" かつ value === expected path string の
 * 場合のみ置換する。複合 ref (object 内 sub-ref 等) や別 field 名は touch しない。
 */
function rewriteGenericDefinitionPathRefs(
  data: unknown,
  entityType: RenameEntityType,
  oldId: string,
  newId: string,
  onMatch: (jsonPointer: string) => void,
): unknown {
  const dir = ENTITY_PRIMARY_DIR[entityType];
  const oldRef = `${dir}/${oldId}`;
  const newRef = `${dir}/${newId}`;

  function walk(node: unknown, pointer: string): unknown {
    if (node === null || node === undefined || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      return node.map((v, i) => walk(v, `${pointer}/${i}`));
    }
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      const childPointer = `${pointer}/${escapeJsonPointerToken(key)}`;
      if (key === "ref" && typeof v === "string" && v === oldRef) {
        onMatch(childPointer);
        out[key] = newRef;
        continue;
      }
      out[key] = walk(v, childPointer);
    }
    return out;
  }

  return walk(data, "");
}

// ── Phase G M-1 (Codex round 2): cross-type ambiguous dependency 検出 ─────────

/**
 * `View.dependencies[]` (items=EntityId、Table or View どちらでも可) で oldId を参照している
 * View について、rename 対象 entityType (table | view) **とは別の** entityType に同名 entity
 * が存在するかを検査する。
 *
 * RFC #1284 は EntityId を entity type 内 unique と定義しているため、Table `sales` と
 * View `sales` の同名共存は valid。しかし `View.dependencies[]` は untyped EntityId 配列で
 * どちらの type を指しているか schema 上判別できないため、Table rename が View 依存を誤更新
 * する可能性がある (silent data corruption)。
 *
 * 本関数は ambiguous な参照を持つ View の一覧を返し、preview / execute で block する材料とする。
 */
async function detectAmbiguousDependencies(
  entityType: RenameEntityType,
  oldId: string,
  root: string,
  dataRoot: string,
): Promise<AmbiguousDependencyRef[]> {
  // 対象は Table または View rename のみ (他 entity type は dependencies[] の対象でない)
  if (entityType !== "table" && entityType !== "view") return [];

  // 「別 entity type」に同名 entity が存在するか
  const otherType: RenameEntityType = entityType === "table" ? "view" : "table";
  const otherIds = await listExistingEntityIds(otherType, root);
  if (!otherIds.includes(oldId)) return []; // 同名 entity が他 type に無ければ ambiguous でない

  // 全 View を走査し、dependencies[] に oldId を含むものを探す
  const views = (await listAllViews(root)) as Array<Record<string, unknown>>;
  const results: AmbiguousDependencyRef[] = [];
  for (const v of views) {
    const vid = typeof v.id === "string" ? v.id : null;
    if (!vid) continue;
    const deps = v.dependencies;
    if (!Array.isArray(deps)) continue;
    if (!deps.some((d) => typeof d === "string" && d === oldId)) continue;
    const absPath = path.join(dataRoot, "views", `${vid}.json`);
    results.push({
      viewId: vid,
      conflictingEntityType: otherType,
      filePath: toRel(absPath, dataRoot),
    });
  }
  return results;
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

/**
 * Phase G M-4 (Codex round 2): 参照側 entity を編集中の active EditSession を検出する。
 *
 * refScan.perFileUpdate に列挙された各 file (entityKind, entityId) に対し、callback
 * (fetchEditSessionsForRef) を呼び、Edit role の session が 1 件でもあれば
 * concurrentEditRefs に積む。
 *
 * - 主 entity 自身 (rename 対象 entityType + oldId) は呼出元 lock check で別途検査済 → skip
 * - selfSessionId (rename 実行 session) は除外 (自セッションが Edit role でも問題なし)
 * - entityKind は本 module の internal 名 (例: "processFlow", "viewDefinition") をそのまま渡し、
 *   callback 側で kebab に変換する責務を持つ
 * - 副次 file (project / screenFlowPositions / erLayout) は EditSession 対象外なので skip
 */
async function detectConcurrentEditRefs(
  refScan: RefScanResult,
  entityType: RenameEntityType,
  oldId: string,
  opts: RenameOpts | undefined,
): Promise<Array<{ entityKind: string; entityId: string; sessionId: string }>> {
  const fetcher = opts?.fetchEditSessionsForRef;
  if (!fetcher) return [];
  const selfSessionId = opts?.sessionId;
  const result: Array<{ entityKind: string; entityId: string; sessionId: string }> = [];

  // perFileUpdate の (entityKind, entityId) を一意化 (同一 file が複数 location を持つため)
  //
  // Phase I round 3+4 Must-fix B (3 AI 全員指摘): 旧実装は project / screenFlowPositions /
  // erLayout を「EditSession 非対象」として skip していたが、FlowEditor (project +
  // screenFlowPositions を 1 つの flow/singleton session で扱う) と ErDiagram
  // (er-layout/singleton session) が実際に singleton EditSession を持っており、
  // rename で書き換える file 群と 1:1 で紐付く。skip すると Flow/ER editor active 中の
  // Screen/Table rename が block されず、後続 save で巻き戻る orphan を生む。
  //
  // 本 phase で fetcher 側 (wsHandlers/refactor.ts: makeFetchEditSessionsForRef) が
  // (project / screenFlowPositions / erLayout) → flow/singleton or er-layout/singleton に
  // 変換するため、ここでは skip を解除して candidates に積む。
  const seenKeys = new Set<string>();
  const candidates: Array<{ entityKind: string; entityId: string }> = [];
  for (const loc of refScan.locations) {
    // 主 entity 自身は呼出元 lock check で別途検査済 → skip
    if (loc.entityKind === entityType && loc.entityId === oldId) continue;
    const key = `${loc.entityKind}:${loc.entityId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    candidates.push({ entityKind: loc.entityKind, entityId: loc.entityId });
  }

  for (const c of candidates) {
    const sessions = fetcher(c.entityKind, c.entityId);
    for (const es of sessions) {
      if (es.state !== "Active") continue;
      for (const [, participant] of es.participants) {
        if (participant.role !== "Edit") continue;
        if (selfSessionId && participant.sessionId === selfSessionId) continue;
        result.push({
          entityKind: c.entityKind,
          entityId: c.entityId,
          sessionId: participant.sessionId,
        });
        break; // 同 (kind, id) で 1 件だけ報告
      }
    }
  }
  return result;
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
      ambiguousDependencies: [], concurrentEditRefs: [], warnings: [],
      positionsCollisions: [],
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

  // Phase G M-1 (Codex round 2): cross-type ambiguous dependency 検出
  const ambiguousDependencies = await detectAmbiguousDependencies(entityType, oldId, root, dataRoot);

  // Phase G M-4 (Codex round 2): 参照側 entity の active EditSession 検出
  const concurrentEditRefs = await detectConcurrentEditRefs(refScan, entityType, oldId, opts);

  return {
    entityType, oldId, newId,
    uniqueOk, oldExists, lockedByOther,
    fileRenames,
    refUpdates: refScan.locations,
    totalRefs: refScan.locations.length,
    ambiguousDependencies,
    concurrentEditRefs,
    warnings: refScan.warnings,
    positionsCollisions: refScan.positionsCollisions,
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

  // Phase G M-1 (Codex round 2): cross-type ambiguous dependency が存在する場合は block
  // (`View.dependencies[]` が untyped EntityId 配列のため、同名 Table+View 共存時に他 entity
  // type の依存を誤更新する silent data corruption を防ぐ)
  const ambiguousDeps = await detectAmbiguousDependencies(entityType, oldId, root, dataRoot);
  if (ambiguousDeps.length > 0) {
    const viewIds = ambiguousDeps.map((d) => d.viewId).join(", ");
    const other = ambiguousDeps[0].conflictingEntityType;
    throw new Error(
      `${entityType} "${oldId}" の rename は ambiguous: 同名の ${other} "${oldId}" が存在し、` +
      `View [${viewIds}] が dependencies[] で参照しています。先に片方を rename / 削除してください。`,
    );
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

  // Phase I round 3+4 Must-fix D: positions oldId+newId 同時存在は blocker。
  // screen-flow-positions / er-layout の座標 entry を migrate せず stale 残しで rename
  // 成功させていた旧 silent skip 経路を、execute throw に格上げする。
  if (refScan.positionsCollisions.length > 0) {
    throw new Error(
      `${entityType} "${oldId}" の rename は positions key 衝突のため block されました:\n` +
      refScan.positionsCollisions.map((m) => `  - ${m}`).join("\n") + "\n" +
      `先に当該 positions entry を手動で除去してから rename を再実行してください。`,
    );
  }

  // Phase G M-4 (Codex round 2): 参照側 entity に active Edit session があれば block
  // (rename は committed file を直接 write するため、別 session の draft 保持 → 後続 save で
  // rename 済 ref を旧 id に巻き戻して orphan 再生成するリスクを回避)
  const concurrentEditRefs = await detectConcurrentEditRefs(refScan, entityType, oldId, opts);
  if (concurrentEditRefs.length > 0) {
    const refs = concurrentEditRefs
      .map((r) => `${r.entityKind}/${r.entityId} (session=${r.sessionId})`)
      .join(", ");
    throw new Error(
      `${entityType} "${oldId}" の rename は参照側 entity を編集中の他 session があるため block されました: [${refs}]。` +
      `先に当該 editor の編集を確定/破棄してください。`,
    );
  }

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
    //
    // Phase F M-4 (Codex 独立レビュー): identity 書換え (withRewrittenId) に加えて、自己参照
    // (例: Table self-FK の constraints[].referencedTableId、self-ref PF) も rewrite する。
    // scanAllRefs は既に主ファイルの自己 ref location を locations に含めている (M-4 skip 解除済)
    // ため、ここでは write する content の整合だけ取れば良い。
    const identityRewritten = withRewrittenId(entityType, primaryData, newId);
    const { rewritten: rewrittenPrimary } = rewriteSelfRefsInPrimary(
      entityType, identityRewritten, oldId, newId,
    );

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
      // Phase I round 3+4 Must-fix F: Puck payload (`screens/<id>/puck-data.json`)
      // も raw copy で新 directory に複製する。writeScreenEntity は puck-data には touch しない。
      const oldPuckAbs = path.join(dataRoot, "screens", oldId, "puck-data.json");
      const newPuckAbs = path.join(dataRoot, "screens", newId, "puck-data.json");
      const oldPuckContent = await readFileContentOrNull(oldPuckAbs);
      if (oldPuckContent !== null) {
        await writeFileContent(newPuckAbs, oldPuckContent);
        writtenFiles.push(newPuckAbs);
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
    //
    // Phase F M-6 (Codex 独立レビュー): 旧 `tryUnlink` は全 error を握り潰し、permission/I/O 失敗で
    // 同一 uuid file が複数残る (= acceptance #5 atomic 違反) 状態でも rename 成功扱いだった。
    // 本 phase の delete 失敗は throw して上位 catch で rollback (新 file 削除 + 旧 file content 復元
    // + ref 側 rollback) を行う。
    for (const plan of filePlans) {
      await strictUnlink(plan.from);
    }
    // screen / pageLayout の旧 design.json も削除 (存在すれば)
    // 注: 旧 Puck payload (`screens/<oldId>/puck-data.json`) は planFileRenames に含まれている
    // ため上の `strictUnlink(plan.from)` loop で削除済。ここでは追加で空 directory 化された
    // `screens/<oldId>/` を rmdir で掃除する (best effort)。
    if (entityType === "screen") {
      await strictUnlink(path.join(dataRoot, "screens", `${oldId}.design.json`));
      // Phase I round 3+4 Must-fix F: Puck payload の親 directory が空ならまとめて掃除
      try {
        await fs.rmdir(path.join(dataRoot, "screens", oldId));
      } catch { /* directory が空でない、もしくは存在しない: ignore */ }
    } else if (entityType === "pageLayout") {
      await strictUnlink(path.join(dataRoot, "page-layouts", `${oldId}.design.json`));
    }
  } catch (err) {
    // rollback: 新規 write した file を消す + 参照側を元に戻す
    // Phase F M-6: 加えて、commit phase の旧ファイル削除が部分的に成功している可能性があるため、
    // fileRenameSnapshots の from (旧 path) も snapshot content で書き戻す (byte-identical 復元)。
    for (const abs of writtenFiles) {
      await tryUnlink(abs);
    }
    for (const r of restoreActions) {
      try { await writeFileContent(r.absPath, r.originalContent); } catch { /* best effort */ }
    }
    // 旧ファイル復元 (commit phase の strictUnlink で一部削除されたケースをカバー)
    for (const snap of fileRenameSnapshots) {
      try {
        await writeFileContent(path.join(dataRoot, snap.from), snap.originalContent);
      } catch { /* best effort */ }
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
    // Phase G M-1/M-4: execute まで来た = ambiguous も concurrent もなかった
    ambiguousDependencies: [],
    concurrentEditRefs: [],
    // Phase H N-2: scan warnings (将来拡張用) は実行成功後も UI に伝達
    warnings: refScan.warnings,
    // Phase I round 3+4 Must-fix D: 実行成功時は positions 衝突なし (throw されているはず)
    positionsCollisions: [],
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

  // Phase G M-3 (Codex round 2): undo 経路の atomic 化。
  //
  // 旧実装は (a) ref restore → (b) old path 書戻し → (c) new path tryUnlink の順で
  // 全 error を握り潰していたため、permission/I/O 失敗で同一 uuid file が old/new に
  // 並存 + operation 既消費 で再 undo 不可な状態になっていた。Phase F M-6 が rename 側で
  // 塞いだ atomic 違反と同型の問題が undo 側に残存していた。
  //
  // 対策: undo の new-path delete も strictUnlink 化、失敗時は本関数全体で
  //   - これまでに upload した restore (old path 書戻し + ref 書戻し) を再度 newContent で
  //     書き戻して「rename 完了状態」に戻し、
  //   - operation を再度 pushUndo して操作消費を取り消し (再 undo 可能に保つ)、
  //   - error を throw する。
  // これにより undo は「成功なら完全 revert、失敗なら byte-identical な rename 完了状態」の
  // 2 状態しか取りえない (atomic)。
  //
  // Phase I round 3+4 Must-fix C (3 AI 全員指摘): 旧実装は (1) rename 後に行われた正当な編集を
  // 無条件に破棄、(2) rollback も `op` の rename-time bytes (`r.newContent`) で復元するため
  // 直前まで存在していた事後編集を失う、という 2 つの atomic 違反があった。
  //
  // 対策:
  //   (a) undo 開始前に全対象 file の現在 content を read し、`op` snapshot の rename 直後 bytes
  //       (refUpdates の newContent / fileRenames の new path 期待値) と比較する。
  //   (b) 差分があれば「rename 後に編集されたファイルがあります — 手動 merge してください」と
  //       throw して undo を block (op を再 push して再 undo 可能に保つ)。
  //   (c) rollback には rename-time bytes ではなく **undo 開始時に snapshot した現在 bytes** を
  //       使う。これにより undo 失敗時にも事後編集を失わない。

  // (i) undo 開始時の現在 content snapshot (rollback 用、user の事後編集も保持される)
  const currentRefContents: Array<{ absPath: string; content: string | null }> = [];
  for (const r of op.refUpdates) {
    const absPath = path.join(dataRoot, r.filePath);
    currentRefContents.push({ absPath, content: await readFileContentOrNull(absPath) });
  }
  const currentNewPathContents: Array<{ absPath: string; content: string | null }> = [];
  for (const f of op.fileRenames) {
    const toAbs = path.join(dataRoot, f.to);
    currentNewPathContents.push({ absPath: toAbs, content: await readFileContentOrNull(toAbs) });
  }

  // (ii) 事後編集検出: rename-time bytes と current bytes を比較
  const editedFiles: string[] = [];
  for (let i = 0; i < op.refUpdates.length; i++) {
    const expected = op.refUpdates[i].newContent;
    const actual = currentRefContents[i].content;
    // 不在 (= 削除済 = drift)、もしくは bytes 差分 = post-update edit
    if (actual === null || actual !== expected) {
      editedFiles.push(op.refUpdates[i].filePath);
    }
  }
  // 主ファイル new path も検査 (newContent の期待値は writeEntityById 経由で書かれた内容なので
  // 厳密 byte 一致は難しい — annotateValidationWarnings 等の副作用がある。
  // ここでは「new path file が存在するか」のみ最低限の検査とする。
  // ref 側のみ厳密検査することで「rename 後に新 id 側を編集 → undo block」をカバーする)
  for (let i = 0; i < op.fileRenames.length; i++) {
    if (currentNewPathContents[i].content === null) {
      editedFiles.push(`${op.fileRenames[i].to} (存在しません)`);
    }
  }
  if (editedFiles.length > 0) {
    // op を再 push して再試行可能に保ち、user 確認後の undo を許す
    pushUndo(root, op);
    throw new Error(
      `Undo を block しました: rename 後に編集された (または削除された) file があります。\n` +
      editedFiles.map((f) => `  - ${f}`).join("\n") + "\n" +
      `先に当該 file の編集内容を確認し、必要なら手動で merge してから再度 undo してください。`,
    );
  }

  const restoredAbsRefPaths: string[] = []; // 既に書戻した ref 側 abs path
  const restoredOldFromPaths: string[] = []; // 既に restore した old from path

  try {
    // (a) ref 側 file を snapshot の original で完全上書き
    for (const r of op.refUpdates) {
      const absPath = path.join(dataRoot, r.filePath);
      await writeFileContent(absPath, r.originalContent);
      restoredAbsRefPaths.push(absPath);
      restored++;
    }

    // (b) 主ファイル + design ファイルを oldId 側に restore
    for (const f of op.fileRenames) {
      const fromAbs = path.join(dataRoot, f.from); // 元の path (oldId 側)
      const toAbs   = path.join(dataRoot, f.to);   // rename 後の path (newId 側)
      await writeFileContent(fromAbs, f.originalContent);
      restoredOldFromPaths.push(fromAbs);
      // newId 側 file を strict 削除 (Phase G M-3): 失敗時は catch で rollback
      await strictUnlink(toAbs);
      restored++;
    }
  } catch (err) {
    // undo rollback: rename 完了状態 (= undo 開始時の現在 bytes) に復元。
    //
    // Phase I round 3+4 Must-fix C: 旧実装は rename-time `r.newContent` で復元していたため
    // 「rename → user edit → undo (失敗)」シナリオで user edit が消失していた。
    // 本 phase で rollback も undo 開始時 snapshot (currentRefContents / currentNewPathContents)
    // を使うように修正。事後編集 detection を通過した時点で current = newContent のはずなので
    // 機能的には同じ bytes だが、検出を回避できる corner case (file 削除等) でも正しい。
    //
    // (1) 書戻した ref 側 を undo 開始時 bytes で再上書き
    for (let i = 0; i < op.refUpdates.length; i++) {
      const cur = currentRefContents[i];
      if (!restoredAbsRefPaths.includes(cur.absPath)) continue;
      if (cur.content === null) continue; // 元々不在ならそのまま (skip)
      try { await writeFileContent(cur.absPath, cur.content); } catch { /* best effort */ }
    }
    // (2) restore した old path を削除 (= 元の rename 完了時は不在)
    for (const absPath of restoredOldFromPaths) {
      try { await fs.unlink(absPath); } catch { /* best effort */ }
    }
    // (3) new path content を undo 開始時 bytes で復元 (delete 前)
    for (const npc of currentNewPathContents) {
      if (npc.content === null) continue;
      try { await writeFileContent(npc.absPath, npc.content); } catch { /* best effort */ }
    }
    // (4) operation を再 push して再 undo を可能にする (popUndo の取り消し)
    pushUndo(root, op);
    throw err;
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
