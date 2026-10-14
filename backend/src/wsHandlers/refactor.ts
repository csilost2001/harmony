/**
 * Refactor 系 RPC handler (#1298 I-6, RFC #1284)。
 *
 * 7 top-level entity (Screen / Table / ProcessFlow / Sequence / View / ViewDefinition /
 * PageLayout) の id rename をサポートする 3 method:
 *   - previewEntityRename: 影響範囲 (file renames + ref update 件数 + lock 状態) を返す
 *   - renameEntityId:      atomic rename 実行 + broadcast (主要 4 種 + entityType 別)
 *   - undoEntityRename:    直近 1 件 rename を完全 revert (5 分 TTL)
 *
 * 入力 validation:
 *   - entityType は RenameEntityType whitelist のいずれか
 *   - oldId は EntityId|UUID (移行期間 compat)
 *   - newId は kebab-case EntityId のみ (UUID 不可、RFC #1284)
 */
import {
  previewEntityRename,
  renameEntityId,
  undoEntityRename,
  findUndoOperationWorkspaceRoot,
  listRecentUndoOperations,
  entityTypeToResourceType,
  type RenameEntityType,
  type EditSessionLike,
} from "../renameEntity.js";
import { findReferences } from "../references.js";
import { assertEntityId, assertSafeName } from "../security/idValidator.js";
import type { DraftResourceType as EditSessionResourceType } from "../editSessionStore.js";
import type { WsBridge } from "../wsBridge.js";
import type { RpcHandlerMap } from "./types.js";

const VALID_ENTITY_TYPES = new Set<RenameEntityType>([
  "screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout",
]);

function assertEntityType(t: unknown, label: string): RenameEntityType {
  if (typeof t !== "string" || !VALID_ENTITY_TYPES.has(t as RenameEntityType)) {
    throw new Error(`Invalid ${label}: unknown entity type (got ${JSON.stringify(t)})`);
  }
  return t as RenameEntityType;
}

/**
 * lock check 用 EditSession 一覧を bridge から取得 (wsId 必須)。
 * wsId が null (workspace 未選択) なら空配列 (rename 自体が走らないが defensive)。
 *
 * Phase I round 3+4 Must-fix G (Codex round 4 M-6): primary entity type ごとに、同じ
 * ファイルを書く resource type を集約して返す (PRIMARY_RESOURCE_TYPES_BY_ENTITY)。
 */
function fetchEditSessions(
  bridge: WsBridge,
  wsId: string | null,
  entityType: RenameEntityType,
  oldId: string,
): ReadonlyArray<EditSessionLike> {
  if (!wsId) return [];
  // entityTypeToResourceType の存在は import 互換性のため保持 (他箇所で使用される)
  void entityTypeToResourceType;
  const resourceTypes = PRIMARY_RESOURCE_TYPES_BY_ENTITY[entityType];
  const all: EditSessionLike[] = [];
  for (const rt of resourceTypes) {
    all.push(...bridge.editSessionListByResource(wsId, rt, oldId));
  }
  return all;
}

/**
 * Phase G M-4 (Codex round 2): renameEntity internal の entityKind (camelCase: "processFlow",
 * "viewDefinition", "pageLayout") を DraftResourceType (kebab-case: "process-flow",
 * "view-definition", "page-layout") に変換する map。renameEntity の RenameEntityType と
 * 同一値の場合は同名で OK (table / screen / view / sequence)。
 *
 * Phase I round 3+4 Must-fix B (3 AI 全員指摘): singleton EditSession を持つ副次 file
 * (project / screenFlowPositions → flow/singleton、erLayout → er-layout/singleton) も
 * rename で直接書き換える file 群なので lock check 対象に含める。これらは entityId が
 * singleton 1 件固定のため、本 map では `<resourceType>:singleton` の形式で扱い、
 * fetch 時に entityId を "singleton" 固定で問い合わせる (下記 makeFetchEditSessionsForRef)。
 */
