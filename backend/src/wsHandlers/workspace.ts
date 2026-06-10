/**
 * Workspace 系 RPC handler (#1144 Phase-2 — #671/#672/#673)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 8 RPC method を分離:
 * - workspace.list / workspace.status / workspace.inspect / workspace.hostInfo
 * - workspace.browseFs / workspace.open / workspace.close / workspace.remove
 * - workspace.roots / workspace.root.add / workspace.root.remove / workspace.root.discover
 *
 * 機能不変 — case body は一字一句変更なし。
 *
 * 注意: workspace.open はワークスペース状態 (active path) を per-session に書き換える。
 * また EditSessionStore の cleanup (close 時) は wsBridge に内部実装が残るため、
 * `bridge.deleteEditSessionStoreForWorkspace(path)` 経由で呼び出す。
 */
import {
  isLockdown as isWorkspaceLockdown,
  getLockdownPath as getWorkspaceLockdownPath,
  LockdownError as WorkspaceLockdownError,
  LOCKDOWN_WORKSPACE_ID,
  workspaceContextManager,
} from "../workspaceState.js";
import {
  listDisplayWorkspaces as listWorkspacesEntries,
  upsertWorkspace as upsertWorkspaceEntry,
  removeWorkspace as removeWorkspaceEntry,
  findById as findWorkspaceById,
  findByPath as findWorkspaceByPath,
  setLastActive as setLastActiveWorkspace,
  listWorkspaceRoots,
  upsertWorkspaceRoot,
  removeWorkspaceRoot,
} from "../recentStore.js";
import {
  discoverWorkspaceCandidates,
  inspectWorkspacePath,
  initializeWorkspace as initializeWorkspaceFolder,
} from "../workspaceInit.js";
import { getHostInfo } from "../hostInfo.js";
import { browseFs, BrowseFsError } from "../fsBrowse.js";
import { readProject } from "../projectStorage.js";
import type { RpcHandlerMap } from "./types.js";

