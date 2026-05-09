import { mcpBridge } from "../mcp/mcpBridge";

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface WorkspaceEntry {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string | null;
}

export interface WorkspaceActive {
  id?: string;
  path: string;
  name: string | null;
}

export interface WorkspaceState {
  workspaces: WorkspaceEntry[];
  active: WorkspaceActive | null;
  lockdown: boolean;
  lockdownPath: string | null;
  loading: boolean;
  error: string | null;
}

export interface WorkspaceInspectResult {
  status: "ready" | "needsInit" | "notFound" | "invalid";
  path: string;
  name?: string;
  /** invalid ステータス時の理由メッセージ (#852 R-3) */
  reason?: string;
}

/** backend ホスト OS 情報 (#858: WSL2 環境で placeholder を切り替えるため) */
export interface HostInfo {
  platform: "linux" | "win32" | "darwin" | "other";
  isWSL: boolean;
  homeDir: string;
}

// ─── 内部ストア ───────────────────────────────────────────────────────────────

type Listener = () => void;

import { uiInfo, uiWarn } from "../utils/uiLog";

// loading は初期 true: WS 未接続のうちはガードを発動させない。
// 最初の loadWorkspaces() (成功 or 失敗) で false になる。WS が永続的に未接続でも
// loading=true のままなので /workspace/select への誤強制遷移を起こさない。
//
// テスト環境向け: "workspace-e2e-bypass" フラグが立っている場合 loading=false +
// error="e2e bypass" で起動。これにより MCP 未接続の e2e test が workspace guard を
// バイパスして dashboard, screen-design 等に直接アクセスできる (#703 R-5)。
// AppShell の workspace guard は `error !== null` で redirect を停止するため、
// bypass=true 時は error を立てておく必要がある (#704 multi-workspace 移行で URL pattern が
// /w/:wsId/* に変わった後、e2e test が /workspace/select に強制 redirect されていた regression
// を解消、#815 follow-up)。
//
// 設定方法 (playwright addInitScript 内):
//   localStorage.setItem("workspace-e2e-bypass", "true");
const _isE2eBypass = typeof localStorage !== "undefined"
  && localStorage.getItem("workspace-e2e-bypass") === "true";
const _initialLoading = !_isE2eBypass;

let _state: WorkspaceState = {
  workspaces: [],
  active: null,
  lockdown: false,
  lockdownPath: null,
  loading: _initialLoading,
  error: _isE2eBypass ? "e2e bypass" : null,
};

const _listeners = new Set<Listener>();
let _broadcastUnsubscribe: (() => void) | null = null;

function _setState(partial: Partial<WorkspaceState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn());
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

export function getState(): WorkspaceState {
  return _state;
}

export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

// 並行呼び出しを直列化するための Promise チェーン (A: loadWorkspaces 直列化)
let _loadChain: Promise<void> = Promise.resolve();

/** @internal テスト専用: _loadChain を初期状態にリセットする */
export function __resetLoadChainForTest(): void {
  _loadChain = Promise.resolve();
}

/** @internal テスト専用: _state を初期状態にリセットする (#703 R-5) */
export function __resetStateForTest(): void {
  _state = {
    workspaces: [],
    active: null,
    lockdown: false,
    lockdownPath: null,
    loading: true,
    error: null,
  };
  _broadcastUnsubscribe = null;
  _listeners.clear();
}

export async function loadWorkspaces(): Promise<void> {
  _loadChain = _loadChain
    .catch(() => undefined) // 前回失敗でチェーンを切らない
    .then(() => _doLoadWorkspaces());
  return _loadChain;
}

