/**
 * workspaceStore 単体テスト (#677-A)
 * loadWorkspaces() の直列化: 並行呼び出しでも順次実行される
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mcpBridge をモックする
vi.mock("../mcp/mcpBridge", () => {
  let callCount = 0;
  const mockRequest = vi.fn(async () => {
    callCount++;
    const n = callCount;
    return {
      workspaces: [{ id: `ws-${n}`, path: `/tmp/ws${n}`, name: `WS${n}`, lastOpenedAt: null }],
      lastActiveId: null,
      active: null,
      lockdown: false,
      lockdownPath: null,
    };
  });
  return {
    mcpBridge: {
      request: mockRequest,
      onBroadcast: vi.fn(() => () => {}),
      onStatusChange: vi.fn(() => () => {}),
      startWithoutEditor: vi.fn(),
    },
  };
});

// モック後に import する (vi.mock は hoisted)
const { mcpBridge } = await import("../mcp/mcpBridge");

// ストアモジュールは vi.mock が確定した後にインポートする必要があるため動的 import
const storeModule = await import("./workspaceStore");
const { loadWorkspaces, getState, __resetLoadChainForTest } = storeModule;

beforeEach(() => {
  vi.clearAllMocks();
  // Nit: テスト間で _loadChain が持続しないようリセット
  __resetLoadChainForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadWorkspaces 直列化 (A)", () => {
  it("2 つ目の loadWorkspaces は 1 つ目の resolve 後に開始される (直列性の証明)", async () => {
    // Promise を手動制御するための resolver 配列と呼び出し順序ログ
    const callOrder: string[] = [];
    const resolvers: Array<() => void> = [];

    (mcpBridge.request as ReturnType<typeof vi.fn>).mockImplementation(() => {
      return new Promise<{
        workspaces: Array<{ id: string; path: string; name: string; lastOpenedAt: null }>;
        lastActiveId: null;
        active: null;
        lockdown: false;
        lockdownPath: null;
      }>((resolve) => {
        callOrder.push("called");
        resolvers.push(() => {
          callOrder.push("resolved");
          resolve({
            workspaces: [{ id: "ws-x", path: "/tmp/wsx", name: "WSX", lastOpenedAt: null }],
            lastActiveId: null,
            active: null,
            lockdown: false,
            lockdownPath: null,
          });
        });
      });
    });

    const p1 = loadWorkspaces();
    const p2 = loadWorkspaces();

    // microtask を数回フラッシュして Promise チェーンを進める
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // この時点で 1 つ目だけ呼び出し済み、2 つ目はまだ待機中
    expect(callOrder).toEqual(["called"]);
    expect(resolvers.length).toBe(1);

    // 1 つ目を resolve する
    resolvers[0]();
    await p1;

    // 2 つ目が呼び出されるまでの microtask を処理
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 1 つ目が resolved になり、2 つ目が called になる
    expect(callOrder).toEqual(["called", "resolved", "called"]);
    expect(resolvers.length).toBe(2);

    // 2 つ目も resolve して完了させる
    resolvers[1]();
    await p2;

    expect(callOrder).toEqual(["called", "resolved", "called", "resolved"]);
  });

  it("1 つ目が reject しても 2 つ目が正常に実行される", async () => {
    const mockReq = mcpBridge.request as ReturnType<typeof vi.fn>;
    // 1 回目は失敗、2 回目は成功
    mockReq
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        workspaces: [{ id: "ws-ok", path: "/tmp/ok", name: "OK", lastOpenedAt: null }],
        lastActiveId: null,
        active: null,
        lockdown: false,
        lockdownPath: null,
      });

    const p1 = loadWorkspaces();
    const p2 = loadWorkspaces();

    // p1 は失敗してもチェーンは切れない
    await Promise.allSettled([p1, p2]);

    // 2 つとも実行された
    expect(mockReq.mock.calls.length).toBe(2);
    // 2 つ目が成功した結果が state に反映されている
    const st = getState();
    expect(st.error).toBeNull();
    expect(st.workspaces.length).toBe(1);
    expect(st.workspaces[0].id).toBe("ws-ok");
  });
});