export const workspaceHandlers: RpcHandlerMap = {
  "workspace.list": async ({ clientId, respond }) => {
    const lockdown = isWorkspaceLockdown();
    const { workspaces, lastActiveId } = lockdown
      ? { workspaces: [], lastActiveId: null }
      : await listWorkspacesEntries();
    const activePath = workspaceContextManager.getActivePath(clientId);
    const activeEntry = activePath ? await findWorkspaceByPath(activePath) : null;
    respond({
      workspaces,
      lastActiveId,
      active: activePath
        ? { id: lockdown ? LOCKDOWN_WORKSPACE_ID : activeEntry?.id ?? null, path: activePath, name: activeEntry?.name ?? null }
        : null,
      lockdown,
      lockdownPath: getWorkspaceLockdownPath(),
    });
  },

  "workspace.status": async ({ clientId, respond }) => {
    const activePath = workspaceContextManager.getActivePath(clientId);
    let activeName: string | null = null;
    if (activePath) {
      const entry = await findWorkspaceByPath(activePath);
      activeName = entry?.name ?? null;
    }
    respond({
      active: activePath ? { path: activePath, name: activeName } : null,
      lockdown: isWorkspaceLockdown(),
      lockdownPath: getWorkspaceLockdownPath(),
    });
  },

  "workspace.inspect": async ({ params, respond, respondError }) => {
    const { path: targetPath } = (params ?? {}) as { path?: string };
    if (typeof targetPath !== "string") {
      respondError("path は必須です");
      return;
    }
    const r = await inspectWorkspacePath(targetPath);
    respond(r);
  },

  "workspace.hostInfo": async ({ respond }) => {
    const info = await getHostInfo();
    respond(info);
  },

  "workspace.browseFs": async ({ params, respond, respondError }) => {
    const { path: targetPath } = (params ?? {}) as { path?: string };
    try {
      const result = await browseFs(typeof targetPath === "string" ? targetPath : undefined);
      respond(result);
    } catch (e) {
      if (e instanceof BrowseFsError) {
        respondError(e.message);
      } else {
        throw e;
      }
    }
  },

  "workspace.roots": async ({ respond }) => {
    respond({ roots: await listWorkspaceRoots() });
  },

  "workspace.root.add": async ({ params, respond, respondError }) => {
    if (isWorkspaceLockdown()) { respondError("lockdown モード中は workspace root を追加できません"); return; }
    const { path: rootPath, label } = (params ?? {}) as { path?: string; label?: string };
    if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
      respondError("path は必須です");
      return;
    }
    const inspect = await inspectWorkspacePath(rootPath);
    if (inspect.status === "notFound") {
      respondError(`フォルダが見つかりません: ${rootPath}`);
      return;
    }
    const root = await upsertWorkspaceRoot(rootPath, label);
    respond({ root });
  },

  "workspace.root.remove": async ({ params, respond, respondError }) => {
    if (isWorkspaceLockdown()) { respondError("lockdown モード中は workspace root を除外できません"); return; }
    const { id } = (params ?? {}) as { id?: string };
    if (typeof id !== "string") { respondError("id は必須です"); return; }
    respond({ removed: await removeWorkspaceRoot(id) });
  },

  "workspace.root.discover": async ({ params, respond, respondError }) => {
    const { path: rootPath, rootId, maxDepth, limit } = (params ?? {}) as {
      path?: string; rootId?: string; maxDepth?: number; limit?: number
    };
    let resolved = typeof rootPath === "string" ? rootPath : null;
    if (!resolved && typeof rootId === "string") {
      const roots = await listWorkspaceRoots();
      const root = roots.find((r) => r.id === rootId);
      if (!root) { respondError(`id ${rootId} の workspace root が見つかりません`); return; }
      resolved = root.path;
    }
    if (!resolved) { respondError("path または rootId のいずれかが必要です"); return; }
    const inspect = await inspectWorkspacePath(resolved);
    if (inspect.status === "notFound") {
      respondError(`フォルダが見つかりません: ${resolved}`);
      return;
    }
    const result = await discoverWorkspaceCandidates(resolved, {
      maxDepth: typeof maxDepth === "number" ? maxDepth : undefined,
      limit: typeof limit === "number" ? limit : undefined,
    });
    respond(result);
  },

  "workspace.open": async ({ params, clientId, respond, respondError, bridge }) => {
    const { path: targetPath, id, init, dataDir: initDataDir } = (params ?? {}) as {
      path?: string; id?: string; init?: boolean; dataDir?: string
    };
    if (typeof targetPath !== "string" && typeof id !== "string") {
      respondError("path または id のいずれかが必要です");
      return;
    }
    const initFlag = init === true;
    if (initFlag && typeof targetPath !== "string") {
      respondError("init=true の場合は path が必須です");
      return;
    }
    let resolved = typeof targetPath === "string" ? targetPath : null;
    if (!resolved && typeof id === "string") {
      // S-010: lockdown モード中は recent.json を読まず、lockdown パスのみを返す (CWE-863)
      if (isWorkspaceLockdown()) {
        const lockdownPath = getWorkspaceLockdownPath();
        if (!lockdownPath) { respondError("lockdown パスが未設定です"); return; }
        resolved = lockdownPath;
      } else {
        const entry = await findWorkspaceById(id);
        if (!entry) { respondError(`id ${id} のワークスペースが見つかりません`); return; }
        resolved = entry.path;
      }
    }
    if (!resolved) { respondError("path 解決に失敗しました"); return; }
    let initName: string | null = null;
    if (initFlag) {
      if (isWorkspaceLockdown()) { respondError("lockdown モード中は新規ワークスペース初期化はできません"); return; }
      try {
        const initOpts = typeof initDataDir === "string" ? { dataDir: initDataDir } : undefined;
        const initRes = await initializeWorkspaceFolder(resolved, initOpts);
        initName = initRes.name;
        resolved = initRes.path;
      } catch (e) {
        respondError(`ワークスペース初期化失敗: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    } else {
      const inspect = await inspectWorkspacePath(resolved);
      if (inspect.status !== "ready") {
        respondError(
          inspect.status === "notFound"
            ? `フォルダが見つかりません: ${resolved}`
            : inspect.status === "invalid"
              ? `ワークスペースの harmony.json が不正です: ${(inspect as { reason?: string }).reason ?? ""}`
              : `ワークスペースが初期化されていません (harmony.json が見つかりません): ${resolved}。init=true で初期化してください。`,
        );
        return;
      }
    }
    try {
      workspaceContextManager.setActivePath(clientId, resolved);
    } catch (e) {
      if (e instanceof WorkspaceLockdownError) { respondError(e.message); return; }
      throw e;
    }
    let name = initName ?? resolved.split(/[\\/]/).pop() ?? "";
    try {
      const proj = await readProject(resolved);
      if (proj && typeof proj === "object" && proj !== null) {
        const meta = (proj as Record<string, unknown>).meta;
        if (meta && typeof meta === "object" && meta !== null) {
          const n = (meta as Record<string, unknown>).name;
          if (typeof n === "string" && n.trim().length > 0) name = n;
        }
      }
    } catch { /* fallback */ }
    const entry = await upsertWorkspaceEntry(resolved, name);
    await setLastActiveWorkspace(entry.id);
    respond({ active: { id: entry.id, path: entry.path, name: entry.name } });
    bridge.broadcast({ wsId: entry.path, event: "workspace.changed", data: {
      activeId: entry.id,
      path: entry.path,
      name: entry.name,
      lockdown: isWorkspaceLockdown(),
    }, excludeClientId: clientId });
  },

  "workspace.close": async ({ clientId, respond, respondError, bridge }) => {
    const closingPath = workspaceContextManager.getActivePath(clientId);
    try {
      workspaceContextManager.clearActive(clientId);
    } catch (e) {
      if (e instanceof WorkspaceLockdownError) { respondError(e.message); return; }
      throw e;
    }
    await setLastActiveWorkspace(null);
    if (closingPath) {
      bridge.deleteEditSessionStoreForWorkspace(closingPath);
    }
    respond({ success: true });
    bridge.broadcast({ wsId: closingPath, event: "workspace.changed", data: {
      activeId: null, path: null, name: null, lockdown: isWorkspaceLockdown(),
    }, excludeClientId: clientId });
  },

  "workspace.remove": async ({ params, respond, respondError }) => {
    if (isWorkspaceLockdown()) { respondError("lockdown モード中はワークスペースを除外できません"); return; }
    const { id } = (params ?? {}) as { id?: string };
    if (typeof id !== "string") { respondError("id は必須です"); return; }
    const removed = await removeWorkspaceEntry(id);
    respond({ removed });
  },
};
