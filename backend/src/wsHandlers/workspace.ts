/**
 * Workspace 系 RPC handler (#1144 Phase-2 — #671/#672/#673)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 8 RPC method を分離:
 * - workspace.list / workspace.status / workspace.inspect / workspace.hostInfo
 * - workspace.browseFs / workspace.open / workspace.close / workspace.remove
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
  listWorkspaces as listWorkspacesEntries,
  upsertWorkspace as upsertWorkspaceEntry,
  removeWorkspace as removeWorkspaceEntry,
  findById as findWorkspaceById,
  findByPath as findWorkspaceByPath,
  setLastActive as setLastActiveWorkspace,
} from "../recentStore.js";
import {
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
    // per-session active path (#700 R-2)
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
      const entry = await findWorkspaceById(id);
      if (!entry) { respondError(`id ${id} のワークスペースが見つかりません`); return; }
      resolved = entry.path;
    }
    if (!resolved) { respondError("path 解決に失敗しました"); return; }
    let initName: string | null = null;
    if (initFlag) {
      if (isWorkspaceLockdown()) { respondError("lockdown モード中は新規ワークスペース初期化はできません"); return; }
      try {
        // dataDir は省略時 "harmony" がデフォルト (#852 R-3 D-5)
        const initOpts = typeof initDataDir === "string" ? { dataDir: initDataDir } : undefined;
        const initRes = await initializeWorkspaceFolder(resolved, initOpts);
        initName = initRes.name;
        resolved = initRes.path;
      } catch (e) {
        respondError(`ワークスペース初期化失敗: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    } else {
      // init=false 時: stale recent エントリ / typo パスを active 化して fs を破壊しないよう、
      // open 前に inspect で ready 状態を確認する (見つからない / harmony.json 無しは reject)
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
      // per-session context を更新 (#700 R-2)
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
    // workspace.open broadcast: 同 path を active にしている session のみ受信 (#703 R-5 A-2)
    bridge.broadcast({ wsId: entry.path, event: "workspace.changed", data: {
      activeId: entry.id,
      path: entry.path,
      name: entry.name,
      lockdown: isWorkspaceLockdown(),
    }, excludeClientId: clientId });
  },

  "workspace.close": async ({ clientId, respond, respondError, bridge }) => {
    // close 前に現在の path をキャプチャしておく (close 後は getActivePath が null になるため)
    const closingPath = workspaceContextManager.getActivePath(clientId);
    try {
      // per-session context を更新 (#700 R-2)
      workspaceContextManager.clearActive(clientId);
    } catch (e) {
      if (e instanceof WorkspaceLockdownError) { respondError(e.message); return; }
      throw e;
    }
    await setLastActiveWorkspace(null);
    // workspace close 時に EditSessionStore も cleanup (#899 Phase 2)
    if (closingPath) {
      bridge.deleteEditSessionStoreForWorkspace(closingPath);
    }
    respond({ success: true });
    // workspace.close broadcast: close 前のパスを持つ session のみ受信 (#703 R-5 A-2)
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
