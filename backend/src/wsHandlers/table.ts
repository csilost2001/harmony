/**
 * Table / ER Layout / Screen Flow Positions 系 RPC handler (#1144 Phase-2)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 9 RPC method を分離:
 * - loadTable / saveTable / deleteTable / listAllTables
 * - loadErLayout / saveErLayout
 * - loadScreenFlowPositions / saveScreenFlowPositions
 *
 * 機能不変 — case body は一字一句変更なし。
 */
import {
  readTable,
  writeTable,
  deleteTable as deleteTableFile,
  listAllTables,
  readErLayout,
  writeErLayout,
  readScreenFlowPositions,
  writeScreenFlowPositions,
} from "../projectStorage.js";
import type { RpcHandlerMap } from "./types.js";

export const tableHandlers: RpcHandlerMap = {
  loadTable: async ({ params, root, respond }) => {
    const { tableId } = (params ?? {}) as { tableId: string };
    const tableData = await readTable(tableId, root());
    respond(tableData);
  },

  saveTable: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { tableId, data } = (params ?? {}) as { tableId: string; data: unknown };
    await writeTable(tableId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "tableChanged", data: { tableId }, excludeClientId: clientId });
  },

  deleteTable: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { tableId } = (params ?? {}) as { tableId: string };
    await deleteTableFile(tableId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "tableChanged", data: { tableId, deleted: true }, excludeClientId: clientId });
  },

  listAllTables: async ({ root, respond }) => {
    const tablesData = await listAllTables(root());
    respond(tablesData);
  },

  loadErLayout: async ({ root, respond }) => {
    const layoutData = await readErLayout(root());
    respond(layoutData);
  },

  saveErLayout: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { data } = (params ?? {}) as { data: unknown };
    await writeErLayout(data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "erLayoutChanged", data: {}, excludeClientId: clientId });
  },

  loadScreenFlowPositions: async ({ root, respond }) => {
    const layoutData = await readScreenFlowPositions(root());
    respond(layoutData);
  },

  saveScreenFlowPositions: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { data } = (params ?? {}) as { data: unknown };
    await writeScreenFlowPositions(data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "screenFlowPositionsChanged", data: {}, excludeClientId: clientId });
  },
};
