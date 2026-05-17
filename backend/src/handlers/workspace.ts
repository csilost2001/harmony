/**
 * ワークスペース管理系 MCP tool handler (#1144 Phase-1、#671 機能の MCP 露出)。
 *
 * 対象 (6 ツール):
 * - designer__workspace_list
 * - designer__workspace_status
 * - designer__workspace_open
 * - designer__workspace_inspect
 * - designer__workspace_close
 * - designer__workspace_remove
 *
 * workspaceState (per-session active path) と recentStore の同期、broadcast 含む。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { readProject } from "../projectStorage.js";
import {
  getActivePath,
  setActivePath,
  clearActive,
  isLockdown,
  getLockdownPath,
  LockdownError,
  workspaceContextManager,
  LOCKDOWN_WORKSPACE_ID,
} from "../workspaceState.js";
import {
  listWorkspaces,
  upsertWorkspace,
  removeWorkspace,
  findById,
  findByPath,
  setLastActive,
} from "../recentStore.js";
import { inspectWorkspacePath, initializeWorkspace } from "../workspaceInit.js";
import { wsBridge } from "../wsBridge.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleWorkspaceTool: ToolHandler = async (name, args, _root, sessionId) => {
  const a = args ?? {};

  switch (name) {
    case "designer__workspace_list": {
      const lockdown = isLockdown();
      const { workspaces, lastActiveId } = lockdown
        ? { workspaces: [], lastActiveId: null }
        : await listWorkspaces();
      const activePath = getActivePath(sessionId);
      const activeEntry = activePath ? await findByPath(activePath) : null;
      const lockdownPath = getLockdownPath();
      const payload = {
        workspaces,
        lastActiveId,
        active: activePath
          ? { id: lockdown ? LOCKDOWN_WORKSPACE_ID : activeEntry?.id ?? null, path: activePath, name: activeEntry?.name ?? null }
          : null,
        lockdown,
        lockdownPath,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }

    case "designer__workspace_status": {
      const activePath = getActivePath(sessionId);
      let activeName: string | null = null;
      if (activePath) {
        const entry = await findByPath(activePath);
        activeName = entry?.name ?? null;
      }
      const payload = {
        active: activePath ? { path: activePath, name: activeName } : null,
        lockdown: isLockdown(),
        lockdownPath: getLockdownPath(),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }

    case "designer__workspace_open": {
      const initFlag = a.init === true;
      if (typeof a.path !== "string" && typeof a.id !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "path または id のいずれかが必要です");
      }
      if (initFlag && typeof a.path !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "init=true の場合は path が必須です");
      }
      let target = typeof a.path === "string" ? a.path : null;
      if (!target && typeof a.id === "string") {
        const entry = await findById(a.id);
        if (!entry) throw new McpError(ErrorCode.InvalidParams, `id ${a.id} のワークスペースが見つかりません`);
        target = entry.path;
      }
      if (!target) throw new McpError(ErrorCode.InvalidParams, "path 解決に失敗しました");

      // init=true のとき: フォルダ作成 + harmony.json 初期化を行ってから open する (#672)
      // init=false のとき: stale recent / typo path を active 化して fs を破壊しないよう、
      // open 前に inspect で ready 状態を確認 (notFound / needsInit は reject)
      let resolvedName: string | null = null;
      if (initFlag) {
        if (isLockdown()) {
          throw new McpError(ErrorCode.InvalidParams, "lockdown モード中は新規ワークスペース初期化はできません");
        }
        try {
          const dataDirArg = typeof a.dataDir === "string" ? a.dataDir : undefined;
          const initRes = await initializeWorkspace(target, dataDirArg ? { dataDir: dataDirArg } : undefined);
          resolvedName = initRes.name;
          target = initRes.path;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new McpError(ErrorCode.InternalError, `ワークスペース初期化失敗: ${msg}`);
        }
      } else {
        const inspect = await inspectWorkspacePath(target);
        if (inspect.status !== "ready") {
          throw new McpError(
            ErrorCode.InvalidParams,
            inspect.status === "notFound"
              ? `フォルダが見つかりません: ${target}`
              : `ワークスペースが初期化されていません (harmony.json なし): ${target}。init=true で初期化してください。`,
          );
        }
      }

      try {
        setActivePath(sessionId, target);
      } catch (e) {
        if (e instanceof LockdownError) {
          throw new McpError(ErrorCode.InvalidParams, e.message);
        }
        throw e;
      }
      // harmony.json を読んで name をキャッシュ。失敗時は basename にフォールバック
      let name = resolvedName ?? path.basename(target);
      try {
        // open 後の root は target (setActivePath 直後)。readProject は active path を見るため
        // workspaceContextManager.requireActivePath(sessionId) と等価。
        const proj = await readProject(workspaceContextManager.requireActivePath(sessionId));
        if (proj && typeof proj === "object" && proj !== null) {
          const meta = (proj as Record<string, unknown>).meta;
          if (meta && typeof meta === "object" && meta !== null) {
            const n = (meta as Record<string, unknown>).name;
            if (typeof n === "string" && n.trim().length > 0) name = n;
          }
        }
      } catch { /* fallback to basename / init result */ }
      const entry = await upsertWorkspace(target, name);
      await setLastActive(entry.id);
      // workspace.open broadcast: 同 path を active にしている session のみ受信 (#703 R-5 A-2)
      wsBridge.broadcast({ wsId: entry.path, event: "workspace.changed", data: {
        activeId: entry.id,
        path: entry.path,
        name: entry.name,
        lockdown: isLockdown(),
      } });
      return { content: [{ type: "text", text: `ワークスペース「${entry.name}」を開きました (${entry.path})` }] };
    }

    case "designer__workspace_inspect": {
      if (typeof a.path !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "path は必須です");
      }
      const result = await inspectWorkspacePath(a.path);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "designer__workspace_close": {
      // close 前に現在の path をキャプチャ (close 後は getActivePath が null になるため)
      const closingPath = workspaceContextManager.getActivePath(sessionId);
      try {
        clearActive(sessionId);
      } catch (e) {
        if (e instanceof LockdownError) {
          throw new McpError(ErrorCode.InvalidParams, e.message);
        }
        throw e;
      }
      await setLastActive(null);
      // workspace.close broadcast: close 前の path を持つ session のみ受信 (#703 R-5 A-2)
      wsBridge.broadcast({ wsId: closingPath, event: "workspace.changed", data: {
        activeId: null,
        path: null,
        name: null,
        lockdown: isLockdown(),
      } });
      return { content: [{ type: "text", text: "ワークスペースを閉じました。" }] };
    }

    case "designer__workspace_remove": {
      if (isLockdown()) {
        throw new McpError(ErrorCode.InvalidParams, "lockdown モード中はワークスペースを除外できません");
      }
      if (typeof a.id !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "id は必須です");
      }
      const removed = await removeWorkspace(a.id);
      if (!removed) {
        return { content: [{ type: "text", text: `id ${a.id} のワークスペースは見つかりませんでした。` }] };
      }
      return { content: [{ type: "text", text: `id ${a.id} を recent から除外しました (ファイルは変更されません)。` }] };
    }

    default:
      return null;
  }
};
