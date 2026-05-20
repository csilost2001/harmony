/**
 * Conventions / Extensions / ScreenItem rename / File mtime 系 RPC handler (#1144 Phase-2)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 8 RPC method を分離:
 * - loadConventions / loadProjectCatalogs / saveConventions
 * - getFileMtime
 * - getExtensions / saveExtensionPackage
 * - renameScreenItem / checkScreenItemRefs
 *
 * 機能不変 — case body は一字一句変更なし。
 */
import {
  readConventions,
  readExternalCatalogs,
  writeConventions,
  getFileMtime,
  readExtensionsBundle,
  writeExtensionsFile,
} from "../projectStorage.js";
import { renameScreenItemId, checkScreenItemRefs } from "../renameScreenItem.js";
import { assertUuid, assertSafeName } from "../security/idValidator.js";
import type { RpcHandlerMap } from "./types.js";

export const miscHandlers: RpcHandlerMap = {
  loadConventions: async ({ root, respond }) => {
    const catalog = await readConventions(root());
    respond(catalog);
  },

  loadProjectCatalogs: async ({ root, respond }) => {
    const catalog = await readExternalCatalogs(root());
    respond(catalog);
  },

  saveConventions: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { catalog } = (params ?? {}) as { catalog: unknown };
    await writeConventions(catalog, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "conventionsChanged", data: {}, excludeClientId: clientId });
  },

  getFileMtime: async ({ params, root, respond }) => {
    const { kind, id: fid } = (params ?? {}) as { kind: string; id?: string };
    const mtime = await getFileMtime(kind, root(), fid);
    respond({ mtime });
  },

  getExtensions: async ({ root, respond }) => {
    const bundle = await readExtensionsBundle(root());
    respond(bundle);
  },

  saveExtensionPackage: async ({ params, root, clientId, respond, respondError, bridge }) => {
    const { type, content } = (params ?? {}) as { type: string; content: unknown };
    if (!["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"].includes(type)) {
      respondError(`不明な拡張種別です: ${type}`);
      return;
    }
    try {
      await writeExtensionsFile(
        type as "steps" | "fieldTypes" | "triggers" | "dbOperations" | "responseTypes",
        content,
        root(),
        { onAfterWrite: () => bridge.broadcast({ wsId: root(), event: "extensionsChanged", data: { type }, excludeClientId: clientId }) },
      );
      respond({ success: true });
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  renameScreenItem: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { screenId, oldId, newId } = (params ?? {}) as {
      screenId: string; oldId: string; newId: string;
    };
    assertUuid(screenId, "screenId");
    assertSafeName(oldId, "oldId");
    assertSafeName(newId, "newId");
    const result = await renameScreenItemId(screenId, oldId, newId, root());
    respond(result);
    bridge.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
    for (const agId of result.processFlowsUpdated) {
      bridge.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId }, excludeClientId: clientId });
    }
    if (result.screenHtmlUpdated) {
      bridge.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId }, excludeClientId: clientId });
    }
  },

  checkScreenItemRefs: async ({ params, root, respond }) => {
    const { screenId, itemId } = (params ?? {}) as { screenId: string; itemId: string };
    const result = await checkScreenItemRefs(screenId, itemId, root());
    respond(result);
  },
};
