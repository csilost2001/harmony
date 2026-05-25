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
  entityTypeToResourceType,
  type RenameEntityType,
  type EditSessionLike,
} from "../renameEntity.js";
import { assertEntityId, assertEntityIdOrUuid, assertSafeName } from "../security/idValidator.js";
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
 * Phase I round 3+4 Must-fix G (Codex round 4 M-6): Screen rename 時は
 * `screen` / `screen-item` / `puck-data` の 3 種を集約して返す。
 * (旧実装は primary entity type 1 種のみ問い合わせていたため、ScreenItemsView /
 * Puck Designer の active session が lock check を素通りしていた。)
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
  screen: "screen",
  table: "table",
  processFlow: "process-flow",
  sequence: "sequence",
  view: "view",
  viewDefinition: "view-definition",
  pageLayout: "page-layout",
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
      return bridge.editSessionListByResource(wsId, resourceType, entityId);
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
 * Phase I round 3+4 Must-fix G (Codex round 4 M-6): Screen rename 時の primary lock 対象を
 * `screen` 単独から `screen` + `screen-item` + `puck-data` の 3 種に拡張する。
 *
 * 理由: ScreenItemsView は `screen-item/<screenId>` session で編集し、保存時に
 * `writeScreenItems()` → `writeScreenEntity(screenId, ...)` で同じ `screens/<id>.json` を
 * 更新する。Puck Designer も `puck-data/<screenId>` session を使用し、`puck-data.json` を
 * 同 directory に書く。Screen rename 中にこれら auxiliary editor が active のままだと、
 * rename 後の save で old ID の screen / payload を再作成して orphan を生む。
 *
 * 主 entity 種別ごとに「同じ disk file を競合的に書く resource type 群」を返す。
 * Table 等 auxiliary session を持たない entity は 1 件のみ返す (= 既存挙動互換)。
 */
