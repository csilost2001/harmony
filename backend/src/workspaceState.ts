/**
 * workspaceState.ts (#671 + #700)
 *
 * 現在 active なワークスペース (= harmony.json を含むフォルダ) の絶対パスを保持する。
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
import fs from "node:fs";

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

let _lockdown = false;
let _lockdownPath: string | null = null;
let _initialized = false;
let _globalDefaultPath: string | null = null;

export const LOCKDOWN_WORKSPACE_ID = "lockdown";

export function setGlobalDefaultPath(absPath: string | null): void {
  _globalDefaultPath = absPath ? path.resolve(absPath) : null;
}

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
    const resolved = path.resolve(envPath.trim());
    // S-011: DESIGNER_DATA_DIR の存在検証 — harmony.json が無い場合は起動を失敗させる (CWE-22)
    // テスト環境 (VITEST / NODE_ENV=test) は検証をスキップ (テスト用パスが実在しないため)
    const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
    if (!isTestEnv) {
      const harmonyJson = path.join(resolved, "harmony.json");
      if (!fs.existsSync(harmonyJson)) {
        console.error(
          `[workspaceState] DESIGNER_DATA_DIR "${resolved}" に harmony.json が存在しません。` +
          `有効なワークスペースパスを指定してください。`,
        );
        process.exit(1);
      }
    }
    _lockdown = true;
    _lockdownPath = resolved;
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
  activePath: string | null;
  lockdown: boolean;
};

export class WorkspaceContextManager {
  private _contexts = new Map<string, ConnectionContext>();

  connect(clientId: string, initialPath?: string | null): ConnectionContext {
    if (this._contexts.has(clientId)) {
      return this._contexts.get(clientId)!;
    }
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

  disconnect(clientId: string): void {
    this._contexts.delete(clientId);
  }

  getActivePath(clientId: string): string | null {
    const ctx = this._contexts.get(clientId);
    if (!ctx) return null;
    return ctx.activePath;
  }

  requireActivePath(clientId: string): string {
    const ctx = this._contexts.get(clientId);
    if (!ctx || !ctx.activePath) throw new WorkspaceUnsetError();
    return ctx.activePath;
  }

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

  listClientIds(): string[] {
    return Array.from(this._contexts.keys());
  }

  getClientIdsByPath(absPath: string): string[] {
    const resolved = path.resolve(absPath);
    const result: string[] = [];
    for (const [id, ctx] of this._contexts) {
      if (ctx.activePath === resolved) result.push(id);
    }
    return result;
  }

  getAllContexts(): ConnectionContext[] {
    return Array.from(this._contexts.values());
  }

  _resetForTest(): void {
    this._contexts.clear();
  }
}

export const workspaceContextManager = new WorkspaceContextManager();

export function getActivePath(clientId: string): string | null {
  return workspaceContextManager.getActivePath(clientId);
}

export function requireActivePath(clientId: string): string {
  return workspaceContextManager.requireActivePath(clientId);
}

export function setActivePath(clientId: string, absPath: string): void {
  workspaceContextManager.setActivePath(clientId, absPath);
}

export function clearActive(clientId: string): void {
  workspaceContextManager.clearActive(clientId);
}

export function connect(clientId: string, initialPath?: string | null): void {
  workspaceContextManager.connect(clientId, initialPath);
}

export function disconnect(clientId: string): void {
  workspaceContextManager.disconnect(clientId);
}

export function _resetForTest(): void {
  _lockdown = false;
  _lockdownPath = null;
  _initialized = false;
  _globalDefaultPath = null;
  workspaceContextManager._resetForTest();
}
