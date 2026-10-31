/**
 * 画面の版の知らせ (#1572): register を受けたら、このサーバが配る画面の版 (build-id.txt) を `registered` で返す。
 * 版が無い (dev / 静的配信なし) ときは buildId を付けない。/health の詳細 (loopback) にも出る。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const ctx = vi.hoisted(() => {
  const port = 5900 + Math.floor(Math.random() * 90);
  process.env.DESIGNER_MCP_PORT = String(port);
  return { port };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { WsBridge } from "./wsBridge.js";

let bridge: WsBridge;
let staticDir: string;
const origStatic = process.env.HARMONY_STATIC_DIR;

function registerAndWait(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/`);
    ws.on("open", () => ws.send(JSON.stringify({ type: "register", clientId: "c-buildid" })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>;
      if (m.type === "registered") { ws.close(); resolve(m); }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("registered が届かない")), 5000);
  });
}

beforeAll(async () => {
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "harmony-ws-buildid-"));
  fs.writeFileSync(path.join(staticDir, "build-id.txt"), "test-build-1\n");
  process.env.HARMONY_STATIC_DIR = staticDir;
  bridge = new WsBridge();
  await bridge.start();
});
afterAll(async () => {
  await bridge.stop();
  if (origStatic === undefined) delete process.env.HARMONY_STATIC_DIR; else process.env.HARMONY_STATIC_DIR = origStatic;
  fs.rmSync(staticDir, { recursive: true, force: true });
});

describe("register の返事に画面の版を載せる (#1572)", () => {
  it("registered に buildId が付く", async () => {
    expect(await registerAndWait()).toEqual({ type: "registered", buildId: "test-build-1" });
  });

  it("/health の詳細 (loopback) にも buildId が出る", async () => {
    const body = await (await fetch(`http://127.0.0.1:${ctx.port}/health`)).json() as Record<string, unknown>;
    expect(body.buildId).toBe("test-build-1");
  });
});
