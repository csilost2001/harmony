import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * サーバが register の返事 (registered) で知らせる画面の版を、mcpBridge が buildVersion に渡す配線の確認 (#1572)。
 * 配線が外れても buildVersion / AppShell の試験 (handleServerBuildId を直接呼ぶ) は通るため、ここで受信から見る。
 */
class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  constructor(_url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(_data: string): void {}
  close(): void { this.readyState = FakeWebSocket.CLOSED; }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error test stub
  globalThis.WebSocket = FakeWebSocket;
  vi.resetModules();
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.unstubAllGlobals();
});

async function connectedBridge() {
  const { mcpBridge } = await import("./mcpBridge");
  const buildVersion = await import("../utils/buildVersion");
  mcpBridge.startWithoutEditor();
  const ws = FakeWebSocket.instances[0];
  ws.readyState = FakeWebSocket.OPEN;
  ws.dispatchEvent(new Event("open"));
  const receive = (msg: unknown) => ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
  return { receive, buildVersion };
}

describe("mcpBridge が registered の buildId を画面の版と比べる (#1572)", () => {
  it("画面と違う buildId の registered を受けると古い画面になる", async () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "client-1");
    const { receive, buildVersion } = await connectedBridge();
    receive({ type: "registered", buildId: "server-2" });
    expect(buildVersion.isStaleBuild()).toBe(true);
  });

  it("同じ buildId なら古くならず、buildId なしの registered でも古くならない", async () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "client-1");
    const { receive, buildVersion } = await connectedBridge();
    receive({ type: "registered", buildId: "client-1" });
    expect(buildVersion.isStaleBuild()).toBe(false);
    receive({ type: "registered" });
    expect(buildVersion.isStaleBuild()).toBe(false);
  });
});
