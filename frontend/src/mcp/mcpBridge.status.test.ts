/**
 * mcpBridge status 状態遷移ユニットテスト (#795-C)
 *
 * McpStatus 型の状態遷移ロジック (connecting / connected / failed) と
 * markFailed() / startWithoutEditor() の振る舞いを検証する。
 *
 * mcpBridge.ts は html2canvas / GrapesJS 等の重い依存を持つため、
 * それらをモックした上でモジュールを動的インポートしてテストする。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── 重い依存をモック ────────────────────────────────────────────────────────

vi.mock("html2canvas", () => ({ default: vi.fn() }));
vi.mock("grapesjs", () => ({ default: {} }));
vi.mock("../utils/uuid", () => ({ generateUUID: () => "test-uuid-" + Math.random().toString(36).slice(2) }));

// store 系も最小モック (mcpBridge.ts の import 側がエラーにならないように)
vi.mock("../store/flowStore", () => ({ loadProject: vi.fn(), addScreen: vi.fn(), updateScreen: vi.fn(), updateScreenThumbnail: vi.fn(), removeScreen: vi.fn(), addEdge: vi.fn(), removeEdge: vi.fn(), generateMermaid: vi.fn(), setFlowStorageBackend: vi.fn() }));
vi.mock("../store/customBlockStore", () => ({ loadCustomBlocks: vi.fn(), upsertCustomBlock: vi.fn(), deleteCustomBlock: vi.fn(), injectCustomBlockCss: vi.fn(), setCustomBlocksBackend: vi.fn() }));
vi.mock("../store/puckComponentsStore", () => ({ setPuckComponentsBackend: vi.fn() }));
vi.mock("../store/tableStore", () => ({ setTableStorageBackend: vi.fn(), loadTable: vi.fn() }));
vi.mock("../store/erLayoutStore", () => ({ setErLayoutStorageBackend: vi.fn() }));
vi.mock("../store/screenFlowPositionsStore", () => ({ setScreenFlowPositionsStorageBackend: vi.fn() }));
vi.mock("../store/processFlowStore", () => ({ setProcessFlowStorageBackend: vi.fn() }));
vi.mock("../store/conventionsStore", () => ({ setConventionsStorageBackend: vi.fn() }));
vi.mock("../store/screenItemsStore", () => ({ loadScreenItems: vi.fn(), setItemsInCache: vi.fn() }));
vi.mock("../store/screenStore", () => ({ setScreenStorageBackend: vi.fn() }));
vi.mock("../store/sequenceStore", () => ({ setSequenceStorageBackend: vi.fn() }));
vi.mock("../store/viewStore", () => ({ setViewStorageBackend: vi.fn() }));
vi.mock("../store/viewDefinitionStore", () => ({ setViewDefinitionStorageBackend: vi.fn() }));
vi.mock("../store/tabStore", () => ({ openTab: vi.fn(), closeTab: vi.fn(), setActiveTab: vi.fn(), getTabs: vi.fn(() => []), getActiveTabId: vi.fn(() => null), makeTabId: vi.fn((type: string, id: string) => `${type}:${id}`), setDirty: vi.fn() }));

// ── FakeWebSocket ──────────────────────────────────────────────────────────

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = FakeWebSocket.CONNECTING;

  constructor(_url: string) {
    super();
  }

  send(_data: string): void {}

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

// ── グローバル WebSocket スタブ ────────────────────────────────────────────

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  // @ts-expect-error test stub
  globalThis.WebSocket = FakeWebSocket;

  if (!("location" in globalThis)) {
    Object.defineProperty(globalThis, "location", {
      value: { hostname: "localhost" },
      writable: true,
      configurable: true,
    });
  }
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.resetModules();
});

// ── ヘルパー: フレッシュな mcpBridge インスタンスを取得 ─────────────────────

async function getFreshBridge() {
  const { mcpBridge } = await import("./mcpBridge.ts");
  return mcpBridge;
}

// ── テスト ─────────────────────────────────────────────────────────────────

describe("McpStatus 状態遷移ロジック (#795-C)", () => {
  it("McpStatus 型は connecting / connected / failed / disconnected の 4 状態を持つ", async () => {
    // 型レベルの確認: import して型が存在することを検証
    const mod = await import("./mcpBridge.ts");
    expect(typeof mod.mcpBridge.getStatus).toBe("function");
    // 初期状態は disconnected
    expect(mod.mcpBridge.getStatus()).toBe("disconnected");
  });

  it("startWithoutEditor() を呼ぶと connecting になる", async () => {
    const bridge = await getFreshBridge();
    const statuses: string[] = [];
    bridge.onStatusChange((s) => statuses.push(s));

    bridge.startWithoutEditor();

    expect(bridge.getStatus()).toBe("connecting");
    expect(statuses).toContain("connecting");
  });

  it("markFailed() を呼ぶと failed になる", async () => {
    const bridge = await getFreshBridge();
    const received: string[] = [];
    bridge.onStatusChange((s) => received.push(s));

    bridge.startWithoutEditor(); // connecting
    bridge.markFailed();

    expect(bridge.getStatus()).toBe("failed");
    expect(received).toContain("failed");
  });

  it("failed 状態から startWithoutEditor() を再呼び出しすると connecting になる (リトライ)", async () => {
    const bridge = await getFreshBridge();

    bridge.startWithoutEditor(); // connecting
    bridge.markFailed();         // failed
    expect(bridge.getStatus()).toBe("failed");

    bridge.startWithoutEditor(); // retry → connecting
    expect(bridge.getStatus()).toBe("connecting");
  });

  it("connectAttempts がインクリメントされる", async () => {
    const bridge = await getFreshBridge();
    expect(bridge.getConnectAttempts()).toBe(0);

    bridge.startWithoutEditor();
    expect(bridge.getConnectAttempts()).toBe(1);

    bridge.markFailed();
    bridge.startWithoutEditor();
    expect(bridge.getConnectAttempts()).toBe(2);
  });

  it("connecting 中に startWithoutEditor() を再呼び出しすると no-op (重複接続防止)", async () => {
    const bridge = await getFreshBridge();
    bridge.startWithoutEditor();
    const countAfterFirst = bridge.getConnectAttempts();

    bridge.startWithoutEditor(); // no-op
    expect(bridge.getConnectAttempts()).toBe(countAfterFirst);
    expect(bridge.getStatus()).toBe("connecting");
  });
});
