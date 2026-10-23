import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { wsBridge } from "./wsBridge.js";
import { installSelfWriteTracking } from "./externalChanges.js";
import { installApprovalGuard } from "./ops/policy.js";
import { profilesFromRequest } from "./security/mcpProfiles.js";
import { createMcpServer } from "./mcpServer.js";
import { detailFromRequest } from "./mcpToolMeta.js";
import { handleAuthCheck, handlePropose } from "./aiRename.js";
import { createStaticAssetHandler } from "./staticAssets.js";
import {
  initWorkspaceState,
  connect as wsConnect,
  disconnect as wsDisconnect,
} from "./workspaceState.js";
import { autoActivateOnStartup } from "./workspaceInit.js";
import { initServerLog, shutdownServerLog, logInfo, logError, ingestClientLog } from "./serverLog.js";

// 物理ログ初期化 (#750 follow-up): logs/ ディレクトリへ JSON Lines 形式で永続化
// projectRoot = backend の親 (= repo root)。env DESIGNER_LOG_DIR で上書き可能。
const projectRoot = process.env.DESIGNER_LOG_DIR ?? path.resolve(process.cwd(), "..");
initServerLog(projectRoot);
// backend 自身のファイルの書き込みを記録する (外部変更の検知から除く。externalChanges.ts)
installSelfWriteTracking();
installApprovalGuard();

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

  // graceful shutdown を async で実行 (#1400)。
  // wsBridge.stop() を await することで Codex 孫プロセス / HTTP 接続 / WebSocket 接続を
  // 確実に閉じてから process.exit する。3 秒経っても完了しない場合は safeguard timer で
  // 強制終了し、tsx watch の 5 秒 force-kill より前に自前で死ぬ。
  // 二重 signal (Ctrl+C 連打) で handler が重複起動するのを防ぐため shuttingDown フラグで guard。
  let shuttingDown = false;
  const exitHandler = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceKillTimer = setTimeout(() => process.exit(0), 3000);
    forceKillTimer.unref();
    try {
      logInfo("lifecycle", `Exiting: ${reason}`);
      await wsBridge.stop();
      shutdownServerLog();
    } catch { /* ignore shutdown errors */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => { void exitHandler("SIGTERM"); });
  process.on("SIGINT", () => { void exitHandler("SIGINT"); });
  process.on("disconnect", () => { void exitHandler("disconnected from parent"); });
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
    // 接続の URL の ?profile= (または HARMONY_MCP_PROFILE) で、AI に見せる tool を絞る
    const prof = profilesFromRequest(req.url);
    if (prof.unknown.length) {
      wsDisconnect(sessionId);
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`未知のプロファイルです: ${prof.unknown.join(", ")}`);
      return;
    }
    const det = detailFromRequest(req.url);
    if (det.unknown) {
      wsDisconnect(sessionId);
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`未知の detail です: ${det.unknown} (full / brief)`);
      return;
    }
    const server = createMcpServer(sessionId, prof.names, det.mode);
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

  if (process.env.HARMONY_STATIC_DIR) {
    wsBridge.registerHttpFallbackHandler(createStaticAssetHandler(process.env.HARMONY_STATIC_DIR));
    logInfo("http", "SPA static assets enabled", { staticDir: process.env.HARMONY_STATIC_DIR });
  }

  console.error(`[MCP] harmony-mcp HTTP transport mounted at http://localhost:${process.env.DESIGNER_MCP_PORT ?? 5179}/mcp`);
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