async function _doLoadWorkspaces(): Promise<void> {
  uiInfo("workspace", "loadWorkspaces start");
  _setState({ loading: true, error: null });
  try {
    const result = (await mcpBridge.request("workspace.list")) as {
      workspaces: WorkspaceEntry[];
      lastActiveId: string | null;
      active: { id: string | null; path: string; name: string | null } | null;
      lockdown: boolean;
      lockdownPath: string | null;
    };
    uiInfo("workspace", "loadWorkspaces success", {
      count: result.workspaces?.length ?? 0,
      activePath: result.active?.path ?? null,
      lockdown: result.lockdown,
    });
    _setState({
      workspaces: result.workspaces ?? [],
      active: result.active
        ? {
            id: result.active.id ?? undefined,
            path: result.active.path,
            name: result.active.name,
          }
        : null,
      lockdown: result.lockdown ?? false,
      lockdownPath: result.lockdownPath ?? null,
      loading: false,
      error: null,
    });
  } catch (e) {
    uiWarn("workspace", "loadWorkspaces failed", { error: e instanceof Error ? e.message : String(e) });
    _setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function inspectWorkspace(path: string): Promise<WorkspaceInspectResult> {
  const result = (await mcpBridge.request("workspace.inspect", { path })) as WorkspaceInspectResult;
  return result;
}

let _hostInfoCache: HostInfo | null = null;
let _hostInfoInflight: Promise<HostInfo> | null = null;

/**
 * backend のホスト OS 情報を取得 (セッション内 1 回キャッシュ、#858)。
 * WSL2 / macOS / Windows でパス入力欄の placeholder 文字列を切り替えるために使う。
 */
export async function getHostInfo(): Promise<HostInfo> {
  if (_hostInfoCache) return _hostInfoCache;
  if (_hostInfoInflight) return _hostInfoInflight;
  _hostInfoInflight = (async () => {
    try {
      const info = (await mcpBridge.request("workspace.hostInfo")) as HostInfo;
      _hostInfoCache = info;
      return info;
    } finally {
      _hostInfoInflight = null;
    }
  })();
  return _hostInfoInflight;
}

/** @internal テスト専用: hostInfo キャッシュをクリア */
export function __resetHostInfoCacheForTest(): void {
  _hostInfoCache = null;
  _hostInfoInflight = null;
}

export async function openWorkspace(pathOrId: string, useId = false): Promise<string> {
  _setState({ loading: true, error: null });
  try {
    const params = useId ? { id: pathOrId } : { path: pathOrId };
    await mcpBridge.request("workspace.open", params);
    await loadWorkspaces();
    const wsId = _state.active?.id;
    if (!wsId) {
      throw new Error("active workspace id is missing after open");
    }
    return wsId;
  } catch (e) {
    _setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function initAndOpen(path: string): Promise<void> {
  _setState({ loading: true, error: null });
  try {
    await mcpBridge.request("workspace.open", { path, init: true });
    await loadWorkspaces();
  } catch (e) {
    _setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function closeWorkspace(): Promise<void> {
  _setState({ loading: true, error: null });
  try {
    await mcpBridge.request("workspace.close");
    await loadWorkspaces();
  } catch (e) {
    _setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export async function removeWorkspace(id: string): Promise<void> {
  _setState({ loading: true, error: null });
  try {
    await mcpBridge.request("workspace.remove", { id });
    await loadWorkspaces();
  } catch (e) {
    _setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** workspace.changed ブロードキャストをサブスクライブし、状態を自動更新する */
export function subscribeWorkspaceChanges(): () => void {
  if (_broadcastUnsubscribe) {
    _broadcastUnsubscribe();
    _broadcastUnsubscribe = null;
  }

  const unsub = mcpBridge.onBroadcast("workspace.changed", (data) => {
    const ev = data as {
      activeId: string | null;
      path: string | null;
      name: string | null;
      lockdown: boolean;
    };

    // Defense-in-depth: per-session フィルタ (#703 R-5 B)
    // backend は wsId scoping で既にフィルタしているが、WS マルチプレックス環境の念のため:
    // - 自分の active が null の場合 → hydration broadcast として受信 (初回 active 設定)
    // - 自分の active が非 null かつ ev.path が一致しない場合 → 別 workspace のブロードキャストを無視
    const currentActive = _state.active;
    uiInfo("ws-broadcast", "workspace.changed received", {
      currentActiveId: currentActive?.id ?? null,
      evActiveId: ev.activeId,
      evPath: ev.path,
      lockdown: ev.lockdown,
    });
    if (currentActive !== null && ev.path !== null && currentActive.path !== ev.path) {
      // 別 workspace の workspace.changed broadcast → ignore
      uiInfo("ws-broadcast", "ignored (path mismatch)", { current: currentActive.path, ev: ev.path });
      return;
    }

    // B: payload だけで state を完成させる。loadWorkspaces() は呼ばない。
    // recent list の更新は次の明示的 loadWorkspaces() (ListView mount 等) まで遅延 — 許容範囲。
    if (ev.activeId === null || ev.path === null) {
      _setState({ active: null, lockdown: ev.lockdown ?? false });
    } else {
      _setState({
        active: { id: ev.activeId, path: ev.path, name: ev.name },
        lockdown: ev.lockdown ?? false,
      });
    }
  });

  _broadcastUnsubscribe = unsub;
  return unsub;
}
