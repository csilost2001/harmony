/**
 * Presence 系 RPC handler (#1144 Phase-2 — #878 Phase 1)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 3 RPC method を分離:
 * - presence.heartbeat / presence.list / presence.register
 *
 * 機能不変 — case body は一字一句変更なし。
 */
import {
  registerEditor as presenceRegisterEditor,
  registerViewer as presenceRegisterViewer,
  heartbeat as presenceHeartbeat,
  list as presenceList,
} from "../presenceManager.js";
import type { DraftResourceType as EditSessionResourceType } from "../editSessionStore.js";
import type { RpcHandlerMap } from "./types.js";

export const presenceHandlers: RpcHandlerMap = {
  "presence.heartbeat": async ({ params, clientId, wsId, respond, respondError, bridge }) => {
    const {
      resourceType: phrt,
      resourceId: phrid,
      kind: phkind,
    } = (params ?? {}) as { resourceType: EditSessionResourceType; resourceId: string; kind: "activity" | "edit" };
    const phWsId = wsId();
    if (!phWsId) {
      respondError("ワークスペースが選択されていません");
      return;
    }
    const { levelChanged, entry, level } = presenceHeartbeat(phWsId, clientId, phrt, phrid, phkind);
    respond({ entry, level });
    // Phase 7 (#885): levelChanged が true の時のみ broadcast (broadcast 効率化)
    if (levelChanged) {
      const entries = presenceList(phWsId, phrt, phrid);
      bridge.broadcast({
        wsId: phWsId,
        event: "presence:update",
        data: { resourceType: phrt, resourceId: phrid, entries },
      });
    }
  },

  "presence.list": async ({ params, wsId, respond, respondError }) => {
    const { resourceType: plrt, resourceId: plrid } = (params ?? {}) as { resourceType: EditSessionResourceType; resourceId: string };
    const plWsId = wsId();
    if (!plWsId) {
      respondError("ワークスペースが選択されていません");
      return;
    }
    const entries = presenceList(plWsId, plrt, plrid);
    respond({ entries });
  },

  "presence.register": async ({ params, clientId, wsId, respond, respondError, bridge }) => {
    // Phase 1 では editor/viewer 手動登録 API を提供 (viewer role は Phase 2 で本格利用)
    const {
      resourceType: prrt,
      resourceId: prrid,
      role: prrole,
      ownerLabel: prownerLabel,
    } = (params ?? {}) as { resourceType: EditSessionResourceType; resourceId: string; role: "editor" | "viewer"; ownerLabel?: string };
    const prWsId = wsId();
    if (!prWsId) {
      respondError("ワークスペースが選択されていません");
      return;
    }
    let entry;
    if (prrole === "editor") {
      entry = presenceRegisterEditor(prWsId, clientId, prrt, prrid, prownerLabel);
    } else {
      entry = presenceRegisterViewer(prWsId, clientId, prrt, prrid);
    }
    respond({ entry });
    const allEntries = presenceList(prWsId, prrt, prrid);
    bridge.broadcast({
      wsId: prWsId,
      event: "presence:update",
      data: { resourceType: prrt, resourceId: prrid, entries: allEntries },
    });
  },
};
