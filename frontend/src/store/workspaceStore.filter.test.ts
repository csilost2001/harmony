/**
 * workspaceStore subscribeWorkspaceChanges per-session フィルタ テスト (#703 R-5 F-2)
 *
 * broadcast 受信時に「自 session の active と関係ない workspace.changed は ignore する」
 * defense-in-depth ロジックを検証する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ブロードキャストハンドラを手動で呼び出せるよう mcpBridge をモック
let capturedBroadcastHandler: ((data: unknown) => void) | null = null;

vi.mock("../mcp/mcpBridge", () => {
  return {
    mcpBridge: {
      request: vi.fn(),
      onBroadcast: vi.fn((event: string, handler: (data: unknown) => void) => {
        if (event === "workspace.changed") {
          capturedBroadcastHandler = handler;
        }
        return () => {};
      }),
      onStatusChange: vi.fn(() => () => {}),
      startWithoutEditor: vi.fn(),
    },
  };
});

// workspaceStore を動的 import (vi.mock hoisting 後)
const storeModule = await import("./workspaceStore");
const {
  subscribeWorkspaceChanges,
  getState,
  __resetLoadChainForTest,
  __resetStateForTest,
} = storeModule;

// 内部 state を直接操作するための _setState は export されていないため、
// loadWorkspaces モック経由で active を設定する
const { mcpBridge } = await import("../mcp/mcpBridge");

function emitBroadcast(data: {
  activeId: string | null;
  path: string | null;
  name: string | null;
  lockdown: boolean;
}) {
  if (capturedBroadcastHandler) {
    capturedBroadcastHandler(data);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedBroadcastHandler = null;
  __resetLoadChainForTest();
  __resetStateForTest();
});

describe("workspaceStore subscribeWorkspaceChanges per-session フィルタ (#703 R-5 B)", () => {
  it("active が null の時は broadcast を受信して active を設定する", async () => {
    // loadWorkspaces で active=null の状態にする
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workspaces: [],
      lastActiveId: null,
      active: null,
      lockdown: false,
      lockdownPath: null,
    });
    await storeModule.loadWorkspaces();
    expect(getState().active).toBeNull();

    // subscribeWorkspaceChanges を呼んでハンドラを登録
    subscribeWorkspaceChanges();
    expect(capturedBroadcastHandler).not.toBeNull();

    // broadcast 受信: active=null → active を設定するべき
    emitBroadcast({ activeId: "ws-001", path: "/workspace/A", name: "WS-A", lockdown: false });

    // active が設定されている
    const state = getState();
    expect(state.active).not.toBeNull();
    expect(state.active?.id).toBe("ws-001");
    expect(state.active?.path).toBe("/workspace/A");
  });

  it("自 session の active と同じ workspace の broadcast は受信して state を更新する", async () => {
    // loadWorkspaces で active = {id: ws-001, path: /workspace/A} にする
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workspaces: [{ id: "ws-001", path: "/workspace/A", name: "WS-A", lastOpenedAt: null }],
      lastActiveId: "ws-001",
      active: { path: "/workspace/A", name: "WS-A" },
      lockdown: false,
      lockdownPath: null,
    });
    await storeModule.loadWorkspaces();
    expect(getState().active?.path).toBe("/workspace/A");

    subscribeWorkspaceChanges();

    // 同じ workspace の broadcast (name が変更されたケース)
    emitBroadcast({ activeId: "ws-001", path: "/workspace/A", name: "WS-A-updated", lockdown: false });

    expect(getState().active?.name).toBe("WS-A-updated");
  });

  it("別 workspace の broadcast は ignore する (per-session フィルタ)", async () => {
    // active = ws-A に設定
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workspaces: [{ id: "ws-A", path: "/workspace/A", name: "WS-A", lastOpenedAt: null }],
      lastActiveId: "ws-A",
      active: { path: "/workspace/A", name: "WS-A" },
      lockdown: false,
      lockdownPath: null,
    });
    await storeModule.loadWorkspaces();
    expect(getState().active?.path).toBe("/workspace/A");

    subscribeWorkspaceChanges();

    // 別 workspace (ws-B) からの broadcast
    emitBroadcast({ activeId: "ws-B", path: "/workspace/B", name: "WS-B", lockdown: false });

    // active は変化しない (フィルタで ignore)
    expect(getState().active?.id).toBe("ws-A");
    expect(getState().active?.path).toBe("/workspace/A");
  });

  it("close broadcast (activeId=null) は active が null になる", async () => {
    // active = ws-A に設定
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workspaces: [{ id: "ws-A", path: "/workspace/A", name: "WS-A", lastOpenedAt: null }],
      lastActiveId: "ws-A",
      active: { path: "/workspace/A", name: "WS-A" },
      lockdown: false,
      lockdownPath: null,
    });
    await storeModule.loadWorkspaces();

    subscribeWorkspaceChanges();

    // workspace.close の broadcast (activeId=null, path=null)
    emitBroadcast({ activeId: null, path: null, name: null, lockdown: false });

    // active が null になる
    expect(getState().active).toBeNull();
  });
});
