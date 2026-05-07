/**
 * HTTP transport 統合テスト (#302)
 *
 * backend を子プロセスとして起動し、以下を検証:
 * - /health が JSON で応答
 * - /mcp initialize で session ID + protocolVersion 取得
 * - /mcp tools/list で登録済ツール一覧取得 (29 件)
 * - WebSocket も同一 port で待機している (ws:// で接続できる)
 *
 * テストは 5200 番台の port を使用 (本番 5179 と衝突しないため)。
 *
 * #758: draft__* / lock__* ツールは active workspace を要求するため、
 * spawn 時に DESIGNER_DATA_DIR=<tmpDir> を渡して lockdown モード固定で起動する。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TEST_PORT = 5201;
const MCP_URL = `http://localhost:${TEST_PORT}/mcp`;
const HEALTH_URL = `http://localhost:${TEST_PORT}/`;
const WS_URL = `ws://localhost:${TEST_PORT}/`;

let server: ChildProcess | null = null;
let tempFixtureDir: string | null = null;

/**
 * テスト用 fixture workspace を os.tmpdir() 配下に作成する (#758)。
 * schemas/v3/harmony.v3.schema.json 準拠の最小 harmony.json を生成する (#854 R-5: project.json → harmony.json)。
 */
async function createFixtureWorkspace(): Promise<string> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "backend-httpTransport-test-"),
  );

  // workspaceInit.ts:initializeWorkspace と同形式のサブディレクトリ群を作成 (harmony/ dataDir 配下)
  const DATA_DIR = "harmony";
  const subdirs = ["screens", "tables", "actions", "conventions", "sequences", "views", "view-definitions", "extensions"];
  await Promise.all(subdirs.map((d) => fs.mkdir(path.join(tmpDir, DATA_DIR, d), { recursive: true })));

  // 最小 harmony.json (schemas/v3/harmony.v3.schema.json 準拠、#851 R-2 形式)
  const ts = new Date().toISOString();
  const projectId = randomUUID();
  const name = "httpTransport-test-fixture";
  const project = {
    $schema: "../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: DATA_DIR,
    meta: {
      id: projectId,
      name,
      createdAt: ts,
      updatedAt: ts,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
      tables: [],
      sequences: [],
      views: [],
    },
  };
  await fs.writeFile(path.join(tmpDir, "harmony.json"), JSON.stringify(project, null, 2), "utf-8");
  return tmpDir;
}

async function waitForReady(timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(HEALTH_URL);
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await delay(100);
  }
  throw new Error(`Server not ready after ${timeoutMs}ms`);
}

async function mcpCall(method: string, sessionId?: string, body: Record<string, unknown> = {}): Promise<{ status: number; headers: Headers; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, ...body }),
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

