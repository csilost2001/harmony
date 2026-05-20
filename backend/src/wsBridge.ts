import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { CodexBroadcastBridge } from "./codex/broadcastBridge.js";
import {
  unregisterAllForSession as presenceUnregisterAllForSession,
  list as presenceList,
  startCleanupInterval as presenceStartCleanupInterval,
  stopCleanupInterval as presenceStopCleanupInterval,
} from "./presenceManager.js";
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { workspaceContextManager } from "./workspaceState.js";
import { killStaleProcessOnPort } from "./wsBridge/killStalePort.js";
import { EditSessionService } from "./wsBridge/editSessionService.js";
import {
  type DraftResourceType as EditSessionResourceType,
  type ParticipantInfo as EditSessionParticipantInfo,
  type SaveEvent as EditSessionSaveEvent,
} from "./editSessionStore.js";
import { resolveRoot } from "./projectStorage.js";
import { rpcHandlerMap, type RpcContext } from "./wsHandlers/index.js";
import { logInfo, logWarn, logError } from "./serverLog.js";
import { checkRequestOrigin } from "./security/originCheck.js";

type Command = { id: string; method: string; params?: unknown };
type Response = { id: string; result?: unknown; error?: string };
type BrowserRequest = { type: "request"; id: string; method: string; params?: unknown };

// Port は env var で上書き可能 (テスト用に任意 port を使う想定)。未指定なら 5179 (#302)
const WS_PORT = parseInt(process.env.DESIGNER_MCP_PORT ?? "5179", 10);
const TIMEOUT_MS = 10000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEpipe(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "EPIPE";
}

