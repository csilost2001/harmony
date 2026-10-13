/**
 * 接続トークン・要求の上限の結線テスト: 部品 (checkAuthToken / RateLimiter など) の単体テストでは分からない、
 * 実際のサーバ (WsBridge) で、HTTP の 401 / 413、WebSocket の close 1008 / 1009、要求の頻度の応答が出ることを確かめる。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const PORT = vi.hoisted(() => {
  const port = 5600 + Math.floor(Math.random() * 300);
  process.env.DESIGNER_MCP_PORT = String(port);
  process.env.HARMONY_AUTH_TOKEN = "t0k3n-for-test";
  process.env.HARMONY_MAX_HTTP_BODY_BYTES = "100";
  process.env.HARMONY_MAX_WS_REQUESTS_PER_10S = "3";
  process.env.HARMONY_MAX_WS_PAYLOAD_BYTES = "1024";
  return port;
});

import WebSocket from "ws";
import { WsBridge } from "../wsBridge.js";
import { _resetAuthThrottleForTest } from "./authToken.js";

let bridge: WsBridge;
const base = () => `http://127.0.0.1:${PORT}`;

beforeAll(async () => {
  bridge = new WsBridge();
  bridge.registerHttpHandler("/mcp", (_req, res) => { res.writeHead(200); res.end("ok"); });
  await bridge.start();
});
afterAll(async () => { await bridge.stop(); });

const post = (headers: Record<string, string>, body = "") =>
  fetch(`${base()}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

function wsOpen(query = ""): Promise<{ ws: WebSocket; closed: Promise<{ code: number; reason: string }> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/${query}`);
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on("close", (code, reason) => r({ code, reason: reason.toString() })));
    ws.on("open", () => resolve({ ws, closed }));
    ws.on("error", reject);
  });
}

describe("HTTP: 接続トークンと本文の上限", () => {
  it("トークンが無い・違うと 401。Bearer が合えば通る。?token= は HTTP では受けない", async () => {
    _resetAuthThrottleForTest();
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await fetch(`${base()}/mcp?token=t0k3n-for-test`, { method: "POST", body: "{}" })).status).toBe(401);
    const ok = await post({ authorization: "Bearer t0k3n-for-test" });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("ok");
  });

  it("違うトークンが続いても、正しいトークンの要求は通る (締め出さない)。失敗の応答だけが遅くなる", async () => {
    _resetAuthThrottleForTest();
    for (let i = 0; i < 7; i++) await post({ authorization: `Bearer wrong-${i}` });
    const t = Date.now();
    expect((await post({ authorization: "Bearer t0k3n-for-test" })).status).toBe(200);
    expect(Date.now() - t).toBeLessThan(1_000);
    const t2 = Date.now();
    expect((await post({ authorization: "Bearer wrong-again" })).status).toBe(401);
    expect(Date.now() - t2).toBeGreaterThanOrEqual(200); // 失敗の応答は、遅らせている
  });

  it("本文が上限 (Content-Length) を超えたら 413。トークンが先", async () => {
    _resetAuthThrottleForTest();
    const big = "x".repeat(500);
    expect((await post({ authorization: "Bearer t0k3n-for-test" }, big)).status).toBe(413);
    expect((await post({}, big)).status).toBe(401);
  });

  it("/health は、トークンなしで見える", async () => {
    expect((await fetch(`${base()}/health`)).status).toBe(200);
  });
});

describe("WebSocket: 接続トークン・メッセージの上限・要求の頻度", () => {
  it("トークンが無い・違う接続は、close 1008 (Unauthorized) で切られる", async () => {
    _resetAuthThrottleForTest();
    const { closed } = await wsOpen();
    expect(await closed).toMatchObject({ code: 1008, reason: "Unauthorized" });
    const { closed: closed2 } = await wsOpen("?token=wrong");
    expect(await closed2).toMatchObject({ code: 1008, reason: "Unauthorized" });
  });

  it("?token= が合う接続は使える。1 接続の頻度の上限を超えた要求は「要求が多すぎます」で断る", async () => {
    _resetAuthThrottleForTest();
    const { ws } = await wsOpen("?token=t0k3n-for-test");
    ws.send(JSON.stringify({ type: "register", clientId: "wiring-test-client" }));
    const replies: Array<{ id: string; error?: string }> = [];
    ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "response") replies.push(m); });
    for (let i = 0; i < 6; i++) ws.send(JSON.stringify({ type: "request", id: `r${i}`, method: "no.such.method" }));
    await vi.waitFor(() => expect(replies.length).toBe(6), { timeout: 5_000 });
    expect(replies.filter((r) => r.error?.includes("要求が多すぎます")).length).toBeGreaterThanOrEqual(3);
    expect(replies.filter((r) => r.error?.includes("未知のリクエストメソッド")).length).toBeGreaterThanOrEqual(1);
    ws.close();
  });

  it("メッセージが上限を超えたら、接続を切る (close 1009)", async () => {
    _resetAuthThrottleForTest();
    const { ws, closed } = await wsOpen("?token=t0k3n-for-test");
    ws.send("x".repeat(5_000));
    expect((await closed).code).toBe(1009);
  });
});
