import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  createDraft,
  readDraft,
  updateDraft,
  commitDraft,
  discardDraft,
  hasDraft,
  listDrafts,
  type DraftResourceType,
} from "./draftStore.js";
import {
  acquire as lockAcquire,
  release as lockRelease,
  forceRelease as lockForceRelease,
  getLock,
  listLocks,
  LockConflictError,
  LockNotHeldError,
} from "./lockManager.js";
import { execSync } from "child_process";
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { renameScreenItemId, checkScreenItemRefs } from "./renameScreenItem.js";
import {
  isLockdown as isWorkspaceLockdown,
  getLockdownPath as getWorkspaceLockdownPath,
  LockdownError as WorkspaceLockdownError,
  workspaceContextManager,
} from "./workspaceState.js";
import {
  listWorkspaces as listWorkspacesEntries,
  upsertWorkspace as upsertWorkspaceEntry,
  removeWorkspace as removeWorkspaceEntry,
  findById as findWorkspaceById,
  findByPath as findWorkspaceByPath,
  setLastActive as setLastActiveWorkspace,
} from "./recentStore.js";
import {
  inspectWorkspacePath,
  initializeWorkspace as initializeWorkspaceFolder,
} from "./workspaceInit.js";
import {
  readProject,
  writeProject,
  readScreen,
  writeScreen,
  readScreenEntity,
  writeScreenEntity,
  deleteScreen as deleteScreenFile,
  readCustomBlocks,
  writeCustomBlocks,
  readPuckComponents,
  writePuckComponents,
  readPuckData,
  writePuckData,
  readTable,
  writeTable,
  deleteTable as deleteTableFile,
  listAllTables,
  readErLayout,
  writeErLayout,
  readScreenLayout,
  writeScreenLayout,
  readProcessFlow,
  writeProcessFlow,
  deleteProcessFlow as deleteProcessFlowFile,
  listProcessFlows as listProcessFlowFiles,
  readConventions,
  writeConventions,
  readScreenItems,
  writeScreenItems,
  deleteScreenItems,
  readSequence,
  writeSequence,
  deleteSequence as deleteSequenceFile,
  readView,
  writeView,
  deleteView as deleteViewFile,
  listAllViews,
  readViewDefinition,
  writeViewDefinition,
  deleteViewDefinition as deleteViewDefinitionFile,
  listAllViewDefinitions,
  getFileMtime,
  readExtensionsBundle,
  writeExtensionsFile,
  resolveRoot,
} from "./projectStorage.js";

type Command = { id: string; method: string; params?: unknown };
type Response = { id: string; result?: unknown; error?: string };
type BrowserRequest = { type: "request"; id: string; method: string; params?: unknown };

// Port は env var で上書き可能 (テスト用に任意 port を使う想定)。未指定なら 5179 (#302)
const WS_PORT = parseInt(process.env.DESIGNER_MCP_PORT ?? "5179", 10);
const TIMEOUT_MS = 10000;

