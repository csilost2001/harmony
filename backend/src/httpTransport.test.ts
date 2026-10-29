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
    // shell:true で cmd.exe / sh 経由のため、server.kill("SIGTERM") は親 shell しか
    // 殺さず孫の node.js が orphan になってポートを占有し続ける。
    // OS 別に process tree を強制終了し、最後にポート占有プロセスを掃除する (#905 fix)。
    const { execSync } = await import("node:child_process");

    if (server && server.pid) {
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
        } else {
          // Linux / macOS / WSL2: 自身 + 子孫を強制終了
          try {
            execSync(`pkill -9 -P ${server.pid}`, { stdio: "ignore" });
          } catch { /* no children */ }
          try {
            execSync(`kill -9 ${server.pid}`, { stdio: "ignore" });
          } catch { /* already exited */ }
        }
      } catch { /* ignore — already exited */ }
    }

    // 残存したポート占有プロセスを sweep する fallback (#905):
    // shell:true 経由で起動した tsx 孫プロセスが上記 kill で取り切れなかった場合の
    // 最後の砦。次回起動時の killStaleProcessOnPort が同じことをするが、ここで掃除して
    // おくことで test 間の冪等性を担保する。
    try {
      if (process.platform === "win32") {
        const out = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${TEST_PORT}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const pids = new Set<string>();
        for (const line of out.split(/\r?\n/)) {
          const m = line.match(/\s(\d+)\s*$/);
          if (m) pids.add(m[1]);
        }
        for (const pid of pids) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* ignore */ }
        }
      } else {
        const out = execSync(`lsof -ti tcp:${TEST_PORT} -sTCP:LISTEN`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        for (const pid of out.split(/\s+/)) {
          if (pid) {
            try { execSync(`kill -9 ${pid}`, { stdio: "ignore" }); } catch { /* ignore */ }
          }
        }
      }
    } catch { /* lsof / netstat exit 1 = no listener: 正常 */ }

    // ポート解放を待つ
    await delay(500);
    // #758: fixture workspace の cleanup
    if (tempFixtureDir) {
      try {
        await fs.rm(tempFixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

  // NOTE: draft__* / lock__* MCP tool E2E は #897 シリーズで legacy MCP tool が削除された。
  // 後継として editSession__* MCP tool E2E を以下に追加 (#906)。

  // ── editSession__* MCP tool E2E (#906) ──────────────────────────────────────
  // MCP HTTP transport は stateless (sessionIdGenerator: undefined) のため request 毎に
  // 新規 sessionId が発行され、editSession の participant 継続性が成立しない。
  // そこで:
  //   - HTTP MCP 経由テスト: tool dispatch (tools/list 登録 + params validation + 単発呼び出し)
  //   - WS roundtrip テスト: lifecycle (create → update → list → fetch_payload → save → discard、stable clientId)
  // 両方を組み合わせて、wsBridge.editSession* 公開 API (HTTP/WS 共有) を全経路で検証する。
  describe("editSession__* MCP tools — HTTP dispatch (#906)", () => {
    it("tools/list に editSession__* 10 件が登録されている", async () => {
      const res = await mcpCall("tools/list", undefined, { id: 1, params: {} });
      const body = res.body;
      // SSE / JSON どちらでも parse できるように
      let json: unknown;
      if (body.includes("data:")) {
        const dataLine = body.split(/\r?\n/).find((l) => l.startsWith("data:"));
        json = JSON.parse(dataLine!.slice(5).trim());
      } else {
        json = JSON.parse(body);
      }
      const r = json as { result: { tools: Array<{ name: string }> } };
      const editSessionTools = r.result.tools.filter((t) => t.name.startsWith("editSession__"));
      expect(editSessionTools).toHaveLength(10);
      const names = editSessionTools.map((t) => t.name).sort();
      expect(names).toEqual([
        "editSession__attach_as_view",
        "editSession__create",
        "editSession__detach",
        "editSession__discard",
        "editSession__fetch_payload",
        "editSession__list",
        "editSession__save",
        "editSession__set_role",
        "editSession__transfer_edit",
        "editSession__update",
      ]);
    });
  });

  describe("editSession__* lifecycle — WS roundtrip (#906)", () => {
    /**
     * 同一 WS 接続で複数 request を同期的に投げて response を集める helper。
     * stable clientId (= participant.sessionId) 前提のテストに使う。
     */
    async function wsLifecycle(
      clientId: string,
      requests: Array<{ id: string; method: string; params?: Record<string, unknown> }>,
    ): Promise<Array<{ id: string; result?: unknown; error?: string }>> {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const responses: Array<{ id: string; result?: unknown; error?: string }> = [];
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("WS lifecycle timeout"));
        }, 10_000);

        ws.once("open", () => {
          ws.send(JSON.stringify({ type: "register", clientId }));
          for (const req of requests) {
            ws.send(JSON.stringify({ type: "request", ...req }));
          }
        });

        ws.on("message", (data: Buffer) => {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;
          if (msg.type === "response" && typeof msg.id === "string") {
            responses.push({ id: msg.id, result: msg.result, error: msg.error as string | undefined });
            if (responses.length === requests.length) {
              clearTimeout(timer);
              ws.close();
              resolve(responses);
            }
          }
        });

        ws.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
    }

    it("editSession 1-6 step フロー: create → update → list → fetch_payload → save → discard", async () => {
      const clientId = `lifecycle-test-${Date.now()}`;
      const resourceType = "table";
      const resourceId = `tbl-lifecycle-${Date.now()}`;

      // step 1: create
      const r1 = await wsLifecycle(clientId, [
        { id: "create", method: "editSession.create", params: { resourceType, resourceId, displayLabel: "@vitest" } },
      ]);
      expect(r1[0].error).toBeUndefined();
      const created = r1[0].result as { editSession: { id: string; sequence: number } };
      expect(created.editSession.id).toMatch(/^es-/);
      const editSessionId = created.editSession.id;

      // step 2-6: update → list → fetch_payload → save → discard を同一 connection で連続実行
      const r2 = await wsLifecycle(clientId, [
        { id: "update", method: "editSession.update", params: { editSessionId, payload: { columns: [{ name: "id" }], dataDir: "harmony" } } },
        { id: "list", method: "editSession.list", params: { resourceType, resourceId } },
        { id: "fetch", method: "editSession.fetchPayload", params: { editSessionId } },
        { id: "save", method: "editSession.save", params: { editSessionId } },
        { id: "discard", method: "editSession.discard", params: { editSessionId } },
      ]);

      const byId = (id: string) => r2.find((r) => r.id === id);

      // step 2: update
      expect(byId("update")?.error).toBeUndefined();
      expect((byId("update")?.result as { sequence: number }).sequence).toBe(1);

      // step 3: list
      const listed = byId("list")?.result as { sessions: Array<{ id: string; state: string }> };
      expect(listed.sessions).toHaveLength(1);
      expect(listed.sessions[0].id).toBe(editSessionId);

      // step 4: fetch_payload
      const fetched = byId("fetch")?.result as { payload: { columns: Array<{ name: string }> }; sequence: number };
      expect(fetched.payload.columns[0].name).toBe("id");
      expect(fetched.sequence).toBe(1);

      // step 5: save
      const saved = byId("save")?.result as { ok: boolean; saveEvent?: { sequence: number } };
      expect(saved.ok).toBe(true);
      expect(saved.saveEvent?.sequence).toBe(1);

      // step 6: discard
      expect(byId("discard")?.error).toBeUndefined();
      expect((byId("discard")?.result as { discarded: boolean }).discarded).toBe(true);
    });

    it("editSession.save の 2 段階保存 (stage=checkOnly → stage=commit、#912 連携)", async () => {
      const clientId = `stage-test-${Date.now()}`;
      const r1 = await wsLifecycle(clientId, [
        { id: "create", method: "editSession.create", params: { resourceType: "process-flow", resourceId: `pf-stage-${Date.now()}` } },
      ]);
      const editSessionId = (r1[0].result as { editSession: { id: string } }).editSession.id;

      const r2 = await wsLifecycle(clientId, [
        { id: "update", method: "editSession.update", params: { editSessionId, payload: { name: "stage-test" } } },
        { id: "checkOnly", method: "editSession.save", params: { editSessionId, stage: "checkOnly" } },
        { id: "commit", method: "editSession.save", params: { editSessionId, stage: "commit" } },
      ]);

      // checkOnly は saveEvent なし
      const checkOnly = r2.find((r) => r.id === "checkOnly")?.result as { ok: boolean; saveEvent?: unknown };
      expect(checkOnly.ok).toBe(true);
      expect(checkOnly.saveEvent).toBeUndefined();

      // commit は saveEvent あり (sequence=1)
      const commit = r2.find((r) => r.id === "commit")?.result as { ok: boolean; saveEvent?: { sequence: number } };
      expect(commit.ok).toBe(true);
      expect(commit.saveEvent?.sequence).toBe(1);
    });

    it("editSession.fetchPayload: 存在しない editSessionId は error を返す", async () => {
      const r = await wsLifecycle(`fp-not-found-${Date.now()}`, [
        { id: "fetch", method: "editSession.fetchPayload", params: { editSessionId: "es-non-existent-zzz" } },
      ]);
      expect(r[0].error).toBeDefined();
      expect(r[0].error).toContain("見つかりません");
    });
  });

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