describe("backend HTTP transport (#302)", () => {
  beforeAll(async () => {
    // #758: lockdown モード fixture workspace を作成し DESIGNER_DATA_DIR で渡す。
    // draft__* / lock__* ツールは active workspace を要求するため、
    // lockdown 固定で起動することで per-session active state の問題を回避する。
    tempFixtureDir = await createFixtureWorkspace();

    server = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: __dirname + "/..", // backend/ dir
      env: {
        ...process.env,
        DESIGNER_MCP_PORT: String(TEST_PORT),
        DESIGNER_DATA_DIR: tempFixtureDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    server.on("error", (e) => console.error("[test] spawn error:", e));
    // pipe buffer を drain してブロッキングを防ぐ (#700 R-2 test fix)
    server.stderr?.resume();
    server.stdout?.resume();
    await waitForReady();
  }, 30000);

  afterAll(async () => {
    if (server && server.pid) {
      // Windows: shell:true で cmd.exe 経由の場合、process tree ごと強制終了する。
      // server.kill("SIGTERM") は cmd.exe しか殺さず node.js が orphan になってポートを占有し続けるため
      // taskkill /F /T で子孫まで含めてまとめて終了する (#700 R-2 test fix)
      try {
        const { execSync } = await import("node:child_process");
        execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
      } catch { /* ignore — already exited */ }
    }
    // Windows ではポート解放に時間がかかることがある
    await delay(500);
    // #758: fixture workspace の cleanup
    if (tempFixtureDir) {
      try {
        await fs.rm(tempFixtureDir, { recursive: true, force: true });
      } catch { /* ignore — OS が後で GC する */ }
      tempFixtureDir = null;
    }
  }, 10000);
  it("GET / で health JSON が返る", async () => {
    const r = await fetch(HEALTH_URL);
    expect(r.ok).toBe(true);
    const j = await r.json();
    expect(j).toMatchObject({ status: "ok", service: "harmony-mcp", port: TEST_PORT });
  });

  it("GET /health で half-dead 検知フィールドを含む health JSON が返る (#795-A)", async () => {
    const r = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(r.ok).toBe(true);
    const j = await r.json() as { status: string; lastWsMessageAt: number | null; wsConnections: number; uptimeMs: number };
    expect(j.status).toBe("ok");
    expect(Object.prototype.hasOwnProperty.call(j, "lastWsMessageAt")).toBe(true);
    expect(typeof j.wsConnections).toBe("number");
    expect(typeof j.uptimeMs).toBe("number");
    expect(j.uptimeMs).toBeGreaterThan(0);
  });

  it("POST /mcp initialize で protocolVersion が返る (stateless)", async () => {
    const res = await mcpCall("initialize", undefined, {
      id: 1,
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1" },
      },
    });
    expect(res.body).toContain("\"protocolVersion\"");
    expect(res.body).toContain("harmony-mcp");
  });

  // NOTE: draft__* / lock__* MCP tool E2E は #897 シリーズで legacy MCP tool が削除されたため除去。
  // 新 protocol 用 editSession__* MCP tool 追加は #906 で別途対応。

  it("同一 port で WebSocket も受け付ける (ws:// upgrade)", async () => {
    const ws = new WebSocket(WS_URL);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WS timeout")), 3000);
        ws.once("open", () => { clearTimeout(timer); resolve(); });
        ws.once("error", (e) => { clearTimeout(timer); reject(e); });
      });
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.close();
    }
  });

  // ── per-session active state (#700 R-2) ─────────────────────────────
  describe("WorkspaceContextManager per-session (WS 経路)", () => {
    /**
     * WS 経由で 2 つのクライアントを接続し、それぞれが独立した workspace.status を返すことを確認。
     *
     * シナリオ:
     * 1. client-A が接続・登録
     * 2. client-B が接続・登録
     * 3. client-A に workspace.status を送る → lockdown active (DESIGNER_DATA_DIR で固定)
     * 4. client-B に workspace.status を送る → lockdown active (同上)
     * 5. 2 session が独立した WS connection として接続でき、各々 status 応答を返せる
     *
     * Note (#758 lockdown 化以降): 本 server は DESIGNER_DATA_DIR で lockdown 起動するため
     * 全 session が同一 lockdown active を共有する (per-session active 独立性は lockdown 解除時の挙動)。
     * 本テストは「2 WS connection が独立して回答できる + lockdown active path が正しい」までを担保。
     */
    it("2 WS クライアントが接続でき、各々が lockdown active workspace.status を返す", async () => {
      const clientAId = `test-client-A-${Date.now()}`;
      const clientBId = `test-client-B-${Date.now()}`;

      /** WS に接続して register し、request を送って response を受け取るヘルパー */
      async function wsRoundtrip(
        clientId: string,
        method: string,
        params?: Record<string, unknown>,
      ): Promise<{ result?: unknown; error?: string }> {
        return new Promise<{ result?: unknown; error?: string }>((resolve, reject) => {
          const ws = new WebSocket(WS_URL);
          const reqId = `req-${Math.random().toString(36).slice(2)}`;
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`WS roundtrip timeout: ${method}`));
          }, 5000);

          ws.once("open", () => {
            // 1. register
            ws.send(JSON.stringify({ type: "register", clientId }));
            // 2. request
            ws.send(JSON.stringify({ type: "request", id: reqId, method, params: params ?? {} }));
          });

          ws.on("message", (data: Buffer) => {
            const msg = JSON.parse(data.toString()) as Record<string, unknown>;
            if (msg.type === "response" && msg.id === reqId) {
              clearTimeout(timer);
              ws.close();
              resolve({ result: msg.result, error: msg.error as string | undefined });
            }
          });

          ws.once("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
        });
      }

      // client-A: workspace.status
      const statusA = await wsRoundtrip(clientAId, "workspace.status");
      expect(statusA.error).toBeUndefined();
      const resultA = statusA.result as { active: { path: string } | null; lockdown: boolean };
      // #758: DESIGNER_DATA_DIR で lockdown 固定起動するため lockdown: true
      expect(resultA).toMatchObject({ lockdown: true });
      // active.path が tempFixtureDir (lockdown env で固定) と一致することを実値検証
      expect(resultA.active).not.toBeNull();
      expect(resultA.active?.path).toBe(tempFixtureDir);

      // client-B: workspace.status
      const statusB = await wsRoundtrip(clientBId, "workspace.status");
      expect(statusB.error).toBeUndefined();
      const resultB = statusB.result as { active: { path: string } | null; lockdown: boolean };
      // #758: DESIGNER_DATA_DIR で lockdown 固定起動するため lockdown: true
      expect(resultB).toMatchObject({ lockdown: true });
      // 全 session が同一 lockdown active を共有することを実値で確認
      expect(resultB.active).not.toBeNull();
      expect(resultB.active?.path).toBe(tempFixtureDir);
    });
  });

  describe("WorkspaceContextManager lockdown (WS 経路)", () => {
    /**
     * DESIGNER_DATA_DIR を渡して lockdown モードでサーバが起動している場合、
     * workspace.status で lockdown: true が返ることを確認する (#758)。
     */
    it("DESIGNER_DATA_DIR 指定時は lockdown: true が返る", async () => {
      async function wsRoundtrip(clientId: string, method: string): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
          const ws = new WebSocket(WS_URL);
          const reqId = `req-${Math.random().toString(36).slice(2)}`;
          const timer = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
          ws.once("open", () => {
            ws.send(JSON.stringify({ type: "register", clientId }));
            ws.send(JSON.stringify({ type: "request", id: reqId, method, params: {} }));
          });
          ws.on("message", (data: Buffer) => {
            const msg = JSON.parse(data.toString()) as Record<string, unknown>;
            if (msg.type === "response" && msg.id === reqId) {
              clearTimeout(timer);
              ws.close();
              resolve(msg.result);
            }
          });
          ws.once("error", (e) => { clearTimeout(timer); reject(e); });
        });
      }

      const result = await wsRoundtrip(`lockdown-test-${Date.now()}`, "workspace.status") as { lockdown: boolean };
      // #758: DESIGNER_DATA_DIR で lockdown 固定起動するため lockdown: true
      expect(result.lockdown).toBe(true);
    });
  });
});