const INTERNAL_KIND_TO_RESOURCE_TYPE: Record<string, EditSessionResourceType> = {
  // 画面は画面項目 + レイアウトの編集セッション (screen-item) が `screens/<id>.json` を書く
  screen: "screen-item",
  // 業務フロー・帳票は、画面・処理フロー・テーブルの改名で参照を書き換えられる側
  businessFlow: "business-flow",
  report: "report",
  table: "table",
  processFlow: "process-flow",
  sequence: "sequence",
  view: "view",
  viewDefinition: "view-definition",
  pageLayout: "page-layout",
  // #1331: GenericDefinition (kind/name 複合 id) を rename block 対象に含める。
  // renameEntity scan source は entityKind="genericDefinition" / entityId="<kind>/<name>" で
  // 列挙される (renameEntity.ts L1318)。frontend GenericDefinitionEditor が同形式の
  // resourceId で EditSession を作成するため、ここで kebab-case の resourceType に変換する。
  genericDefinition: "generic-definition",
};

/**
 * Phase I round 3+4 Must-fix B: singleton EditSession を持つ副次 file の resourceType mapping。
 * renameEntity 側 scan source の entityKind (project / screenFlowPositions / erLayout) を
 * DraftResourceType の singleton resource に変換する。
 *
 * 対応関係 (実装根拠):
 * - project / screenFlowPositions → flow/singleton (FlowEditor: `harmony.json` +
 *   `screen-flow-positions.json` を 1 つの flow draft で扱う)
 * - erLayout → er-layout/singleton (ErDiagram: `er-layout.json` 専用 singleton)
 *
 * これらの session が active Edit 中に Screen/Table rename が走ると、後続の FlowEditor /
 * ErDiagram の save (`harmony.json` / `er-layout.json` を full overwrite) で rename 済の
 * 内容を旧 id 含む snapshot で巻き戻し、orphan を生成するため block 対象とする。
 */
const INTERNAL_KIND_TO_SINGLETON_RESOURCE_TYPE: Record<string, EditSessionResourceType> = {
  project: "flow",
  screenFlowPositions: "flow",
  erLayout: "er-layout",
};
const SINGLETON_RESOURCE_ID = "singleton";

/**
 * Phase G M-4 (Codex round 2): rename が ref scan で書き換える参照側 entity に対し
 * active EditSession 一覧を返す callback を生成する。
 *
 * renameEntity 側は (entityKind, entityId) を呼出 — entityKind は internal camelCase 表記。
 * bridge.editSessionListByResource は DraftResourceType (kebab-case) を要求するため、
 * 本 callback で変換 + workspace 解決を行う。
 *
 * Phase I round 3+4 Must-fix B: 副次 file (project / screenFlowPositions / erLayout) も
 * singleton EditSession として lock check 対象に含める。
 */
