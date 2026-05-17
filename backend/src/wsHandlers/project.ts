/**
 * Project / Screen / CustomBlock / PuckComponent / PuckData 系 RPC handler (#1144 Phase-2)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 13 RPC method を分離:
 * - loadProject / saveProject
 * - loadScreen / loadPageLayoutDesign / saveScreen
 * - loadScreenEntity / saveScreenEntity / deleteScreen
 * - loadCustomBlocks / saveCustomBlocks
 * - loadPuckComponents / savePuckComponents
 * - loadPuckData / savePuckData
 *
 * 機能不変 — case body は一字一句変更なし (lint/format 適用のみ)。
 */
import {
  readProject,
  writeProject,
  readScreen,
  writeScreen,
  readScreenEntity,
  writeScreenEntity,
  deleteScreen as deleteScreenFile,
  readCustomBlocks,
  writeCustomBlocks,
  readPuckComponents,
  writePuckComponents,
  readPuckData,
  writePuckData,
  readPageLayoutDesign,
  writePageLayoutDesign,
} from "../projectStorage.js";
import type { RpcHandlerMap } from "./types.js";

export const projectHandlers: RpcHandlerMap = {
  loadProject: async ({ root, respond }) => {
    const project = await readProject(root());
    respond(project);
  },

  saveProject: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { project } = (params ?? {}) as { project: unknown };
    await writeProject(project, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
  },

  loadScreen: async ({ params, root, respond }) => {
    const { screenId } = (params ?? {}) as { screenId: string };
    // RFC #1021 pl-6 (Codex A-2): PageLayout Designer は synthetic id `page-layout:<id>` で来るので
    // PageLayout design storage に routing (Windows 不正ファイル名 + 永続化境界違反の解消)
    if (screenId.startsWith("page-layout:")) {
      const plId = screenId.slice("page-layout:".length);
      const data = await readPageLayoutDesign(plId, root());
      respond(data);
      return;
    }
    const data = await readScreen(screenId, root());
    respond(data);
  },

  // RFC #1021 pl-6 (Codex A-2 補強): synthetic id 経路に依存しない dedicated handler
  // (composition preview / 外部呼び出しで明示的に使う)
  loadPageLayoutDesign: async ({ params, root, respond }) => {
    const { pageLayoutId } = (params ?? {}) as { pageLayoutId: string };
    const data = await readPageLayoutDesign(pageLayoutId, root());
    respond(data);
  },

  // RPC "savePageLayoutDesign" は frontend / MCP tools 双方から参照 0 件 (dead)。
  // saveScreen 経路 (screenId が "page-layout:" prefix 時) で同等処理が走るため不要。
  // ISSUE #1147 S-16 で dispatcher から削除。
  saveScreen: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
    // RFC #1021 pl-6 (Codex A-2): PageLayout design は専用 storage へ
    if (screenId.startsWith("page-layout:")) {
      const plId = screenId.slice("page-layout:".length);
      await writePageLayoutDesign(plId, data, root());
      respond({ success: true });
      bridge.broadcast({ wsId: wsId(), event: "pageLayoutChanged", data: { pageLayoutId: plId }, excludeClientId: clientId });
      return;
    }
    await writeScreen(screenId, data, root());
    // 初回デザイン保存時に project の hasDesign フラグを更新
    try {
      const project = (await readProject(root())) as
        | { screens?: Array<{ id: string; hasDesign?: boolean; updatedAt?: string }>; updatedAt?: string }
        | null;
      if (project?.screens) {
        const screen = project.screens.find((s) => s.id === screenId);
        if (screen && !screen.hasDesign) {
          screen.hasDesign = true;
          screen.updatedAt = new Date().toISOString();
          project.updatedAt = new Date().toISOString();
          await writeProject(project, root());
          bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
        }
      }
    } catch (e) {
      console.error("[WsBridge] Failed to update hasDesign:", e);
    }
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId }, excludeClientId: clientId });
  },

  loadScreenEntity: async ({ params, root, respond }) => {
    const { screenId } = (params ?? {}) as { screenId: string };
    const data = await readScreenEntity(screenId, root());
    respond(data);
  },

  saveScreenEntity: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
    await writeScreenEntity(screenId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "screenEntityChanged", data: { screenId }, excludeClientId: clientId });
    bridge.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
  },

  deleteScreen: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { screenId } = (params ?? {}) as { screenId: string };
    await deleteScreenFile(screenId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId, deleted: true }, excludeClientId: clientId });
  },

  loadCustomBlocks: async ({ root, respond }) => {
    const blocks = await readCustomBlocks(root());
    respond(blocks);
  },

  saveCustomBlocks: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { blocks } = (params ?? {}) as { blocks: unknown[] };
    await writeCustomBlocks(blocks, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "customBlocksChanged", data: {}, excludeClientId: clientId });
  },

  loadPuckComponents: async ({ root, respond }) => {
    const components = await readPuckComponents(root());
    respond(components);
  },

  savePuckComponents: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { components } = (params ?? {}) as { components: unknown[] };
    await writePuckComponents(components, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "puckComponentsChanged", data: {}, excludeClientId: clientId });
  },

  loadPuckData: async ({ params, root, respond }) => {
    // #806: Puck Data を screens/<id>/puck-data.json から読み込み
    const { screenId } = (params ?? {}) as { screenId: string };
    const puckData = await readPuckData(screenId, root());
    respond(puckData);
  },

  savePuckData: async ({ params, root, wsId, clientId, respond, bridge }) => {
    // #806: Puck Data を screens/<id>/puck-data.json に書き込み
    const { screenId, data: puckDataPayload } = (params ?? {}) as { screenId: string; data: unknown };
    await writePuckData(screenId, puckDataPayload, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "puckDataChanged", data: { screenId }, excludeClientId: clientId });
  },
};