const PRIMARY_RESOURCE_TYPES_BY_ENTITY: Record<RenameEntityType, EditSessionResourceType[]> = {
  screen: ["screen", "screen-item", "puck-data"],
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

export const refactorHandlers: RpcHandlerMap = {
  previewEntityRename: async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const { entityType, oldId, newId } = (params ?? {}) as {
        entityType: unknown; oldId: unknown; newId: unknown;
      };
      const et = assertEntityType(entityType, "entityType");
      assertEntityIdOrUuid(oldId, "oldId");
      assertEntityId(newId, "newId");
      const sessionId = clientId;
      const wid = wsId();
      const editSessions = fetchEditSessions(bridge, wid, et, oldId as string);
      const fetchEditSessionsForRef = makeFetchEditSessionsForRef(bridge, wid);
      const result = await previewEntityRename(et, oldId as string, newId as string, root(), {
        sessionId, editSessions, fetchEditSessionsForRef,
      });
      respond(result);
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
      assertEntityIdOrUuid(oldId, "oldId");
      assertEntityId(newId, "newId");
      const sessionId = clientId;
      const wid = wsId();
      const editSessions = fetchEditSessions(bridge, wid, et, oldId as string);
      const fetchEditSessionsForRef = makeFetchEditSessionsForRef(bridge, wid);
      // Phase J Must-fix C: live + persisted migration callback を inject
      const migrateEditSessions = makeMigrateEditSessions(bridge, wid);
      const result = await renameEntityId(et, oldId as string, newId as string, root(), {
        sessionId, editSessions, fetchEditSessionsForRef, migrateEditSessions,
      });
      respond(result);

      // broadcast: entityType 別 changed + 7 種 reload (UI cache 無効化)
      // S-2 (Opus 独立レビュー): rename / undo で同じ 7 種を broadcast (cache 不整合防止)
      //
      // Phase I round 3+4 Must-fix A (Opus M-1 / Codex M-7 / Antigravity M-1):
      // primary entity changed event の payload に `reload: true` を追加する。
      // 旧実装は `{oldId, newId, renamed: true}` のみで、useResourceEditor 側の
      // id filter (`d[broadcastIdField] !== id` で reject) を通過できず、別 tab
      // で primary entity (oldId 含む同名) を開いている editor が stale cache のまま
      // 残り、後続 save で silent data corruption する経路があった。
      // `reload: true` 付与により id filter より前の早期分岐で hit するため、
      // 全 receiver が確実に invalidation を受ける。
      //
      // Phase I round 3+4 Must-fix A (Opus M-1 / Codex M-2 / Antigravity M-2):
      // primary broadcast から `excludeClientId` を外す。
      // 理由: 同一 browser 内の別 tab で参照側 editor を開いていると、rename を
      // 実行した origin client にも invalidation を届ける必要がある。origin の
      // 主 entity tab は handleRenameSuccess (closeTab + navigate) で URL/tab を
      // 差し替えるが、参照側 (ProcessFlow が Table を参照、等) は別 tab で開いて
      // いるため自前の cache 更新経路を持たない。excludeClientId を外して
      // origin/non-origin 双方の参照側 editor が確実に reload するようにする。
      // 主 entity 側 tab は handleRenameSuccess の navigate で旧 tab が close され
      // 新 tab の reload event は新 id を持つ store cache が拾うため副作用なし。
      bridge.broadcast({
        wsId: wid,
        event: `${et}Changed`,
        data: { oldId, newId, renamed: true, reload: true },
      });
      // 参照側 entity の cache を全 broadcast で reload させる (7 種全件 + generic-definition)
      // Phase J Must-fix B (#1298 round 5 Codex M-2): generic-definition の path 形式 ref も
      // I 期で rewrite 対象に追加したため、開いている GenericDefinitionEditor の stale state
      // overwrite を緩和するため `genericDefinitionChanged` も broadcast する。
      const RELOAD_EVENTS = [
        "screenChanged", "tableChanged", "processFlowChanged", "viewChanged",
        "sequenceChanged", "viewDefinitionChanged", "pageLayoutChanged",
        "genericDefinitionChanged",
      ];
      for (const ev of RELOAD_EVENTS) {
        if (ev === `${et}Changed`) continue; // 自身の event は上で発行済
        bridge.broadcast({
          wsId: wid, event: ev, data: { reload: true },
          // Phase I round 3+4 Must-fix A: origin client にも参照側 reload を届ける
          // (excludeClientId を外す。primary broadcast と同じ理由)
        });
      }

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
      const sessionId = clientId;
      // operation の workspace ownership は client-supplied path ではなく server-side
      // undo store で解決する。workspace 切替後 undo と raw path injection を同時に塞ぐ。
      const opRoot = findUndoOperationWorkspaceRoot(operationId as string) ?? root();
      // Phase J Must-fix C: live + persisted revert callback を inject
      const migrateEditSessions = makeMigrateEditSessions(bridge, opRoot);
      const result = await undoEntityRename(operationId as string, opRoot, {
        sessionId, migrateEditSessions,
      });
      respond(result);
      // Phase F S-1 (Codex 独立レビュー): undo は originating client 自身の cache (newId 側 store
      // データ + ref 側 cache) も完全に無効化する必要がある。renameEntityId の broadcast は
      // originating client を `excludeClientId` で除外しても良い (rename を起こした側は自分で
      // tab/URL 遷移 + handleRenameSuccess で旧 tab close 等の cache 入替を行うため不要)。
      // 一方 undo は editor が「同じ URL に戻る」だけのため、cache 同期は broadcast に頼る必要が
      // あり、originating client を除外すると stale cache が残る (固定 300ms hard delay は決定的
      // でない緩和策、Codex 独立レビュー S-1 で指摘)。
      // → undo 経路では excludeClientId を渡さず、originating client にも reload event を届ける。
      // Phase J Must-fix B: undo 後も genericDefinition reload を必要 (rename の逆操作)
      const RELOAD_EVENTS = [
        "screenChanged", "tableChanged", "processFlowChanged", "viewChanged",
        "sequenceChanged", "viewDefinitionChanged", "pageLayoutChanged",
        "genericDefinitionChanged",
      ];
      for (const ev of RELOAD_EVENTS) {
        bridge.broadcast({
          wsId: opRoot, event: ev, data: { reload: true },
          // Phase F S-1: undo は originating client を除外しない (cache 同期保証)
        });
      }
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },
};