function makeFetchEditSessionsForRef(
  bridge: WsBridge,
  wsId: string | null,
): (entityKind: string, entityId: string) => ReadonlyArray<EditSessionLike> {
  return (entityKind: string, entityId: string) => {
    if (!wsId) return [];
    // 通常 entity (Table/Screen/ProcessFlow 等): entityId を直接使用
    const resourceType = INTERNAL_KIND_TO_RESOURCE_TYPE[entityKind];
    if (resourceType) {
      // #1331: genericDefinition の entityId は "<kind>/<name>" 形式だが、
      // editSession.create の assertSafeName は `/` を許容しないため frontend は
      // `/` → `__` に encode して create する。lookup 時にも同じ変換を適用する。
      const resourceId = entityKind === "genericDefinition"
        ? entityId.replace(/\//g, "__")
        : entityId;
      return bridge.editSessionListByResource(wsId, resourceType, resourceId);
    }
    // 副次 file (project/screenFlowPositions/erLayout): singleton EditSession を引く
    const singletonRT = INTERNAL_KIND_TO_SINGLETON_RESOURCE_TYPE[entityKind];
    if (singletonRT) {
      return bridge.editSessionListByResource(wsId, singletonRT, SINGLETON_RESOURCE_ID);
    }
    return []; // 未知 kind (defensive)
  };
}

/**
 * Phase I round 3+4 Must-fix G (Codex round 4 M-6): primary lock 対象の resource type。
 *
 * 画面は `screen-item/<screenId>` session (画面項目一覧・業務部品デザイナ) で編集し、保存時に
 * `writeScreenItems()` → `writeScreenEntity(screenId, ...)` で `screens/<id>.json` を更新する。
 * rename 中にこの editor が active のままだと、rename 後の save で old ID の screen を
 * 再作成して orphan を生む。(旧エディタ廃止後、旧デザイン本体の session 種別は無い)
 *
 * 主 entity 種別ごとに「同じ disk file を競合的に書く resource type 群」を返す。
 * Table 等 auxiliary session を持たない entity は 1 件のみ返す (= 既存挙動互換)。
 */
const PRIMARY_RESOURCE_TYPES_BY_ENTITY: Record<RenameEntityType, EditSessionResourceType[]> = {
  screen: ["screen-item"],
  table: ["table"],
  processFlow: ["process-flow"],
  sequence: ["sequence"],
  view: ["view"],
  viewDefinition: ["view-definition"],
  pageLayout: ["page-layout"],
};

/**
 * Phase J Must-fix C (#1298 round 5 Codex M-3): live store + persisted file の
 * resourceId 移行 callback を生成する。renameEntity 側に opts.migrateEditSessions として渡す。
 *
 * wsId が null (workspace 未選択) なら no-op (= 空配列を返す)。
 */
function makeMigrateEditSessions(
  bridge: WsBridge,
  wsId: string | null,
): (
  resourceType: string,
  oldId: string,
  newId: string,
  targetEditSessionIds?: readonly string[],
) => ReturnType<WsBridge["editSessionMigrateResourceId"]> {
  return async (resourceType, oldId, newId, targetEditSessionIds) => {
    if (!wsId) return { migrated: [], warnings: [] };
    return bridge.editSessionMigrateResourceId(
      wsId,
      resourceType as EditSessionResourceType,
      oldId,
      resourceType as EditSessionResourceType,
      newId,
      targetEditSessionIds,
    );
  };
}

/** 参照側の画面・設計が古い参照のまま残らないよう、改名のあとに reload を知らせる設計の種類 */
export const RENAME_RELOAD_EVENTS = [
  "screenChanged", "tableChanged", "processFlowChanged", "viewChanged",
  "sequenceChanged", "viewDefinitionChanged", "pageLayoutChanged",
  "genericDefinitionChanged",
  // 業務フロー / 帳票は、工程・出力契機の参照が書き換わることがある。開いている編集画面が古い参照のまま
  // 「上書きして保存」して参照切れを再導入しないよう、これらにも reload を通知する
  "businessFlowChanged", "reportChanged",
  // 画面の改名は、独自部品の定義 (layout-components.json) の差し込み口・定義内の遷移先も書き換える
  "layoutComponentsChanged",
];

/**
 * 改名の影響範囲を調べる (状態を変えない)。編集中のセッションがあるかの確認つき。
 * WebSocket (画面) と MCP (AI) の両方から使う。
 */
export async function runEntityRenamePreview(
  bridge: WsBridge, wsId: string | null, et: RenameEntityType, oldId: string, newId: string, root: string, sessionId: string,
) {
  const editSessions = fetchEditSessions(bridge, wsId, et, oldId);
  const fetchEditSessionsForRef = makeFetchEditSessionsForRef(bridge, wsId);
  return previewEntityRename(et, oldId, newId, root, { sessionId, editSessions, fetchEditSessionsForRef });
}

/**
 * ID の改名を実行する (主ファイル + 参照側を atomic に書き換え)。結果と、応答のあとで呼ぶ reload 通知を返す。
 * WebSocket (画面) と MCP (AI) の両方から使う。
 */
export async function runEntityRename(
  bridge: WsBridge, wsId: string | null, et: RenameEntityType, oldId: string, newId: string, root: string, sessionId: string,
) {
  const editSessions = fetchEditSessions(bridge, wsId, et, oldId);
  const fetchEditSessionsForRef = makeFetchEditSessionsForRef(bridge, wsId);
  // 編集セッションの対象 ID の移行 (ライブ + 永続化)
  const migrateEditSessions = makeMigrateEditSessions(bridge, wsId);
  const result = await renameEntityId(et, oldId, newId, root, { sessionId, editSessions, fetchEditSessionsForRef, migrateEditSessions });
  const broadcastReload = () => {
    // 改名した設計の changed (reload: true つき。別タブの編集画面が古い ID のまま保存して壊さないよう、
    // 起点のクライアントにも届ける) と、参照側の設計の reload
    bridge.broadcast({ wsId, event: `${et}Changed`, data: { oldId, newId, renamed: true, reload: true } });
    for (const ev of RENAME_RELOAD_EVENTS) {
      if (ev === `${et}Changed`) continue;
      bridge.broadcast({ wsId, event: ev, data: { reload: true } });
    }
  };
  return { result, broadcastReload };
}

/**
 * 直前の改名を取り消す。operation の持ち主のワークスペース (改名したときのもの) で、編集セッションの対象 ID も
 * 元に戻す。結果と、応答のあとで呼ぶ reload 通知を返す。WebSocket (画面) と MCP (AI) の両方から使う。
 */
export async function runEntityUndo(bridge: WsBridge, operationId: string, fallbackRoot: string, sessionId: string) {
  // operation の workspace ownership は client-supplied path ではなく server-side undo store で解決する。
  // workspace 切替後 undo と raw path injection を同時に塞ぐ。
  const opRoot = findUndoOperationWorkspaceRoot(operationId) ?? fallbackRoot;
  const migrateEditSessions = makeMigrateEditSessions(bridge, opRoot);
  const result = await undoEntityRename(operationId, opRoot, { sessionId, migrateEditSessions });
  const broadcastReload = () => {
    for (const ev of RENAME_RELOAD_EVENTS) bridge.broadcast({ wsId: opRoot, event: ev, data: { reload: true } });
  };
  return { result, broadcastReload };
}

export const refactorHandlers: RpcHandlerMap = {
  listRecentUndoOperations: async ({ root, respond, respondError }) => {
    try {
      respond(listRecentUndoOperations(root()));
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  /** 参照元 (その設計を参照している設計) の一覧。改名・削除の前の影響確認、設計を辿る用 */
  findEntityReferences: async ({ params, root, respond, respondError }) => {
    try {
      const { entityType, id } = (params ?? {}) as { entityType: unknown; id: unknown };
      const et = assertEntityType(entityType, "entityType");
      assertEntityId(id, "id");
      respond(await findReferences(et, id as string, root()));
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  previewEntityRename: async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const { entityType, oldId, newId } = (params ?? {}) as {
        entityType: unknown; oldId: unknown; newId: unknown;
      };
      const et = assertEntityType(entityType, "entityType");
      assertEntityId(oldId, "oldId");
      assertEntityId(newId, "newId");
      respond(await runEntityRenamePreview(bridge, wsId(), et, oldId as string, newId as string, root(), clientId));
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  renameEntityId: async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const { entityType, oldId, newId } = (params ?? {}) as {
        entityType: unknown; oldId: unknown; newId: unknown;
      };
      const et = assertEntityType(entityType, "entityType");
      assertEntityId(oldId, "oldId");
      assertEntityId(newId, "newId");
      const { result, broadcastReload } = await runEntityRename(bridge, wsId(), et, oldId as string, newId as string, root(), clientId);
      respond(result);
      // 応答のあとで通知する (応答を受ける前に、先に reload の通知が届かないように)
      broadcastReload();
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  undoEntityRename: async ({ params, root, clientId, respond, respondError, bridge }) => {
    try {
      const { operationId } = (params ?? {}) as {
        operationId: unknown;
      };
      // operationId は UUID v4 (uuid module で生成) — safeName 範囲内 ([A-Za-z0-9_-]{1,64}) でカバー
      assertSafeName(operationId, "operationId");
      const { result, broadcastReload } = await runEntityUndo(bridge, operationId as string, root(), clientId);
      respond(result);
      // undo は、起点のクライアントにも reload を届ける (同じ URL に戻るだけで、cache の入れ替えを自前でしないため)
      broadcastReload();
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },
};
