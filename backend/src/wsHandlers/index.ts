/**
 * wsHandlers aggregate (#1144 Phase-2)
 *
 * 機能領域別 RPC handler 7 ファイル (project / table / processFlow / misc /
 * workspace / presence / editSession / codex) を 1 つの map に統合し、wsBridge から
 * Map<string, RpcHandler> として lookup される。
 *
 * key 重複 (同じ method 名が複数 file に存在) は development time に検出可能
 * (TypeScript の object literal spread は後勝ち、test で全 method の uniqueness を担保)。
 */
import { codexHandlers } from "./codex.js";
import { editSessionHandlers } from "./editSession.js";
import { miscHandlers } from "./misc.js";
import { presenceHandlers } from "./presence.js";
import { processFlowHandlers } from "./processFlow.js";
import { projectHandlers } from "./project.js";
import { tableHandlers } from "./table.js";
import { workspaceHandlers } from "./workspace.js";
import type { RpcHandler, RpcHandlerMap } from "./types.js";

/**
 * 全 RPC method → handler の統合 map (Phase-2 で 60 method を 8 ファイルから集約)。
 *
 * 機能領域別 file の export 順を固定 (アルファベット順) で merge。
 * 同名 method が複数 file にあると後勝ちになるが、Phase-2 では全 method が一意。
 */
export const allRpcHandlers: RpcHandlerMap = {
  ...projectHandlers,
  ...tableHandlers,
  ...processFlowHandlers,
  ...miscHandlers,
  ...workspaceHandlers,
  ...presenceHandlers,
  ...editSessionHandlers,
  ...codexHandlers,
};

/** Map 形式 (wsBridge での lookup 用)。 */
export const rpcHandlerMap: Map<string, RpcHandler> = new Map(Object.entries(allRpcHandlers));

export type { RpcContext, RpcHandler, RpcHandlerMap } from "./types.js";
