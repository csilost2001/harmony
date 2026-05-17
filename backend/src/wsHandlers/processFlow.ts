/**
 * ProcessFlow / Sequence / View / ViewDefinition / GenericDefinition / PageLayout 系
 * RPC handler (#1144 Phase-2)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 21 RPC method を分離:
 * - loadProcessFlow / saveProcessFlow / deleteProcessFlow / listProcessFlows
 * - listAllViews / listAllViewDefinitions
 * - loadSequence / saveSequence / deleteSequence
 * - loadView / saveView / deleteView
 * - loadViewDefinition / saveViewDefinition / deleteViewDefinition
 * - listAllGenericDefinitions / loadGenericDefinition / saveGenericDefinition / deleteGenericDefinition
 * - loadPageLayout / savePageLayout / deletePageLayout / listAllPageLayouts
 *
 * 機能不変 — case body は一字一句変更なし。
 */
import {
  readProcessFlow,
  writeProcessFlow,
  deleteProcessFlow as deleteProcessFlowFile,
  listProcessFlows as listProcessFlowFiles,
  readSequence,
  writeSequence,
  deleteSequence as deleteSequenceFile,
  readView,
  writeView,
  deleteView as deleteViewFile,
  listAllViews,
  readViewDefinition,
  writeViewDefinition,
  deleteViewDefinition as deleteViewDefinitionFile,
  listAllViewDefinitions,
  listAllGenericDefinitions,
  readGenericDefinition,
  writeGenericDefinition,
  deleteGenericDefinition,
  readPageLayout,
  writePageLayout,
  deletePageLayoutFile,
  listAllPageLayouts,
} from "../projectStorage.js";
import type { RpcHandlerMap } from "./types.js";

export const processFlowHandlers: RpcHandlerMap = {
  loadProcessFlow: async ({ params, root, respond }) => {
    const { id: agId } = (params ?? {}) as { id: string };
    const agData = await readProcessFlow(agId, root());
    respond(agData);
  },

  saveProcessFlow: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { id: agId, data: agData } = (params ?? {}) as { id: string; data: unknown };
    await writeProcessFlow(agId, agData, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId }, excludeClientId: clientId });
  },

  deleteProcessFlow: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { id: agId } = (params ?? {}) as { id: string };
    await deleteProcessFlowFile(agId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId, deleted: true }, excludeClientId: clientId });
  },

  listProcessFlows: async ({ root, respond }) => {
    const agList = await listProcessFlowFiles(root());
    const metas = (agList as Array<{ id: string; name: string; type: string; screenId?: string; actions?: unknown[]; updatedAt: string }>).map((ag) => ({
      id: ag.id,
      name: ag.name,
      type: ag.type,
      screenId: ag.screenId,
      actionCount: ag.actions?.length ?? 0,
      updatedAt: ag.updatedAt,
    }));
    respond(metas);
  },

  listAllViews: async ({ root, respond }) => {
    const viewsData = await listAllViews(root());
    respond(viewsData);
  },

  listAllViewDefinitions: async ({ root, respond }) => {
    const viewDefinitionsData = await listAllViewDefinitions(root());
    respond(viewDefinitionsData);
  },

  // RPC "loadScreenItems" / "saveScreenItems" / "deleteScreenItems" は
  // frontend が screenItemsStore 経由で loadScreenEntity / saveScreenEntity
  // (Screen entity に embed された items を直接読み書き) に切り替えたため、
  // 全て参照 0 件 (dead) となった。saveScreenEntity 経路で screenItemsChanged
  // broadcast も継続発火されるため UI 同期に影響なし。
  // ISSUE #1147 N-6 で dispatcher から削除。

  loadSequence: async ({ params, root, respond }) => {
    const { sequenceId } = (params ?? {}) as { sequenceId: string };
    const seqData = await readSequence(sequenceId, root());
    respond(seqData);
  },

  saveSequence: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { sequenceId, data } = (params ?? {}) as { sequenceId: string; data: unknown };
    await writeSequence(sequenceId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId }, excludeClientId: clientId });
  },

  deleteSequence: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { sequenceId } = (params ?? {}) as { sequenceId: string };
    await deleteSequenceFile(sequenceId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId, deleted: true }, excludeClientId: clientId });
  },

  loadView: async ({ params, root, respond }) => {
    const { viewId } = (params ?? {}) as { viewId: string };
    const data = await readView(viewId, root());
    respond(data);
  },

  saveView: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { viewId, data } = (params ?? {}) as { viewId: string; data: unknown };
    await writeView(viewId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId }, excludeClientId: clientId });
  },

  deleteView: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { viewId } = (params ?? {}) as { viewId: string };
    await deleteViewFile(viewId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId, deleted: true }, excludeClientId: clientId });
  },

  loadViewDefinition: async ({ params, root, respond }) => {
    const { viewDefinitionId } = (params ?? {}) as { viewDefinitionId: string };
    const data = await readViewDefinition(viewDefinitionId, root());
    respond(data);
  },

  saveViewDefinition: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { viewDefinitionId, data } = (params ?? {}) as { viewDefinitionId: string; data: unknown };
    await writeViewDefinition(viewDefinitionId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId }, excludeClientId: clientId });
  },

  deleteViewDefinition: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { viewDefinitionId } = (params ?? {}) as { viewDefinitionId: string };
    await deleteViewDefinitionFile(viewDefinitionId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId, deleted: true }, excludeClientId: clientId });
  },

  listAllGenericDefinitions: async ({ params, root, respond }) => {
    const { kind } = (params ?? {}) as { kind: string };
    const data = await listAllGenericDefinitions(root(), kind);
    respond(data);
  },

  loadGenericDefinition: async ({ params, root, respond }) => {
    const { kind, name } = (params ?? {}) as { kind: string; name: string };
    const data = await readGenericDefinition(name, kind, root());
    respond(data);
  },

  saveGenericDefinition: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { kind, name, data } = (params ?? {}) as { kind: string; name: string; data: unknown };
    await writeGenericDefinition(name, kind, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "genericDefinitionChanged", data: { kind, name }, excludeClientId: clientId });
  },

  deleteGenericDefinition: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { kind, name } = (params ?? {}) as { kind: string; name: string };
    await deleteGenericDefinition(name, kind, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "genericDefinitionChanged", data: { kind, name, deleted: true }, excludeClientId: clientId });
  },

  loadPageLayout: async ({ params, root, respond }) => {
    const { pageLayoutId } = (params ?? {}) as { pageLayoutId: string };
    const data = await readPageLayout(pageLayoutId, root());
    respond(data);
  },

  savePageLayout: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { pageLayoutId, data } = (params ?? {}) as { pageLayoutId: string; data: unknown };
    await writePageLayout(pageLayoutId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "pageLayoutChanged", data: { pageLayoutId }, excludeClientId: clientId });
  },

  deletePageLayout: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { pageLayoutId } = (params ?? {}) as { pageLayoutId: string };
    await deletePageLayoutFile(pageLayoutId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "pageLayoutChanged", data: { pageLayoutId, deleted: true }, excludeClientId: clientId });
  },

  listAllPageLayouts: async ({ root, respond }) => {
    const data = await listAllPageLayouts(root());
    respond(data);
  },
};
