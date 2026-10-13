/**
 * mcpBridge と sharedInflight の結線テスト (レビュー S-1):
 * 読み出し以外の RPC の成功後と、サーバーの変更通知 (broadcast) の受信時に、進行中の読み出しが無効になる。
 * どちらかの呼び出しを消すと、このテストが落ちる。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { RPC_METHODS } from "@harmony/shared";

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

afterEach(() => { delete (window as unknown as { __mcpBridge?: unknown }).__mcpBridge; vi.resetModules(); });

interface Internals {
  ws: { readyState: number; send: (data: string) => void; close: () => void };
  _handleMessage(data: string): void;
}

async function setup() {
  const { mcpBridge } = await import("./mcpBridge.ts");
  const { shareInflight, isReadOnlyRpc } = await import("../utils/sharedInflight.ts");
  const sent: Array<{ id: string; method: string }> = [];
  const internals = mcpBridge as unknown as Internals;
  internals.ws = { readyState: WebSocket.OPEN, send: (d) => sent.push(JSON.parse(d)), close: () => {} };
  // 進行中の読み出し 1 件 (まだ終わらない)
  let n = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const get = shareInflight(async () => { const mine = ++n; if (mine === 1) await gate; return mine; });
  const first = get();
  return { mcpBridge, internals, sent, get, first, release, isReadOnlyRpc };
}

// WebSocket.OPEN は jsdom に有るが、念のため値を固定する
vi.stubGlobal("WebSocket", Object.assign(function () {}, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));

describe("mcpBridge → sharedInflight の無効化", () => {
  it("読み出し以外の RPC が成功したら、進行中の読み出しに相乗りしなくなる", async () => {
    const { mcpBridge, internals, sent, get, first, release } = await setup();
    const p = mcpBridge.request("saveProject", {});
    internals._handleMessage(JSON.stringify({ type: "response", id: sent[0].id, result: { ok: true } }));
    await p;
    const second = get();
    release();
    expect(await second).toBe(2);
    expect(await first).toBe(1);
  });

  it("読み出しだけの RPC では、進行中の読み出しを無効にしない", async () => {
    const { mcpBridge, internals, sent, get, first, release } = await setup();
    const p = mcpBridge.request("loadProject", {});
    internals._handleMessage(JSON.stringify({ type: "response", id: sent[0].id, result: {} }));
    await p;
    const second = get();
    release();
    expect(await second).toBe(1); // 相乗りする
    expect(await first).toBe(1);
  });

  it("書き込みが失敗したときは、無効にしない (何も変わっていない)", async () => {
    const { mcpBridge, internals, sent, get, first, release } = await setup();
    const p = mcpBridge.request("saveProject", {});
    internals._handleMessage(JSON.stringify({ type: "response", id: sent[0].id, error: "失敗" }));
    await expect(p).rejects.toThrow("失敗");
    const second = get();
    release();
    expect(await second).toBe(1);
    expect(await first).toBe(1);
  });

  it("サーバーの変更通知 (broadcast) を受けたら、進行中の読み出しに相乗りしなくなる", async () => {
    const { internals, get, first, release } = await setup();
    internals._handleMessage(JSON.stringify({ type: "broadcast", event: "projectChanged", data: {} }));
    const second = get();
    release();
    expect(await second).toBe(2);
    expect(await first).toBe(1);
  });
});

describe("isReadOnlyRpc の分類 (RPC の台帳に対して)", () => {
  it("書き込みを表す名前の RPC は、すべて「読み出し以外」になる", async () => {
    const { isReadOnlyRpc } = await import("../utils/sharedInflight.ts");
    const writes = RPC_METHODS.filter((m) => /(^|\.)(save|delete|rename|undo|create|update|restore|set|write|add|remove|import|apply|discard|transfer|attach|detach|migrate)/i.test(m));
    expect(writes.length).toBeGreaterThan(20);
    expect(writes.filter((m) => isReadOnlyRpc(m))).toEqual([]);
  });
});
