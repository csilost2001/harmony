/**
 * workspaceState.ts (#671 + #700)
 *
 * 現在 active なワークスペース (= project.json を含むフォルダ) の絶対パスを保持する。
 *
 * - #671 (v1): global singleton state でサーバ全体の 1 active workspace を管理
 * - #700 (v2 R-2): per-session active state に移行。`WorkspaceContextManager` を導入し、
 *   `Map<clientId, ConnectionContext>` で session ごとの active workspace を管理する。
 *
 * ### lockdown モード
 * 環境変数 DESIGNER_DATA_DIR が指定されている場合、起動時に lockdown が有効化され、
 * 全 session の active は env 値に固定される。
 * `setActivePath()` / `clearActive()` は全 session で LockdownError を throw する。
 * `recent-workspaces.json` も読み書きしない (recentStore 側で別途判定)。
 */
import path from "path";

export class LockdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockdownError";
  }
}

export class WorkspaceUnsetError extends Error {
  constructor() {
    super("ワークスペースが選択されていません");
    this.name = "WorkspaceUnsetError";
  }
}

// ── グローバル lockdown state (#700 設計: lockdown は global、per-session ではない) ──

let _lockdown = false;
let _lockdownPath: string | null = null;
let _initialized = false;

/**
 * 起動時の自動 active 設定 (autoActivateOnStartup) が設定したデフォルトパス。
 * lockdown 時は使わない。MCP session connect 時に initialPath として使用される。
 */
let _globalDefaultPath: string | null = null;

/** autoActivateOnStartup が設定するデフォルトの active path (#700 R-2) */
export function setGlobalDefaultPath(absPath: string | null): void {
  _globalDefaultPath = absPath ? path.resolve(absPath) : null;
}

/** デフォルトの active path を取得 (#700 R-2) */
export function getGlobalDefaultPath(): string | null {
  return _globalDefaultPath;
}

/**
 * env DESIGNER_DATA_DIR を読み、lockdown 状態を確定する。
 * idempotent — 複数回呼んでも初回判定が固定される。
 */
export function initWorkspaceState(): void {
  if (_initialized) return;
  _initialized = true;
  const envPath = process.env.DESIGNER_DATA_DIR;
  if (envPath && envPath.trim().length > 0) {
    _lockdown = true;
    _lockdownPath = path.resolve(envPath);
  }
}

export function isLockdown(): boolean {
  return _lockdown;
}

export function getLockdownPath(): string | null {
  return _lockdownPath;
}

// ── ConnectionContext / WorkspaceContextManager (#700 R-2) ──────────────────

export type ConnectionContext = {
  clientId: string;
  /** active workspace の絶対パス。未選択なら null */
  activePath: string | null;
  /** lockdown フラグ (global flag のコピー) */
  lockdown: boolean;
};

/**
 * per-session active workspace state を管理するクラス (#700 R-2 D-3)。
 *
 * WS 接続 / MCP session それぞれを clientId として登録し、connection 毎の
 * active workspace を独立して持つ。lockdown 時は全 context が env パスに固定される。
 */
export class WorkspaceContextManager {
  private _contexts = new Map<string, ConnectionContext>();

  /**
   * clientId を登録して context を作成する (WS 接続時 / MCP session 開始時)。
   * lockdown 時は activePath が lockdownPath で固定。
   * 既に登録済みの clientId は上書きしない (reconnect 時に既存 active を維持)。
   */
  connect(clientId: string, initialPath?: string | null): ConnectionContext {
    if (this._contexts.has(clientId)) {
      return this._contexts.get(clientId)!;
    }
    // lockdown 時は lockdownPath 固定。非 lockdown 時は initialPath → _globalDefaultPath → null の順
    const activePath = _lockdown
      ? (_lockdownPath ?? null)
      : (initialPath !== undefined ? initialPath : _globalDefaultPath);
    const ctx: ConnectionContext = {
      clientId,
      activePath,
      lockdown: _lockdown,
    };
    this._contexts.set(clientId, ctx);
    return ctx;
  }

  /**
   * clientId の context を削除する (WS 切断時 / MCP session 終了時)。
   * 存在しない clientId は無視する。
   */
  disconnect(clientId: string): void {
    this._contexts.delete(clientId);
  }

