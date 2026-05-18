import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { wsBridge } from "./wsBridge.js";
import { tools } from "./tools.js";
import { handleAuthCheck, handlePropose } from "./aiRename.js";
import {
  initWorkspaceState,
  connect as wsConnect,
  disconnect as wsDisconnect,
  WorkspaceUnsetError,
  workspaceContextManager,
} from "./workspaceState.js";
import { autoActivateOnStartup } from "./workspaceInit.js";
import { initServerLog, shutdownServerLog, logInfo, logError, ingestClientLog } from "./serverLog.js";

// 機能領域別 MCP tool handler (#1144 Phase-1: index.ts 1830 → ~200 LOC に分離)。
// 各 handler は ToolHandler signature (name/args/root/sessionId) を実装し、該当 tool は処理し、
// それ以外は null を返して dispatcher に次の handler を試させる。
import { handleMarkerTool } from "./handlers/marker.js";
import { handleProcessFlowTool } from "./handlers/processFlow.js";
import { handleDesignerTool } from "./handlers/designer.js";
import { handleScreenTool } from "./handlers/screen.js";
import { handleEdgeTool } from "./handlers/edge.js";
import { handleCustomBlockTool } from "./handlers/customBlock.js";
import { handlePuckComponentTool } from "./handlers/puckComponent.js";
import { handleTableTool } from "./handlers/table.js";
import { handlePageLayoutTool } from "./handlers/pageLayout.js";
import { handleExportTool } from "./handlers/export.js";
import { handleTabTool } from "./handlers/tab.js";
import { handleScreenItemTool } from "./handlers/screenItem.js";
import { handleWorkspaceTool } from "./handlers/workspace.js";
import { handleEditSessionTool } from "./handlers/editSession.js";

// 物理ログ初期化 (#750 follow-up): logs/ ディレクトリへ JSON Lines 形式で永続化
// projectRoot = backend の親 (= repo root)。env DESIGNER_LOG_DIR で上書き可能。
const projectRoot = process.env.DESIGNER_LOG_DIR ?? path.resolve(process.cwd(), "..");
initServerLog(projectRoot);

