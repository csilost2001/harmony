/**
 * workspaceState 単体テスト (#671 + #700 R-2)
 *
 * - per-session public API (clientId 必須) の動作確認
 * - WorkspaceContextManager の per-session 動作確認
 * - lockdown モードの動作確認
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import {
  initWorkspaceState,
  isLockdown,
  getLockdownPath,
  getActivePath,
  setActivePath,
  clearActive,
  requireActivePath,
  connect,
  disconnect,
  LockdownError,
  WorkspaceUnsetError,
  workspaceContextManager,
  WorkspaceContextManager,
  _resetForTest,
} from "./workspaceState.js";

const ORIGINAL_ENV = process.env.DESIGNER_DATA_DIR;

beforeEach(() => {
  _resetForTest();
  delete process.env.DESIGNER_DATA_DIR;
});

afterEach(() => {
  if (ORIGINAL_ENV !== undefined) {
    process.env.DESIGNER_DATA_DIR = ORIGINAL_ENV;
  } else {
    delete process.env.DESIGNER_DATA_DIR;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// per-session public API (通常モード)
// ─────────────────────────────────────────────────────────────────────────────
describe("workspaceState per-session public API (通常モード)", () => {
  it("init 後 active は null、lockdown も false", () => {
    initWorkspaceState();
    connect("client-A");
    expect(getActivePath("client-A")).toBeNull();
    expect(isLockdown()).toBe(false);
    expect(getLockdownPath()).toBeNull();
  });

  it("setActivePath で active が更新される (絶対パスに正規化)", () => {
    initWorkspaceState();
    connect("client-A");
    setActivePath("client-A", "/some/path");
    expect(getActivePath("client-A")).toBe(path.resolve("/some/path"));
  });

  it("clearActive で active が null に戻る", () => {
    initWorkspaceState();
    connect("client-A");
    setActivePath("client-A", "/some/path");
    clearActive("client-A");
    expect(getActivePath("client-A")).toBeNull();
  });

  it("requireActivePath は active 未選択時に WorkspaceUnsetError を throw", () => {
    initWorkspaceState();
    connect("client-A");
    expect(() => requireActivePath("client-A")).toThrow(WorkspaceUnsetError);
  });

  it("requireActivePath は active 選択時にパスを返す", () => {
    initWorkspaceState();
    connect("client-A");
    setActivePath("client-A", "/some/path");
    expect(requireActivePath("client-A")).toBe(path.resolve("/some/path"));
  });

  it("disconnect 後の getActivePath は null を返す", () => {
    initWorkspaceState();
    connect("client-A");
    setActivePath("client-A", "/some/path");
    disconnect("client-A");
    expect(getActivePath("client-A")).toBeNull();
  });
});

describe("workspaceState per-session public API (lockdown モード)", () => {
  it("env DESIGNER_DATA_DIR 指定時は lockdown=true、active が env パス固定", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    connect("client-A");
    expect(isLockdown()).toBe(true);
    expect(getLockdownPath()).toBe(path.resolve("/env/data"));
    expect(getActivePath("client-A")).toBe(path.resolve("/env/data"));
  });

  it("lockdown 中の setActivePath は LockdownError", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    connect("client-A");
    expect(() => setActivePath("client-A", "/other")).toThrow(LockdownError);
  });

  it("lockdown 中の clearActive は LockdownError", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    connect("client-A");
    expect(() => clearActive("client-A")).toThrow(LockdownError);
  });

  it("lockdown 中も requireActivePath は env パスを返す", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    connect("client-A");
    expect(requireActivePath("client-A")).toBe(path.resolve("/env/data"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// v2 WorkspaceContextManager per-session API (#700 R-2)
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkspaceContextManager per-session (通常モード)", () => {
  it("connect で context が作成され、未選択は null", () => {
    initWorkspaceState();
    const ctx = workspaceContextManager.connect("client-A");
    expect(ctx.clientId).toBe("client-A");
    expect(ctx.activePath).toBeNull();
    expect(ctx.lockdown).toBe(false);
  });

  it("2 clientId が独立した activePath を持てる", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.connect("client-B");

    workspaceContextManager.setActivePath("client-A", "/workspace/A");
    workspaceContextManager.setActivePath("client-B", "/workspace/B");

    expect(workspaceContextManager.getActivePath("client-A")).toBe(path.resolve("/workspace/A"));
    expect(workspaceContextManager.getActivePath("client-B")).toBe(path.resolve("/workspace/B"));
  });

  it("client-A の setActivePath が client-B に影響しない", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.connect("client-B");

    workspaceContextManager.setActivePath("client-A", "/workspace/A");
    // client-B は変更なし
    expect(workspaceContextManager.getActivePath("client-B")).toBeNull();
  });

  it("clearActive で client-A だけ null になり client-B は影響なし", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.connect("client-B");

    workspaceContextManager.setActivePath("client-A", "/workspace/A");
    workspaceContextManager.setActivePath("client-B", "/workspace/B");
    workspaceContextManager.clearActive("client-A");

    expect(workspaceContextManager.getActivePath("client-A")).toBeNull();
    expect(workspaceContextManager.getActivePath("client-B")).toBe(path.resolve("/workspace/B"));
  });

  it("requireActivePath は未選択 context で WorkspaceUnsetError", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    expect(() => workspaceContextManager.requireActivePath("client-A")).toThrow(WorkspaceUnsetError);
  });

  it("requireActivePath は未登録 clientId でも WorkspaceUnsetError", () => {
    initWorkspaceState();
    expect(() => workspaceContextManager.requireActivePath("unknown-client")).toThrow(WorkspaceUnsetError);
  });

  it("disconnect 後の getActivePath は null を返す", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.setActivePath("client-A", "/workspace/A");
    workspaceContextManager.disconnect("client-A");
    expect(workspaceContextManager.getActivePath("client-A")).toBeNull();
  });

  it("disconnect 後の requireActivePath は WorkspaceUnsetError", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.setActivePath("client-A", "/workspace/A");
    workspaceContextManager.disconnect("client-A");
    expect(() => workspaceContextManager.requireActivePath("client-A")).toThrow(WorkspaceUnsetError);
  });

  it("connect は reconnect 時に既存 activePath を維持する", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.setActivePath("client-A", "/workspace/A");
    // 同じ clientId で再 connect
    const ctx = workspaceContextManager.connect("client-A");
    // 既存の context が返り、activePath は維持されている
    expect(ctx.activePath).toBe(path.resolve("/workspace/A"));
    expect(workspaceContextManager.getActivePath("client-A")).toBe(path.resolve("/workspace/A"));
  });

  it("getClientIdsByPath は指定パスを持つ clientId を返す", () => {
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.connect("client-B");
    workspaceContextManager.connect("client-C");

    workspaceContextManager.setActivePath("client-A", "/workspace/shared");
    workspaceContextManager.setActivePath("client-B", "/workspace/shared");
    workspaceContextManager.setActivePath("client-C", "/workspace/other");

    const ids = workspaceContextManager.getClientIdsByPath("/workspace/shared");
    expect(ids).toContain("client-A");
    expect(ids).toContain("client-B");
    expect(ids).not.toContain("client-C");
  });
});

describe("WorkspaceContextManager per-session (lockdown モード)", () => {
  it("lockdown 時は connect で activePath が env パスに固定される", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    const ctx = workspaceContextManager.connect("client-A");
    expect(ctx.activePath).toBe(path.resolve("/env/data"));
    expect(ctx.lockdown).toBe(true);
  });

  it("lockdown 時は全 context の activePath が env パスに固定される", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    workspaceContextManager.connect("client-B");

    expect(workspaceContextManager.getActivePath("client-A")).toBe(path.resolve("/env/data"));
    expect(workspaceContextManager.getActivePath("client-B")).toBe(path.resolve("/env/data"));
  });

  it("lockdown 時の setActivePath は全 session で LockdownError", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    expect(() => workspaceContextManager.setActivePath("client-A", "/other")).toThrow(LockdownError);
  });

  it("lockdown 時の clearActive は全 session で LockdownError", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    expect(() => workspaceContextManager.clearActive("client-A")).toThrow(LockdownError);
  });

  it("lockdown 時の requireActivePath は env パスを返す", () => {
    process.env.DESIGNER_DATA_DIR = "/env/data";
    initWorkspaceState();
    workspaceContextManager.connect("client-A");
    expect(workspaceContextManager.requireActivePath("client-A")).toBe(path.resolve("/env/data"));
  });
});

describe("WorkspaceContextManager スタンドアロンインスタンス", () => {
  it("別インスタンスは独立した state を持つ", () => {
    initWorkspaceState();
    const mgr = new WorkspaceContextManager();
    mgr.connect("client-X");
    mgr.setActivePath("client-X", "/workspace/X");

    // グローバル singleton には影響しない
    expect(workspaceContextManager.getActivePath("client-X")).toBeNull();
    expect(mgr.getActivePath("client-X")).toBe(path.resolve("/workspace/X"));
  });
});