  /**
   * clientId の active workspace パスを取得する。
   * - lockdown 時: lockdownPath を返す
   * - 未登録の clientId: null を返す (context を自動生成しない)
   */
  getActivePath(clientId: string): string | null {
    const ctx = this._contexts.get(clientId);
    if (!ctx) return null;
    return ctx.activePath;
  }

  /**
   * read/write が前提となるリソース系関数で使う。
   * 未選択時は WorkspaceUnsetError を throw。
   * 未登録 clientId も WorkspaceUnsetError を throw する (接続なしで write は禁止)。
   */
  requireActivePath(clientId: string): string {
    const ctx = this._contexts.get(clientId);
    if (!ctx || !ctx.activePath) throw new WorkspaceUnsetError();
    return ctx.activePath;
  }

  /**
   * clientId の active workspace を設定する。
   * lockdown 時は LockdownError を throw。
   * 未登録の clientId の場合は自動的に context を作成する。
   */
  setActivePath(clientId: string, absPath: string): void {
    if (_lockdown) {
      throw new LockdownError(
        "DESIGNER_DATA_DIR で固定モード中のため、ワークスペースを切り替えできません",
      );
    }
    let ctx = this._contexts.get(clientId);
    if (!ctx) {
      ctx = { clientId, activePath: null, lockdown: false };
      this._contexts.set(clientId, ctx);
    }
    ctx.activePath = path.resolve(absPath);
  }

  /**
   * clientId の active workspace を null にする。
   * lockdown 時は LockdownError を throw。
   */
  clearActive(clientId: string): void {
    if (_lockdown) {
      throw new LockdownError(
        "DESIGNER_DATA_DIR で固定モード中のため、ワークスペースを閉じる操作はできません",
      );
    }
    const ctx = this._contexts.get(clientId);
    if (ctx) {
      ctx.activePath = null;
    }
  }

  /** 登録済み clientId の一覧を返す */
  listClientIds(): string[] {
    return Array.from(this._contexts.keys());
  }

  /** 指定パスを active として持つ clientId の一覧を返す */
  getClientIdsByPath(absPath: string): string[] {
    const resolved = path.resolve(absPath);
    const result: string[] = [];
    for (const [id, ctx] of this._contexts) {
      if (ctx.activePath === resolved) result.push(id);
    }
    return result;
  }

  /** 全 context を取得する (broadcast wsId scoping 用) */
  getAllContexts(): ConnectionContext[] {
    return Array.from(this._contexts.values());
  }

  /** test-only: 全 context クリア */
  _resetForTest(): void {
    this._contexts.clear();
  }
}

/** モジュールレベルのシングルトン WorkspaceContextManager */
export const workspaceContextManager = new WorkspaceContextManager();

// ── per-session public API (clientId 必須) ─────────────────────────────────
//
// #700 R-2: LEGACY_CLIENT_ID / 後方互換 wrapper を完全削除。
// clientId なし呼び出しはコンパイルエラーになるため、全 call site で clientId を pass-through する。
//
// MCP tool (index.ts) の stateless HTTP transport は httpTransport.ts が MCP session の
// sessionId を connect/disconnect するため、MCP tool handler は sessionId を clientId として使う。

/** clientId の active workspace パスを取得 */
export function getActivePath(clientId: string): string | null {
  return workspaceContextManager.getActivePath(clientId);
}

/** read/write が前提となる箇所で使う。未選択時は WorkspaceUnsetError を throw */
export function requireActivePath(clientId: string): string {
  return workspaceContextManager.requireActivePath(clientId);
}

/** clientId の active workspace を設定 */
export function setActivePath(clientId: string, absPath: string): void {
  workspaceContextManager.setActivePath(clientId, absPath);
}

/** clientId の active workspace を null にする */
export function clearActive(clientId: string): void {
  workspaceContextManager.clearActive(clientId);
}

/** clientId を登録して context を作成 (WS 接続時 / MCP session 開始時) */
export function connect(clientId: string, initialPath?: string | null): void {
  workspaceContextManager.connect(clientId, initialPath);
}

/** clientId の context を削除 (WS 切断時 / MCP session 終了時) */
export function disconnect(clientId: string): void {
  workspaceContextManager.disconnect(clientId);
}

/** test-only: 状態リセット */
export function _resetForTest(): void {
  _lockdown = false;
  _lockdownPath = null;
  _initialized = false;
  _globalDefaultPath = null;
  workspaceContextManager._resetForTest();
}