/** HTTP request handler (index.ts が MCP endpoint 等を register するために使用) */
type HttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export class WsBridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private httpRoutes: Array<{ pathPrefix: string; handler: HttpRequestHandler }> = [];
  /** clientId → WebSocket（登録済みクライアント） */
  private clients = new Map<string, WebSocket>();
  /** 接続順（最後が最新）。MCP コマンドの送信先選択に使用 */
  private clientOrder: string[] = [];
  /** MCP コマンドの応答待ちハンドラ */
  private pending = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  /** 最後に WebSocket メッセージを受信した時刻 (ms)。half-dead 検知用 (#795-A) */
  private lastMessageAt: number | null = null;
  /** プロセス起動時刻 (ms) */
  private readonly startedAt: number = Date.now();
  // ── EditSession service (#906 / #1144 Phase-2) ───────────────────────────
  // 内部実装は wsBridge/editSessionService.ts に分離。wsBridge は broadcast 関数を inject し、
  // editSession.* RPC handler は ctx.bridge.editSession* (adapter) 経由で呼ぶ。
  // MCP tool (handlers/editSession.ts) も同じ adapter を使う (契約共有 = #906)。
  private readonly editSessionService: EditSessionService = new EditSessionService(
    (opts) => this.broadcast(opts),
  );

  // ── Codex App Server integration (#867 / #1144 Phase-2) ──────────────────
  // 内部実装は codex/broadcastBridge.ts に分離。wsBridge は broadcast 関数を inject し、
  // codex.* RPC handler は ctx.bridge.codex 経由で本インスタンスにアクセスする。
  /** Codex broadcast bridge — public (handler 側からの adapter access 用) */
  public readonly codex: CodexBroadcastBridge = new CodexBroadcastBridge(
    (event, data) => this.broadcast({ wsId: null, event, data }),
  );

  get isConnected(): boolean {
    return this.clients.size > 0;
  }

  /** 指定 sessionId が接続中かつ OPEN 状態かを返す (AI 委任の owner 検証用) */
  isActiveSession(sessionId: string): boolean {
    const ws = this.clients.get(sessionId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /**
   * サーバ生存情報を返す (#795-A: half-dead 検知 + /health endpoint 用)。
   * - lastWsMessageAt: 最後に WebSocket メッセージを受信したエポック ms (null = まだ受信なし)
   * - wsConnections: 現在の接続ブラウザ数
   * - uptimeMs: プロセス起動からの経過 ms
   */
  getHealth(): { lastWsMessageAt: number | null; wsConnections: number; uptimeMs: number } {
    return {
      lastWsMessageAt: this.lastMessageAt,
      wsConnections: this.clients.size,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  // ── EditSession adapter (#906, MCP tool + WS handler 共有 — 実装は wsBridge/editSessionService.ts) ──
  // sessionId は workspace 解決 + actor (participant.sessionId) として使われる。
  // WS 経由は WebSocket clientId、MCP 経由は MCP sessionId をそのまま渡す
  // (workspaceContextManager は両 namespace を統一管理する、#700 R-2)。
  // 全 method を service への delegation として薄く保つ (#1144 Phase-2)。

  /**
   * workspace close 時に当該 wsId の EditSessionStore を破棄する (#899 Phase 2)。
   * #1144 Phase-2: wsHandlers/workspace.ts から呼ばれる公開 API。
   * 存在しない場合は no-op。
   */
  deleteEditSessionStoreForWorkspace(wsId: string): void {
    this.editSessionService.deleteStoreForWorkspace(wsId);
  }

  /** spec §5 step 1: 新規 EditSession を作成し initial Edit participant として登録 + broadcast */
  editSessionCreate(
    sessionId: string,
    resourceType: EditSessionResourceType,
    resourceId: string,
    displayLabel?: string,
    parentHumanSessionId?: string,
  ): { editSession: unknown } {
    return this.editSessionService.create(sessionId, resourceType, resourceId, displayLabel, parentHumanSessionId);
  }

  /** spec §5 step 2: View role で attach + initial payload fetch + broadcast */
  editSessionAttachAsView(
    sessionId: string,
    editSessionId: string,
    displayLabel?: string,
    parentHumanSessionId?: string,
  ): { participant: EditSessionParticipantInfo; payload: unknown; sequence: number } {
    return this.editSessionService.attachAsView(sessionId, editSessionId, displayLabel, parentHumanSessionId);
  }

  /** participant detach + broadcast (Edit role は事前に View 降格必要) */
  editSessionDetach(sessionId: string, editSessionId: string): { detached: true } {
    return this.editSessionService.detach(sessionId, editSessionId);
  }

  /** participant role 変更 + broadcast (通常は transferEdit を使う) */
  editSessionSetRole(
    sessionId: string,
    editSessionId: string,
    newRole: "Edit" | "View",
  ): { participant: EditSessionParticipantInfo } {
    return this.editSessionService.setRole(sessionId, editSessionId, newRole);
  }

  /** spec §7: take-over (caller = new Edit holder)。fromSessionId は participants から自動検索 */
  editSessionTransferEdit(
    sessionId: string,
    editSessionId: string,
  ): { from: EditSessionParticipantInfo; to: EditSessionParticipantInfo } {
    return this.editSessionService.transferEdit(sessionId, editSessionId);
  }

  /** spec §13.2 update: payload を更新 + broadcast (FS write なし、Forward-Compat 原則 ④) */
  editSessionUpdate(
    sessionId: string,
    editSessionId: string,
    payload: unknown,
  ): { sequence: number } {
    return this.editSessionService.update(sessionId, editSessionId, payload);
  }

  /**
   * spec §5 step 5 / §8: 確定保存。stage パラメータで 2 段階保存をサポート (#912)。
   * 衝突時は { ok: false, conflict } を return value で signal (throw しない)。
   */
  async editSessionSave(
    sessionId: string,
    editSessionId: string,
    opts?: { force?: boolean; stage?: "checkOnly" | "commit" },
  ): Promise<
    | { ok: true; saveEvent?: EditSessionSaveEvent }
    | { ok: false; conflict: { other: { editSessionId: string; savedBy: string; savedAt: string; displayLabel: string } } }
  > {
    return this.editSessionService.save(sessionId, editSessionId, opts);
  }

  /** spec §5 step 6a: Active → Discarded + broadcast */
  async editSessionDiscard(sessionId: string, editSessionId: string): Promise<{ discarded: true }> {
    return this.editSessionService.discard(sessionId, editSessionId);
  }

  /** EditSession 一覧を返す (filter なしで全件、resourceType+resourceId 指定で絞り込み) */
  editSessionList(
    sessionId: string,
    filter?: { resourceType?: EditSessionResourceType; resourceId?: string },
  ): { sessions: unknown[] } {
    return this.editSessionService.list(sessionId, filter);
  }

  /** spec §13.3: 現在の payload + sequence を取得 (broadcast 待ちなし) */
  editSessionFetchPayload(
    sessionId: string,
    editSessionId: string,
  ): { payload: unknown; sequence: number } {
    return this.editSessionService.fetchPayload(sessionId, editSessionId);
  }

  /** #893: DraftHistory 一覧を返す */
  async editSessionListHistory(
    sessionId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<{ history: unknown[] }> {
    return this.editSessionService.listHistory(sessionId, resourceType, resourceId);
  }

  /**
   * #893: 履歴から新規 EditSession を作成して返す。
   * DraftHistoryStore からスナップショットを読み込み、新規 EditSession を作成して
   * スナップショットを初期 payload として設定する。
   */
  async editSessionRestoreFromHistory(
    sessionId: string,
    historyId: string,
    displayLabel?: string,
  ): Promise<{ editSession: unknown }> {
    return this.editSessionService.restoreFromHistory(sessionId, historyId, displayLabel);
  }

  /** MCP コマンドを送る先: 最後に接続した有効なクライアント */
  private get activeClient(): WebSocket | null {
    for (let i = this.clientOrder.length - 1; i >= 0; i--) {
      const ws = this.clients.get(this.clientOrder[i]);
      if (ws && ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  async start(): Promise<void> {
    // workspace 切替モード対応 (#671): startup 時点で workspace 未選択のことがあるため、
    // ensureDataDir() は呼ばない。各 read/write 関数が必要時に ensureDataDir() を呼ぶ。
    if (killStaleProcessOnPort(WS_PORT)) {
      await delay(500);
    }
    await this._bind();

    // Phase 7 (#885): abandoned entry の定期 cleanup を開始
    presenceStartCleanupInterval((wsId, resourceType, resourceId, entries) => {
      this.broadcast({
        wsId,
        event: "presence:update",
        data: { resourceType, resourceId, entries },
      });
    });

    // spec §12.4 / §18.3: EditSession の 1h 周期 cleanupExpired を開始
    // (実装は editSessionService、wsBridge は起動 / 停止のみ trigger)
    this.editSessionService.startCleanupInterval();
  }

  /** spec §12.4: cleanupExpired タイマーを停止する。shutdown / テスト用。 */
  stopEditSessionCleanup(): void {
    this.editSessionService.stopCleanupInterval();
  }

  /** Phase 7 (#885): cleanup タイマーを停止する。shutdown hook 用。 */
  stopPresenceCleanup(): void {
    presenceStopCleanupInterval();
  }

  /** HTTP + WebSocket サーバを停止し全接続を切断する。shutdown hook 用。 */
  stop(): void {
    presenceStopCleanupInterval();
    this.stopEditSessionCleanup();
    // Close Codex connection if it was opened (#867)
    void this.codex.close();
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.closeAllConnections?.();
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  private async _bind(retries = 3): Promise<void> {
    return new Promise((resolve, reject) => {
      // HTTP サーバに WS をアタッチ (同一 port で HTTP + WS を提供 — #302)
      const httpServer = createServer((req, res) => this._handleHttp(req, res));
      const wss = new WebSocketServer({ server: httpServer });

      const onError = async (err: NodeJS.ErrnoException) => {
        httpServer.off("listening", onListening);
        if (err.code === "EADDRINUSE" && retries > 0) {
          logWarn("ws-bridge", "Port busy, retrying", { port: WS_PORT, retries });
          killStaleProcessOnPort(WS_PORT);
          await delay(500);
          try {
            await this._bind(retries - 1);
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          logError("ws-bridge", "Failed to bind", { error: err.message, code: err.code, port: WS_PORT });
          reject(err);
        }
      };

      const onListening = () => {
        httpServer.off("error", onError);
        this.httpServer = httpServer;
        this.wss = wss;
        logInfo("ws-bridge", "HTTP + WebSocket listening", { host: "0.0.0.0", port: WS_PORT });
        this._attachHandlers();
        resolve();
      };

      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(WS_PORT, "0.0.0.0");
    });
  }

  /**
   * index.ts 側が特定 path prefix 用の HTTP ハンドラを登録する (#302: MCP HTTP transport)。
   * 登録順にマッチ判定、先にマッチしたものが処理。
   */
  registerHttpHandler(pathPrefix: string, handler: HttpRequestHandler): void {
    this.httpRoutes.push({ pathPrefix, handler });
  }

  private async _handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";

    // S-001: Origin / loopback 検証 (health check エンドポイントは除外)
    if (url !== "/" && url !== "/health") {
      const originError = checkRequestOrigin(req);
      if (originError) {
        logWarn("ws-bridge", "HTTP request rejected: origin check failed", { url, reason: originError });
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }
    }

    for (const route of this.httpRoutes) {
      if (url === route.pathPrefix || url.startsWith(route.pathPrefix + "/") || url.startsWith(route.pathPrefix + "?")) {
        try {
          await route.handler(req, res);
        } catch (e) {
          logError("ws-bridge", "HTTP handler error", {
            pathPrefix: route.pathPrefix,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          });
          if (!res.writableEnded) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end(`Internal error: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return;
      }
    }
    // Health check endpoint (#795-A): half-dead 検知情報を含む
    if (url === "/" || url === "/health") {
      const health = this.getHealth();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "harmony-mcp",
        port: WS_PORT,
        lastWsMessageAt: health.lastWsMessageAt,
        wsConnections: health.wsConnections,
        uptimeMs: health.uptimeMs,
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }

  private _attachHandlers(): void {
    if (!this.wss) return;

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      // S-001: Origin / loopback 検証
      const originError = checkRequestOrigin(req);
      if (originError) {
        logWarn("ws-bridge", "WebSocket connection rejected: origin check failed", { reason: originError });
        ws.close(1008, "Forbidden");
        return;
      }

      // 登録前は一時 ID で管理
      let clientId = `temp-${randomUUID()}`;
      this.clients.set(clientId, ws);
      this.clientOrder.push(clientId);
      // per-session context を作成 (#700 R-2)
      workspaceContextManager.connect(clientId);
      logInfo("ws-bridge", "New connection", { clientId: clientId.substring(0, 12), total: this.clients.size });
      if (this.clients.size === 1) this.emit("connected");

      ws.on("message", (data: Buffer) => {
        this.lastMessageAt = Date.now();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch (e) {
          logWarn("ws-bridge", "Failed to parse message", {
            error: e instanceof Error ? e.message : String(e),
          });
          return;
        }

        // ── register: ブラウザが接続直後に送る登録メッセージ ──
        if (msg.type === "register") {
          const newId = msg.clientId as string;

          // 同じ clientId が既に存在する場合（再接続）は古い接続を閉じる
          const existingWs = this.clients.get(newId);
          if (existingWs && existingWs !== ws) {
            try { existingWs.close(); } catch { /* ignore */ }
            this.clients.delete(newId);
            const eIdx = this.clientOrder.indexOf(newId);
            if (eIdx >= 0) this.clientOrder.splice(eIdx, 1);
            // 再接続: 古い context は削除せず reconnect 扱い (activePath 維持)
          }

          // 一時 ID → 実 ID に置き換え: context も付け替え (#700 R-2)
          const prevCtxActivePath = workspaceContextManager.getActivePath(clientId);
          workspaceContextManager.disconnect(clientId);
          this.clients.delete(clientId);
          const tIdx = this.clientOrder.indexOf(clientId);
          if (tIdx >= 0) this.clientOrder[tIdx] = newId;
          clientId = newId;
          this.clients.set(clientId, ws);
          // 実 ID で context を登録 (既存なら reconnect で activePath 維持)
          workspaceContextManager.connect(clientId, prevCtxActivePath);
          logInfo("ws-bridge", "Client registered", { clientId: clientId.substring(0, 8), total: this.clients.size });
          return;
        }

        // ── request: ブラウザからのファイル操作リクエスト ──
        if (msg.type === "request") {
          const req = msg as unknown as BrowserRequest;
          this._handleBrowserRequest(ws, clientId, req).catch((e) => {
            logWarn("ws-bridge", "Browser request error", {
              error: e instanceof Error ? e.message : String(e),
            });
            try {
              ws.send(JSON.stringify({ type: "response", id: req.id, error: String(e) }));
            } catch { /* ignore */ }
          });
          return;
        }

        // ── それ以外: MCP コマンドへの応答 ──
        const response = msg as unknown as Response;
        const handler = this.pending.get(response.id);
        if (handler) {
          clearTimeout(handler.timer);
          this.pending.delete(response.id);
          if (response.error) {
            handler.reject(new Error(response.error));
          } else {
            handler.resolve(response.result);
          }
        }
      });

      ws.on("close", () => {
        if (this.clients.get(clientId) === ws) {
          this.clients.delete(clientId);
          const idx = this.clientOrder.indexOf(clientId);
          if (idx >= 0) this.clientOrder.splice(idx, 1);
          // #980-A: presence 切断時 cleanup — clientId に紐づく全エントリを削除して
          // presence:update を broadcast する。これがないと cleanupAbandoned (idleThresholdSec
          // 経過 + 定期実行) まで SessionBadge が残り続ける。
          const removedPresence = presenceUnregisterAllForSession(clientId);
          for (const { wsId: rWsId, resourceType: rType, resourceId: rId } of removedPresence) {
            const entries = presenceList(rWsId, rType, rId);
            this.broadcast({
              wsId: rWsId,
              event: "presence:update",
              data: { resourceType: rType, resourceId: rId, entries },
            });
          }
          // per-session context を削除 (#700 R-2)
          workspaceContextManager.disconnect(clientId);
          logInfo("ws-bridge", "Client disconnected", { clientId: clientId.substring(0, 8), remaining: this.clients.size });
          if (this.clients.size === 0) {
            this.emit("disconnected");
            this._clearPending(new Error("デザイナーが切断されました"));
          }
        }
      });

      ws.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EPIPE") return;
        logWarn("ws-bridge", "WebSocket error", { error: err.message, code: err.code });
      });
    });

    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      logError("ws-bridge", "Server runtime error", { error: err.message, code: err.code });
    });
  }

  /** 特定クライアントへイベントを送信 */
  sendToClient(clientId: string, event: string, data: unknown): void {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "broadcast", event, data }), (err) => {
        if (!err || isEpipe(err)) return;
        const sendErr = err as NodeJS.ErrnoException;
        logWarn("ws-bridge", "sendToClient failed", {
          clientId,
          event,
          error: sendErr.message,
          code: sendErr.code,
        });
      });
    } catch (e) {
      if (isEpipe(e)) return;
      logWarn("ws-bridge", "sendToClient failed", {
        clientId,
        event,
        error: e instanceof Error ? e.message : String(e),
        code: e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined,
      });
    }
  }

  /**
   * ブロードキャスト (#700 R-2 D-4 — 旧シグネチャ完全削除)
   *
   * 新シグネチャ: `broadcast({ wsId, event, data, excludeClientId? })`
   * - wsId が指定された場合: 該当 wsId の active workspace を持つ session のみに配信
   * - wsId が null の場合: 全 session に配信 (MCP tool からの一斉通知)
   *
   * LEGACY の文字列直渡し `broadcast(event, data)` は #700 R-2 で完全削除。
   */
  broadcast(opts: { wsId: string | null; event: string; data: unknown; excludeClientId?: string }): void {
    const { event, data, excludeClientId, wsId } = opts;
    const msg = JSON.stringify({ type: "broadcast", event, data });

    // wsId が指定された場合: 同 path の active session のみに配信 (#703 R-5 A-3)
    let targetClientIds: Iterable<string>;
    if (wsId === null) {
      // null = 全 session に配信 (extensions.changed 等ワークスペース横断の通知)
      targetClientIds = this.clients.keys();
    } else {
      // wsId(path) 指定 = 同 path を active として持つ session のみ
      targetClientIds = workspaceContextManager.getClientIdsByPath(wsId);
    }

    for (const id of targetClientIds) {
      if (id === excludeClientId) continue;
      const ws = this.clients.get(id);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(msg, (err) => {
          if (!err || isEpipe(err)) return;
          const sendErr = err as NodeJS.ErrnoException;
          logWarn("ws-bridge", "broadcast failed", {
            clientId: id,
            event,
            error: sendErr.message,
            code: sendErr.code,
          });
        });
      } catch (e) {
        if (isEpipe(e)) continue;
        logWarn("ws-bridge", "broadcast failed", {
          clientId: id,
          event,
          error: e instanceof Error ? e.message : String(e),
          code: e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined,
        });
      }
    }
  }

  /**
   * ブラウザからのファイル操作リクエストを処理。
   *
   * #1144 Phase-2: 64 RPC method の機能領域別 case body は `wsHandlers/*.ts` に分離済。
   * 本メソッドは Map<method, handler> lookup と共通エラーハンドリングのみを担う。
   */
  private async _handleBrowserRequest(
    ws: WebSocket,
    clientId: string,
    req: BrowserRequest,
  ): Promise<void> {
    const { id, method, params } = req;

    const respond = (result: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "response", id, result }));
      }
    };
    const respondError = (error: string): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "response", id, error }));
      }
    };

    // per-session root の lazy getter (#700 R-2)
    // workspace 操作系メソッド (workspace.open 等) は root 不要なので早期解決しない。
    // storage 関数を呼ぶ箇所でのみ root() を呼ぶ。WorkspaceUnsetError は最外層 catch でハンドル。
    const root = (): string => resolveRoot(clientId);
    // per-session broadcast wsId getter (#703 R-5 A-1)
    // 各 broadcast は actor の active path を wsId として渡す (同 workspace の session のみ受信)。
    // workspace 操作中に active が変わる可能性を避けるため lazy 評価する。
    const wsId = (): string | null => workspaceContextManager.getActivePath(clientId);

    try {
      const handler = rpcHandlerMap.get(method);
      if (handler) {
        const ctx: RpcContext = {
          params,
          clientId,
          root,
          wsId,
          respond,
          respondError,
          bridge: this,
        };
        await handler(ctx);
        return;
      }
      // 動的に登録されたハンドラ (#750 follow-up: client.log.flush 等)
      const dynHandler = this._browserHandlers.get(method);
      if (dynHandler) {
        const result = await dynHandler(params, { clientId });
        respond(result);
        return;
      }
      respondError(`未知のリクエストメソッド: ${method}`);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  }

  /** 動的にブラウザリクエストハンドラを登録する (#750 follow-up: client.log.flush 等)。 */
  private _browserHandlers = new Map<
    string,
    (params: unknown, ctx: { clientId: string }) => Promise<unknown> | unknown
  >();
  registerBrowserHandler(
    method: string,
    handler: (params: unknown, ctx: { clientId: string }) => Promise<unknown> | unknown,
  ): void {
    this._browserHandlers.set(method, handler);
  }

  /**
   * sendCommand のラッパー。ブラウザ未接続・エラー時は null を返す (browser-first fallback 用)。
   */
  async tryCommand(method: string, params?: unknown): Promise<unknown | null> {
    try {
      return await this.sendCommand(method, params);
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        logWarn("ws-bridge", "tryCommand failed, falling back to file", {
          method,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return null;
    }
  }

  /** MCP コマンドをアクティブクライアントへ送信 */
  async sendCommand(method: string, params?: unknown): Promise<unknown> {
    const ws = this.activeClient;
    if (!ws) {
      throw new Error(
        "デザイナーがブラウザで開かれていません。http://localhost:5173 を開いてください",
      );
    }

    const id = randomUUID();
    const command: Command = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`タイムアウト: ${method} が ${TIMEOUT_MS}ms 以内に応答しませんでした`),
        );
      }, TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(command));
    });
  }

  private _clearPending(err: Error): void {
    for (const [id, handler] of this.pending.entries()) {
      clearTimeout(handler.timer);
      handler.reject(err);
      this.pending.delete(id);
    }
  }
}

export const wsBridge = new WsBridge();