// 常駐バックエンドなので停止 signal (SIGTERM/SIGINT/disconnect) のみ監視。
// stdin は監視しない (#302: HTTP transport に統一、stdio 廃止)。
function setupLifecycle(): void {
  // stdout/stderr EPIPE は親プロセス pipe 切断時に発生しうるため silent drop する。
  // EPIPE 以外 (ENOSPC 等) は file log に残す。logError 経路が console.error にも書くが、
  // serverLog.log の `_inLog` 再入 guard により無限ループにはならない (#1174)。
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    try { logError("lifecycle", "stdout error", { error: err.message, code: err.code }); } catch { /* ignore */ }
  });
  process.stderr.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    try { logError("lifecycle", "stderr error", { error: err.message, code: err.code }); } catch { /* ignore */ }
  });

  const exitHandler = (reason: string) => {
    try {
      logInfo("lifecycle", `Exiting: ${reason}`);
      wsBridge.stop();
      shutdownServerLog();
    } catch { /* ignore shutdown errors */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => exitHandler("SIGTERM"));
  process.on("SIGINT", () => exitHandler("SIGINT"));
  process.on("disconnect", () => exitHandler("disconnected from parent"));
  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    try { logError("lifecycle", "uncaughtException", { error: err.message, stack: err.stack }); } catch { /* ignore */ }
  });
  process.on("unhandledRejection", (reason) => {
    try {
      logError("lifecycle", "unhandledRejection", {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    } catch { /* ignore */ }
  });
}

setupLifecycle();

// workspace 状態の初期化 (#671): env DESIGNER_DATA_DIR があれば lockdown モード固定
initWorkspaceState();

// 起動時の自動 active 設定 (#672, #754):
// 1. lockdown 中はスキップ (env で固定済み)
// 2. recent.lastActiveId が指す workspace があれば再オープン
// 3. 何もなければ active 未設定 (UI 側で /workspace/select に誘導)
// #754: data/ legacy auto-activate は削除。data/ は data/extensions/ 専用。
// #959: HARMONY_E2E_NO_AUTO_ACTIVATE=1 のとき e2e テスト環境では skip (recent.lastActiveId
//       の暗黙引き継ぎを断ち、spec が明示的な workspace.open で制御できるようにする)
if (!process.env.HARMONY_E2E_NO_AUTO_ACTIVATE) {
  const r = await autoActivateOnStartup();
  switch (r.status) {
    case "lockdown":
      logInfo("workspace", "lockdown モード", { path: r.path });
      break;
    case "restored":
      logInfo("workspace", "前回の workspace を再オープン", { name: r.entry.name, path: r.entry.path });
      break;
    case "none":
      logInfo("workspace", "active 未選択 (UI 側で /workspace/select に誘導)");
      break;
  }
} else {
  logInfo("workspace", "HARMONY_E2E_NO_AUTO_ACTIVATE=1: autoActivateOnStartup をスキップ (e2e モード)");
}

// HTTP + WebSocket サーバ起動 (port 5179 に両方同居)
await wsBridge.start();
wsBridge.on("connected", () => logInfo("ws-bridge", "Designer connected via WebSocket"));
wsBridge.on("disconnected", () => logInfo("ws-bridge", "Designer disconnected"));

// クライアント (ブラウザ uiLog) からログ flush を受け取るハンドラ (#750 follow-up)
wsBridge.registerBrowserHandler("client.log.flush", async (params) => {
  const entries = ((params as { entries?: unknown })?.entries ?? []) as Array<{
    ts: number;
    level: "debug" | "info" | "warn" | "error";
    category: string;
    msg: string;
    ctx?: Record<string, unknown>;
  }>;
  if (!Array.isArray(entries)) return { count: 0 };
  return ingestClientLog(entries);
});

// MCPサーバーのファクトリ (#302, #700 R-2): HTTP リクエスト毎に fresh な Server インスタンスを
// 作成することで、複数クライアントが同時接続しても互いの initialize 状態と干渉しない
// (Server.connect(transport) は 1:1 関係、1 Server を複数 transport に share はできないため)
// sessionId を受け取り、workspaceContextManager に connect して per-session active を解決する。
function createMcpServer(sessionId: string): Server {
  const server = new Server(
    { name: "harmony-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // ツール一覧
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // ツール呼び出し (#1144 Phase-1: ハンドラ群を機能領域別に handlers/*.ts へ分離。
  // index.ts はディスパッチャと共通エラーハンドリングのみを担う)。
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const argRecord = (args ?? {}) as Record<string, unknown>;
    // MCP tool 内で resolveRoot を呼ぶために sessionId を使う (#700 R-2)
    const mcpRoot = (): string => workspaceContextManager.requireActivePath(sessionId);

    try {
      // 各 handler は該当しなければ null を返し、次の handler に委譲される。
      // 並び順は元 index.ts の switch 文と一致 (機能領域順、editSession は最後)。
      // #700 R-2: root と sessionId を pass-through する。
      // root は eager に解決される (workspace 未選択時は WorkspaceUnsetError、
      // 下の catch で McpError に変換)。
      const root = mcpRoot();
      const dispatchers = [
        handleMarkerTool,
        handleProcessFlowTool,
        handleDesignerTool,
        handleScreenTool,
        handleEdgeTool,
        handleCustomBlockTool,
        handlePuckComponentTool,
        handleTableTool,
        handlePageLayoutTool,
        handleExportTool,
        handleTabTool,
        handleScreenItemTool,
        handleWorkspaceTool,
        handleEditSessionTool,
      ];
      for (const handler of dispatchers) {
        const result = await handler(name, argRecord, root, sessionId);
        if (result !== null && result !== undefined) return result;
      }
      throw new McpError(ErrorCode.MethodNotFound, `未知のツール: ${name}`);
    } catch (err) {
      if (err instanceof WorkspaceUnsetError) {
        throw new McpError(ErrorCode.InvalidParams, err.message);
      }
      if (err instanceof McpError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `エラー: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// 起動 (#302): HTTP transport のみ。port 5179 の `/mcp` endpoint を公開、常駐バックエンド。
// 複数クライアント (Claude Code 複数セッション) が同時接続できるよう、リクエスト毎に
// fresh な Server + transport を作成する。tools の登録は軽量 (JSON schema + 関数参照)
// なので per-request コストは無視できる。
async function main() {
  wsBridge.registerHttpHandler("/mcp", async (req, res) => {
    // #700 R-2: per-request sessionId を発行し workspaceContextManager に connect する。
    // MCP は stateless (sessionIdGenerator: undefined) のため、各 HTTP request を 1 session として扱う。
    // 初回 initialize から以降の tool/call まで同一 clientId を使うには session 管理が必要だが、
    // stateless モードでは request 毎に fresh な server を作るため、lockdown 時は全 request が
    // lockdownPath を解決できる (connect で lockdown path を自動設定)。
    // non-lockdown 時は自動ActivateOnStartup で設定された global path を引き継ぐために
    // last-active path を初期値として使う。
    const sessionId = randomUUID();
    // autoActivateOnStartup が設定した global active (lockdown or last-active) を引き継ぐ
    // ために initialPath を渡す: isLockdown() → getLockdownPath()、それ以外は null (未選択)
    wsConnect(sessionId);  // lockdown 時は initWorkspaceState() で設定済みなので connect で反映される
    const server = createMcpServer(sessionId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error("[MCP/HTTP] handler error:", e);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Internal error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      try { await transport.close(); } catch { /* ignore */ }
      try { await server.close(); } catch { /* ignore */ }
      wsDisconnect(sessionId);  // session 終了時に context を削除
    }
  });

  // AI 命名 endpoints (#337)
  wsBridge.registerHttpHandler("/ai/rename-screen-ids/auth-check", handleAuthCheck);
  wsBridge.registerHttpHandler("/ai/rename-screen-ids/propose", handlePropose);

  console.error(`[MCP] harmony-mcp HTTP transport mounted at http://localhost:${process.env.DESIGNER_MCP_PORT ?? 5179}/mcp`);
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