/** ポートを占有している古い designer-mcp プロセスを強制終了 */
function killStaleProcessOnPort(port: number): boolean {
  try {
    const output = execSync(`netstat -ano -p tcp`, { encoding: "utf8", windowsHide: true });
    const lines = output.split(/\r?\n/);
    const ownPid = process.pid;
    const pids = new Set<number>();

    for (const line of lines) {
      if (!/LISTENING/.test(line)) continue;
      // 127.0.0.1 / 0.0.0.0 / [::] いずれの bind でも検出 (#302 対応で HTTP サーバは 0.0.0.0 bind)
      const match = line.match(/(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (!match) continue;
      if (parseInt(match[1], 10) !== port) continue;
      const pid = parseInt(match[2], 10);
      if (pid !== ownPid) pids.add(pid);
    }

    if (pids.size === 0) return false;

    for (const pid of pids) {
      console.error(`[WsBridge] Killing stale process PID=${pid} on port ${port}`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
      } catch (e) {
        console.error(`[WsBridge] Failed to kill PID=${pid}:`, e);
      }
    }
    return true;
  } catch (e) {
    console.error("[WsBridge] killStaleProcessOnPort error:", e);
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP request handler (index.ts が MCP endpoint 等を register するために使用) */
type HttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

class WsBridge extends EventEmitter {
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
  }

  private async _bind(retries = 3): Promise<void> {
    return new Promise((resolve, reject) => {
      // HTTP サーバに WS をアタッチ (同一 port で HTTP + WS を提供 — #302)
      const httpServer = createServer((req, res) => this._handleHttp(req, res));
      const wss = new WebSocketServer({ server: httpServer });

      const onError = async (err: NodeJS.ErrnoException) => {
        httpServer.off("listening", onListening);
        if (err.code === "EADDRINUSE" && retries > 0) {
          console.error(`[WsBridge] Port ${WS_PORT} busy, retrying (${retries} left)...`);
          killStaleProcessOnPort(WS_PORT);
          await delay(500);
          try {
            await this._bind(retries - 1);
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          console.error("[WsBridge] Failed to bind:", err);
          reject(err);
        }
      };

      const onListening = () => {
        httpServer.off("error", onError);
        this.httpServer = httpServer;
        this.wss = wss;
        console.error(`[WsBridge] HTTP + WebSocket listening on 0.0.0.0:${WS_PORT} (ws:// and http://)`);
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
    for (const route of this.httpRoutes) {
      if (url === route.pathPrefix || url.startsWith(route.pathPrefix + "/") || url.startsWith(route.pathPrefix + "?")) {
        try {
          await route.handler(req, res);
        } catch (e) {
          console.error(`[WsBridge] HTTP handler error (${route.pathPrefix}):`, e);
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
        service: "designer-mcp",
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

    this.wss.on("connection", (ws: WebSocket) => {
      // 登録前は一時 ID で管理
      let clientId = `temp-${randomUUID()}`;
      this.clients.set(clientId, ws);
      this.clientOrder.push(clientId);
      // per-session context を作成 (#700 R-2)
      workspaceContextManager.connect(clientId);
      console.error(`[WsBridge] New connection (${clientId.substring(0, 12)}..., total: ${this.clients.size})`);
      if (this.clients.size === 1) this.emit("connected");

      ws.on("message", (data: Buffer) => {
        this.lastMessageAt = Date.now();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch (e) {
          console.error("[WsBridge] Failed to parse message:", e);
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
          console.error(`[WsBridge] Client registered: ${clientId.substring(0, 8)}... (total: ${this.clients.size})`);
          return;
        }

        // ── request: ブラウザからのファイル操作リクエスト ──
        if (msg.type === "request") {
          const req = msg as unknown as BrowserRequest;
          this._handleBrowserRequest(ws, clientId, req).catch((e) => {
            console.error("[WsBridge] Browser request error:", e);
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
          // per-session context を削除 (#700 R-2)
          workspaceContextManager.disconnect(clientId);
          console.error(`[WsBridge] Client disconnected: ${clientId.substring(0, 8)}... (remaining: ${this.clients.size})`);
          if (this.clients.size === 0) {
            this.emit("disconnected");
            this._clearPending(new Error("デザイナーが切断されました"));
          }
        }
      });

      ws.on("error", (err) => {
        console.error("[WsBridge] WebSocket error:", err);
      });
    });

    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      console.error("[WsBridge] Server runtime error:", err);
    });
  }

  /** 特定クライアントへイベントを送信 */
  sendToClient(clientId: string, event: string, data: unknown): void {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "broadcast", event, data }));
    } catch { /* ignore */ }
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
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  /** ブラウザからのファイル操作リクエストを処理 */
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
      switch (method) {
        case "loadProject": {
          const project = await readProject(root());
          respond(project);
          break;
        }
        case "saveProject": {
          const { project } = (params ?? {}) as { project: unknown };
          await writeProject(project, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadScreen": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const data = await readScreen(screenId, root());
          respond(data);
          break;
        }
        case "saveScreen": {
          const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
          await writeScreen(screenId, data, root());
          // 初回デザイン保存時に project の hasDesign フラグを更新
          try {
            const project = await readProject(root()) as { screens?: Array<{ id: string; hasDesign?: boolean; updatedAt?: string }>; updatedAt?: string } | null;
            if (project?.screens) {
              const screen = project.screens.find((s) => s.id === screenId);
              if (screen && !screen.hasDesign) {
                screen.hasDesign = true;
                screen.updatedAt = new Date().toISOString();
                project.updatedAt = new Date().toISOString();
                await writeProject(project, root());
                this.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
              }
            }
          } catch (e) {
            console.error("[WsBridge] Failed to update hasDesign:", e);
          }
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "loadScreenEntity": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const data = await readScreenEntity(screenId, root());
          respond(data);
          break;
        }
        case "saveScreenEntity": {
          const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
          await writeScreenEntity(screenId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenEntityChanged", data: { screenId }, excludeClientId: clientId });
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "deleteScreen": {
          const { screenId } = (params ?? {}) as { screenId: string };
          await deleteScreenFile(screenId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadCustomBlocks": {
          const blocks = await readCustomBlocks(root());
          respond(blocks);
          break;
        }
        case "saveCustomBlocks": {
          const { blocks } = (params ?? {}) as { blocks: unknown[] };
          await writeCustomBlocks(blocks, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "customBlocksChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadPuckComponents": {
          const components = await readPuckComponents(root());
          respond(components);
          break;
        }
        case "savePuckComponents": {
          const { components } = (params ?? {}) as { components: unknown[] };
          await writePuckComponents(components, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "puckComponentsChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadPuckData": {
          // #806: Puck Data を screens/<id>/puck-data.json から読み込み
          const { screenId } = (params ?? {}) as { screenId: string };
          const puckData = await readPuckData(screenId, root());
          respond(puckData);
          break;
        }
        case "savePuckData": {
          // #806: Puck Data を screens/<id>/puck-data.json に書き込み
          const { screenId, data: puckDataPayload } = (params ?? {}) as { screenId: string; data: unknown };
          await writePuckData(screenId, puckDataPayload, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "puckDataChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "loadTable": {
          const { tableId } = (params ?? {}) as { tableId: string };
          const tableData = await readTable(tableId, root());
          respond(tableData);
          break;
        }
        case "saveTable": {
          const { tableId, data } = (params ?? {}) as { tableId: string; data: unknown };
          await writeTable(tableId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "tableChanged", data: { tableId }, excludeClientId: clientId });
          break;
        }
        case "deleteTable": {
          const { tableId } = (params ?? {}) as { tableId: string };
          await deleteTableFile(tableId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "tableChanged", data: { tableId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "listAllTables": {
          const tablesData = await listAllTables(root());
          respond(tablesData);
          break;
        }
        case "loadErLayout": {
          const layoutData = await readErLayout(root());
          respond(layoutData);
          break;
        }
        case "saveErLayout": {
          const { data } = (params ?? {}) as { data: unknown };
          await writeErLayout(data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "erLayoutChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadScreenLayout": {
          const layoutData = await readScreenLayout(root());
          respond(layoutData);
          break;
        }
        case "saveScreenLayout": {
          const { data } = (params ?? {}) as { data: unknown };
          await writeScreenLayout(data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenLayoutChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadProcessFlow": {
          const { id: agId } = (params ?? {}) as { id: string };
          const agData = await readProcessFlow(agId, root());
          respond(agData);
          break;
        }
        case "saveProcessFlow": {
          const { id: agId, data: agData } = (params ?? {}) as { id: string; data: unknown };
          await writeProcessFlow(agId, agData, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId }, excludeClientId: clientId });
          break;
        }
        case "deleteProcessFlow": {
          const { id: agId } = (params ?? {}) as { id: string };
          await deleteProcessFlowFile(agId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "listProcessFlows": {
          const agList = await listProcessFlowFiles(root());
          const metas = (agList as Array<{ id: string; name: string; type: string; screenId?: string; actions?: unknown[]; updatedAt: string }>).map((ag) => ({
            id: ag.id,
            name: ag.name,
            type: ag.type,
            screenId: ag.screenId,
            actionCount: ag.actions?.length ?? 0,
            updatedAt: ag.updatedAt,
          }));
          respond(metas);
          break;
        }
        case "listAllViews": {
          const viewsData = await listAllViews(root());
          respond(viewsData);
          break;
        }
        case "listAllViewDefinitions": {
          const viewDefinitionsData = await listAllViewDefinitions(root());
          respond(viewDefinitionsData);
          break;
        }
        case "loadConventions": {
          const catalog = await readConventions(root());
          respond(catalog);
          break;
        }
        case "saveConventions": {
          const { catalog } = (params ?? {}) as { catalog: unknown };
          await writeConventions(catalog, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "conventionsChanged", data: {}, excludeClientId: clientId });
          break;
        }
        case "loadScreenItems": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const items = await readScreenItems(screenId, root());
          respond(items);
          break;
        }
        case "saveScreenItems": {
          const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
          await writeScreenItems(screenId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
          break;
        }
        case "deleteScreenItems": {
          const { screenId } = (params ?? {}) as { screenId: string };
          await deleteScreenItems(screenId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadSequence": {
          const { sequenceId } = (params ?? {}) as { sequenceId: string };
          const seqData = await readSequence(sequenceId, root());
          respond(seqData);
          break;
        }
        case "saveSequence": {
          const { sequenceId, data } = (params ?? {}) as { sequenceId: string; data: unknown };
          await writeSequence(sequenceId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId }, excludeClientId: clientId });
          break;
        }
        case "deleteSequence": {
          const { sequenceId } = (params ?? {}) as { sequenceId: string };
          await deleteSequenceFile(sequenceId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "sequenceChanged", data: { sequenceId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadView": {
          const { viewId } = (params ?? {}) as { viewId: string };
          const data = await readView(viewId, root());
          respond(data);
          break;
        }
        case "saveView": {
          const { viewId, data } = (params ?? {}) as { viewId: string; data: unknown };
          await writeView(viewId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId }, excludeClientId: clientId });
          break;
        }
        case "deleteView": {
          const { viewId } = (params ?? {}) as { viewId: string };
          await deleteViewFile(viewId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewChanged", data: { viewId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "loadViewDefinition": {
          const { viewDefinitionId } = (params ?? {}) as { viewDefinitionId: string };
          const data = await readViewDefinition(viewDefinitionId, root());
          respond(data);
          break;
        }
        case "saveViewDefinition": {
          const { viewDefinitionId, data } = (params ?? {}) as { viewDefinitionId: string; data: unknown };
          await writeViewDefinition(viewDefinitionId, data, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId }, excludeClientId: clientId });
          break;
        }
        case "deleteViewDefinition": {
          const { viewDefinitionId } = (params ?? {}) as { viewDefinitionId: string };
          await deleteViewDefinitionFile(viewDefinitionId, root());
          respond({ success: true });
          this.broadcast({ wsId: wsId(), event: "viewDefinitionChanged", data: { viewDefinitionId, deleted: true }, excludeClientId: clientId });
          break;
        }
        case "getFileMtime": {
          const { kind, id: fid } = (params ?? {}) as { kind: string; id?: string };
          const mtime = await getFileMtime(kind, root(), fid);
          respond({ mtime });
          break;
        }
        case "getExtensions": {
          const bundle = await readExtensionsBundle(root());
          respond(bundle);
          break;
        }
        case "saveExtensionPackage": {
          const { type, content } = (params ?? {}) as { type: string; content: unknown };
          if (!["steps", "fieldTypes", "triggers", "dbOperations", "responseTypes"].includes(type)) {
            respondError(`不明な拡張種別です: ${type}`);
            break;
          }
          try {
            await writeExtensionsFile(
              type as "steps" | "fieldTypes" | "triggers" | "dbOperations" | "responseTypes",
              content,
              root(),
              { onAfterWrite: () => this.broadcast({ wsId: root(), event: "extensionsChanged", data: { type }, excludeClientId: clientId }) },
            );
            respond({ success: true });
          } catch (e) {
            respondError(e instanceof Error ? e.message : String(e));
          }
          break;
        }
        case "renameScreenItem": {
          const { screenId, oldId, newId } = (params ?? {}) as {
            screenId: string; oldId: string; newId: string;
          };
          const result = await renameScreenItemId(screenId, oldId, newId, root());
          respond(result);
          this.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
          for (const agId of result.processFlowsUpdated) {
            this.broadcast({ wsId: wsId(), event: "processFlowChanged", data: { id: agId }, excludeClientId: clientId });
          }
          if (result.screenHtmlUpdated) {
            this.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId }, excludeClientId: clientId });
          }
          break;
        }
        case "checkScreenItemRefs": {
          const { screenId, itemId } = (params ?? {}) as { screenId: string; itemId: string };
          const result = await checkScreenItemRefs(screenId, itemId, root());
          respond(result);
          break;
        }

        // ── ワークスペース管理 (#671/#672/#673) ─────────────────────────
        case "workspace.list": {
          const { workspaces, lastActiveId } = await listWorkspacesEntries();
          const activePath = workspaceContextManager.getActivePath(clientId);
          respond({
            workspaces,
            lastActiveId,
            active: activePath
              ? { path: activePath, name: (workspaces.find((w) => w.path === activePath)?.name ?? null) }
              : null,
            lockdown: isWorkspaceLockdown(),
            lockdownPath: getWorkspaceLockdownPath(),
          });
          break;
        }
        case "workspace.status": {
          // per-session active path (#700 R-2)
          const activePath = workspaceContextManager.getActivePath(clientId);
          let activeName: string | null = null;
          if (activePath) {
            const entry = await findWorkspaceByPath(activePath);
            activeName = entry?.name ?? null;
          }
          respond({
            active: activePath ? { path: activePath, name: activeName } : null,
            lockdown: isWorkspaceLockdown(),
            lockdownPath: getWorkspaceLockdownPath(),
          });
          break;
        }
        case "workspace.inspect": {
          const { path: targetPath } = (params ?? {}) as { path?: string };
          if (typeof targetPath !== "string") {
            respondError("path は必須です");
            break;
          }
          const r = await inspectWorkspacePath(targetPath);
          respond(r);
          break;
        }
        case "workspace.open": {
          const { path: targetPath, id, init } = (params ?? {}) as { path?: string; id?: string; init?: boolean };
          if (typeof targetPath !== "string" && typeof id !== "string") {
            respondError("path または id のいずれかが必要です");
            break;
          }
          const initFlag = init === true;
          if (initFlag && typeof targetPath !== "string") {
            respondError("init=true の場合は path が必須です");
            break;
          }
          let resolved = typeof targetPath === "string" ? targetPath : null;
          if (!resolved && typeof id === "string") {
            const entry = await findWorkspaceById(id);
            if (!entry) { respondError(`id ${id} のワークスペースが見つかりません`); break; }
            resolved = entry.path;
          }
          if (!resolved) { respondError("path 解決に失敗しました"); break; }
          let initName: string | null = null;
          if (initFlag) {
            if (isWorkspaceLockdown()) { respondError("lockdown モード中は新規ワークスペース初期化はできません"); break; }
            try {
              const initRes = await initializeWorkspaceFolder(resolved);
              initName = initRes.name;
              resolved = initRes.path;
            } catch (e) {
              respondError(`ワークスペース初期化失敗: ${e instanceof Error ? e.message : String(e)}`);
              break;
            }
          } else {
            // init=false 時: stale recent エントリ / typo パスを active 化して fs を破壊しないよう、
            // open 前に inspect で ready 状態を確認する (見つからない / project.json 無しは reject)
            const inspect = await inspectWorkspacePath(resolved);
            if (inspect.status !== "ready") {
              respondError(
                inspect.status === "notFound"
                  ? `フォルダが見つかりません: ${resolved}`
                  : `ワークスペースが初期化されていません (project.json が見つかりません): ${resolved}。init=true で初期化してください。`,
              );
              break;
            }
          }
          try {
            // per-session context を更新 (#700 R-2)
            workspaceContextManager.setActivePath(clientId, resolved);
          } catch (e) {
            if (e instanceof WorkspaceLockdownError) { respondError(e.message); break; }
            throw e;
          }
          let name = initName ?? resolved.split(/[\\/]/).pop() ?? "";
          try {
            const proj = await readProject(resolved);
            if (proj && typeof proj === "object" && proj !== null) {
              const meta = (proj as Record<string, unknown>).meta;
              if (meta && typeof meta === "object" && meta !== null) {
                const n = (meta as Record<string, unknown>).name;
                if (typeof n === "string" && n.trim().length > 0) name = n;
              }
            }
          } catch { /* fallback */ }
          const entry = await upsertWorkspaceEntry(resolved, name);
          await setLastActiveWorkspace(entry.id);
          respond({ active: { id: entry.id, path: entry.path, name: entry.name } });
          // workspace.open broadcast: 同 path を active にしている session のみ受信 (#703 R-5 A-2)
          this.broadcast({ wsId: entry.path, event: "workspace.changed", data: {
            activeId: entry.id,
            path: entry.path,
            name: entry.name,
            lockdown: isWorkspaceLockdown(),
          }, excludeClientId: clientId });
          break;
        }
        case "workspace.close": {
          // close 前に現在の path をキャプチャしておく (close 後は getActivePath が null になるため)
          const closingPath = workspaceContextManager.getActivePath(clientId);
          try {
            // per-session context を更新 (#700 R-2)
            workspaceContextManager.clearActive(clientId);
          } catch (e) {
            if (e instanceof WorkspaceLockdownError) { respondError(e.message); break; }
            throw e;
          }
          await setLastActiveWorkspace(null);
          respond({ success: true });
          // workspace.close broadcast: close 前のパスを持つ session のみ受信 (#703 R-5 A-2)
          this.broadcast({ wsId: closingPath, event: "workspace.changed", data: {
            activeId: null, path: null, name: null, lockdown: isWorkspaceLockdown(),
          }, excludeClientId: clientId });
          break;
        }
        case "workspace.remove": {
          if (isWorkspaceLockdown()) { respondError("lockdown モード中はワークスペースを除外できません"); break; }
          const { id } = (params ?? {}) as { id?: string };
          if (typeof id !== "string") { respondError("id は必須です"); break; }
          const removed = await removeWorkspaceEntry(id);
          respond({ removed });
          break;
        }

        // ── draft 管理 (#685) ─────────────────────────────────────────
        case "draft.read": {
          const { type: dt, id: did } = (params ?? {}) as { type: DraftResourceType; id: string };
          const payload = await readDraft(clientId, dt, did);
          respond({ payload, exists: payload !== null });
          break;
        }
        case "draft.update": {
          const { type: dt, id: did, payload: dp } = (params ?? {}) as { type: DraftResourceType; id: string; payload: unknown };
          await updateDraft(clientId, dt, did, dp);
          respond({ updated: true });
          this.broadcast({ wsId: wsId(), event: "draft.changed", data: { type: dt, id: did, op: "updated" }, excludeClientId: clientId });
          break;
        }
        case "draft.commit": {
          const { type: dt, id: did } = (params ?? {}) as { type: DraftResourceType; id: string };
          const r = await commitDraft(clientId, dt, did);
          respond(r);
          if (r.committed) {
            this.broadcast({ wsId: wsId(), event: "draft.changed", data: { type: dt, id: did, op: "committed" }, excludeClientId: clientId });
            // #806 A-M-1: puck-data commit 時は puckDataChanged も broadcast して cross-tab 上書き保護を機能させる。
            // Designer.tsx は "puckDataChanged" event を購読しているため、draft.changed とは別に emit が必要。
            if (dt === "puck-data") {
              this.broadcast({ wsId: wsId(), event: "puckDataChanged", data: { screenId: did }, excludeClientId: clientId });
            }
          }
          break;
        }
        case "draft.discard": {
          const { type: dt, id: did } = (params ?? {}) as { type: DraftResourceType; id: string };
          const r = await discardDraft(clientId, dt, did);
          respond(r);
          if (r.discarded) {
            this.broadcast({ wsId: wsId(), event: "draft.changed", data: { type: dt, id: did, op: "discarded" }, excludeClientId: clientId });
          }
          break;
        }
        case "draft.has": {
          const { type: dt, id: did } = (params ?? {}) as { type: DraftResourceType; id: string };
          const exists = await hasDraft(clientId, dt, did);
          respond({ exists });
          break;
        }
        case "draft.list": {
          const drafts = await listDrafts(clientId);
          respond({ drafts });
          break;
        }
        case "draft.create": {
          const { type: dt, id: did } = (params ?? {}) as { type: DraftResourceType; id: string };
          const r = await createDraft(clientId, dt, did);
          respond(r);
          if (r.created) {
            this.broadcast({ wsId: wsId(), event: "draft.changed", data: { type: dt, id: did, op: "created" }, excludeClientId: clientId });
          }
          break;
        }

        // ── per-resource ロック管理 (#686) ─────────────────────────────
        case "lock.acquire": {
          const { resourceType: lrt, resourceId: lrid } = (params ?? {}) as { resourceType: DraftResourceType; resourceId: string };
          try {
            const entry = lockAcquire(lrt, lrid, clientId);
            respond({ entry });
            this.broadcast({ wsId: wsId(), event: "lock.changed", data: { resourceType: lrt, resourceId: lrid, op: "acquired", ownerSessionId: entry.ownerSessionId, by: clientId } });
          } catch (e) {
            if (e instanceof LockConflictError) {
              respondError(e.message);
            } else {
              throw e;
            }
          }
          break;
        }
        case "lock.release": {
          const { resourceType: lrt, resourceId: lrid } = (params ?? {}) as { resourceType: DraftResourceType; resourceId: string };
          try {
            const result = lockRelease(lrt, lrid, clientId);
            respond(result);
            this.broadcast({ wsId: wsId(), event: "lock.changed", data: { resourceType: lrt, resourceId: lrid, op: "released", ownerSessionId: clientId, by: clientId } });
          } catch (e) {
            if (e instanceof LockNotHeldError) {
              respondError(e.message);
            } else {
              throw e;
            }
          }
          break;
        }
        case "lock.forceRelease": {
          const { resourceType: lrt, resourceId: lrid } = (params ?? {}) as { resourceType: DraftResourceType; resourceId: string };
          const fr = lockForceRelease(lrt, lrid, clientId);
          respond(fr);
          this.broadcast({ wsId: wsId(), event: "lock.changed", data: { resourceType: lrt, resourceId: lrid, op: "force-released", ownerSessionId: fr.previousOwner, by: clientId, previousOwner: fr.previousOwner } });
          break;
        }
        case "lock.get": {
          const { resourceType: lrt, resourceId: lrid } = (params ?? {}) as { resourceType: DraftResourceType; resourceId: string };
          const entry = getLock(lrt, lrid);
          respond({ entry });
          break;
        }
        case "lock.list": {
          const locks = listLocks();
          respond({ locks });
          break;
        }

        default: {
          // 動的に登録されたハンドラ (#750 follow-up: client.log.flush 等)
          const dynHandler = this._browserHandlers.get(method);
          if (dynHandler) {
            const result = await dynHandler(params, { clientId });
            respond(result);
            break;
          }
          respondError(`未知のリクエストメソッド: ${method}`);
        }
      }
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
        console.error(`[WsBridge] tryCommand(${method}) failed, falling back to file:`, e);
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
