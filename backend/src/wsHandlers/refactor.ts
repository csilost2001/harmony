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
 */
function fetchEditSessions(
  bridge: WsBridge,
  wsId: string | null,
  entityType: RenameEntityType,
  oldId: string,
): ReadonlyArray<EditSessionLike> {
  if (!wsId) return [];
  const resourceType = entityTypeToResourceType(entityType) as EditSessionResourceType;
  return bridge.editSessionListByResource(wsId, resourceType, oldId);
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
      const editSessions = fetchEditSessions(bridge, wsId(), et, oldId as string);
      const result = await previewEntityRename(et, oldId as string, newId as string, root(), {
        sessionId, editSessions,
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
      const editSessions = fetchEditSessions(bridge, wsId(), et, oldId as string);
      const result = await renameEntityId(et, oldId as string, newId as string, root(), {
        sessionId, editSessions,
      });
      respond(result);

      // broadcast: entityType 別 changed + 7 種 reload (UI cache 無効化)
      // S-2 (Opus 独立レビュー): rename / undo で同じ 7 種を broadcast (cache 不整合防止)
      const wid = wsId();
      bridge.broadcast({
        wsId: wid,
        event: `${et}Changed`,
        data: { oldId, newId, renamed: true },
        excludeClientId: clientId,
      });
      // 参照側 entity の cache を全 broadcast で reload させる (7 種全件)
      const RELOAD_EVENTS = [
        "screenChanged", "tableChanged", "processFlowChanged", "viewChanged",
        "sequenceChanged", "viewDefinitionChanged", "pageLayoutChanged",
      ];
      for (const ev of RELOAD_EVENTS) {
        if (ev === `${et}Changed`) continue; // 自身の event は上で発行済
        bridge.broadcast({
          wsId: wid, event: ev, data: { reload: true }, excludeClientId: clientId,
        });
      }
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  undoEntityRename: async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const { operationId } = (params ?? {}) as { operationId: unknown };
      // operationId は UUID v4 (uuid module で生成) — safeName 範囲内 ([A-Za-z0-9_-]{1,64}) でカバー
      assertSafeName(operationId, "operationId");
      const result = await undoEntityRename(operationId as string, root());
      respond(result);
      // Phase F S-1 (Codex 独立レビュー): undo は originating client 自身の cache (newId 側 store
      // データ + ref 側 cache) も完全に無効化する必要がある。renameEntityId の broadcast は
      // originating client を `excludeClientId` で除外しても良い (rename を起こした側は自分で
      // tab/URL 遷移 + handleRenameSuccess で旧 tab close 等の cache 入替を行うため不要)。
      // 一方 undo は editor が「同じ URL に戻る」だけのため、cache 同期は broadcast に頼る必要が
      // あり、originating client を除外すると stale cache が残る (固定 300ms hard delay は決定的
      // でない緩和策、Codex 独立レビュー S-1 で指摘)。
      // → undo 経路では excludeClientId を渡さず、originating client にも reload event を届ける。
      const wid = wsId();
      const RELOAD_EVENTS = [
        "screenChanged", "tableChanged", "processFlowChanged", "viewChanged",
        "sequenceChanged", "viewDefinitionChanged", "pageLayoutChanged",
      ];
      for (const ev of RELOAD_EVENTS) {
        bridge.broadcast({
          wsId: wid, event: ev, data: { reload: true },
          // Phase F S-1: undo は originating client を除外しない (cache 同期保証)
        });
      }
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },
};
