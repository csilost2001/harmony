import { generateUUID } from "../utils/uuid";
import { isValidEntityId } from "../utils/entityIdValidation";
import { uiInfo, uiWarn } from "../utils/uiLog";
import type { ScreenType, TransitionTrigger } from "../types/flow";
import {
  openTab,
  closeTab,
  setActiveTab,
  getTabs,
  getActiveTabId,
  makeTabId,
  setDirty,
} from "../store/tabStore";
import {
  loadProject,
  addScreen,
  updateScreen,
  updateScreenThumbnail,
  removeScreen,
  addEdge,
  removeEdge,
  generateMermaid,
  setFlowStorageBackend,
  type FlowStorageBackend,
} from "../store/flowStore";
import {
  setTableStorageBackend,
  type TableStorageBackend,
} from "../store/tableStore";
import {
  setErLayoutStorageBackend,
  type ErLayoutStorageBackend,
} from "../store/erLayoutStore";
import {
  setScreenFlowPositionsStorageBackend,
  type ScreenFlowPositionsStorageBackend,
} from "../store/screenFlowPositionsStore";
import {
  setProcessFlowStorageBackend,
  type ProcessFlowStorageBackend,
} from "../store/processFlowStore";
import {
  setConventionsStorageBackend,
  type ConventionsStorageBackend,
} from "../store/conventionsStore";
import {
  setScreenStorageBackend,
  buildDefaultScreen,
  saveScreenEntity,
  type ScreenStorageBackend,
} from "../store/screenStore";
import { loadTable } from "../store/tableStore";
import {
  setSequenceStorageBackend,
  type SequenceStorageBackend,
} from "../store/sequenceStore";
import {
  setViewStorageBackend,
  type ViewStorageBackend,
} from "../store/viewStore";
import {
  setViewDefinitionStorageBackend,
  type ViewDefinitionStorageBackend,
} from "../store/viewDefinitionStore";
import {
  setPageLayoutStorageBackend,
  type PageLayoutStorageBackend,
} from "../store/pageLayoutStore";
import {
  setGenericDefinitionStorageBackend,
  type GenericDefinitionStorageBackend,
} from "../store/genericDefinitionStore";
import type { GenericDefinitionKind } from "../types/v3";
import type { RawExtensionsBundle } from "../schemas/loadExtensions";
import { backendWebSocketUrl } from "./backendEndpoint";

export type McpStatus = "disconnected" | "connecting" | "connected" | "failed";
export type ThemeIdLike = "standard" | "card" | "compact" | "dark";

type StatusCallback = (s: McpStatus) => void;
type NavigateHandler = (path: string) => void;
type FlowChangeHandler = () => void;
type ExtensionsChangedHandler = () => void;
type BroadcastHandler = (data: unknown) => void;
type Command = { id: string; method: string; params?: unknown };
type Response = { id: string; result?: unknown; error?: string };

type ProcessFlowHandler = {
  get: () => unknown;
  mutate: (type: string, params: unknown) => void;
};

const WS_URL = backendWebSocketUrl();
const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

// HMR 対応: グローバルにインスタンスを保持
declare global {
  interface Window {
    __mcpBridge?: McpBridgeImpl;
  }
}

class McpBridgeImpl {
  private ws: WebSocket | null = null;
  private processFlowHandlers = new Map<string, ProcessFlowHandler>();
  private status: McpStatus = "disconnected";
  private statusCallbacks: Set<StatusCallback> = new Set();
  private navigateHandler: NavigateHandler | null = null;
  private flowChangeHandler: FlowChangeHandler | null = null;
  private extensionsCache: Promise<RawExtensionsBundle> | null = null;
  private extensionsChangedHandlers: Set<ExtensionsChangedHandler> = new Set();
  private broadcastHandlers = new Map<string, Set<BroadcastHandler>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** 接続試行カウンタ */
  private connectAttempts = 0;

  /**
   * ブラウザセッション固有の一意 ID。
   * - 再接続 (WS reconnect) でも不変
   * - 同一 tab 内の page reload / SPA hard navigation でも不変 (sessionStorage 永続化、#991)
   * - 別 tab を開いた場合は別 ID (sessionStorage は per-tab scope)
   * - tab close で消失 (presence cleanup の semantic と整合)
   *
   * sessionStorage 利用不可な環境 (Safari Private mode 等) では fallback で in-memory 生成。
   */
  private readonly clientId = (() => {
    try {
      const cached = sessionStorage.getItem("harmony-client-id");
      if (cached && cached.length > 0) return cached;
    } catch { /* sessionStorage 利用不可 (Private / SSR 等) → in-memory に fallback */ }
    const id = generateUUID();
    try { sessionStorage.setItem("harmony-client-id", id); } catch { /* fallback (上記と同じ) */ }
    return id;
  })();

  /** ブラウザ→サーバーリクエストの応答待ちハンドラ */
  private pendingRequests = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  getClientId(): string {
    return this.clientId;
  }

  // ── ハンドラ setter ────────────────────────────────────────────────────

  setProcessFlowHandler(id: string, handler: ProcessFlowHandler | null): void {
    if (handler) {
      this.processFlowHandlers.set(id, handler);
    } else {
      this.processFlowHandlers.delete(id);
    }
  }

  setNavigateHandler(handler: NavigateHandler | null): void {
    this.navigateHandler = handler;
  }

  setFlowChangeHandler(handler: FlowChangeHandler | null): void {
    this.flowChangeHandler = handler;
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.statusCallbacks.add(cb);
    cb(this.status);
    return () => this.statusCallbacks.delete(cb);
  }

  getStatus(): McpStatus {
    return this.status;
  }

  getConnectAttempts(): number {
    return this.connectAttempts;
  }

  /** ブロードキャストイベントのサブスクライブ */
  onBroadcast(event: string, handler: BroadcastHandler): () => void {
    if (!this.broadcastHandlers.has(event)) {
      this.broadcastHandlers.set(event, new Set());
    }
    this.broadcastHandlers.get(event)!.add(handler);
    return () => this.broadcastHandlers.get(event)?.delete(handler);
  }

  async getExtensions(forceReload = false): Promise<RawExtensionsBundle> {
    if (forceReload) {
      this.extensionsCache = null;
    }
    if (this.extensionsCache) {
      return this.extensionsCache;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return {};
    }
    this.extensionsCache = this.request("getExtensions")
      .then((result) => (isExtensionsBundle(result) ? result : {}))
      .catch(() => {
        this.extensionsCache = null;
        return {};
      });
    return this.extensionsCache;
  }

  onExtensionsChanged(handler: ExtensionsChangedHandler): () => void {
    this.extensionsChangedHandlers.add(handler);
    return () => this.extensionsChangedHandlers.delete(handler);
  }

  // ── 起動 / 停止 ───────────────────────────────────────────────────────

  /** WebSocket 接続のみ起動する (アプリ共通の起動口)。"failed" 状態からのリトライも可 */
  startWithoutEditor(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    // "failed" 状態のリトライ: 残っている接続試行中の ws を破棄してから再接続
    if (this.status === "failed") {
      if (this.ws) {
        try { this.ws.close(); } catch { /* ignore */ }
        this.ws = null;
      }
    } else if (this.status === "connecting") {
      return;
    }
    this.stopped = false;
    uiInfo("ws-broadcast", "mcpBridge starting...");
    this._connect();
  }

  /**
   * AppShell が接続タイムアウトを検出した際に呼び出す (#795-C)。
   * "connecting" → "failed" に遷移し、UI にエラー画面切替を通知する。
   * retry は startWithoutEditor() の再呼び出しで行う。
   */
  markFailed(): void {
    uiWarn("ws-broadcast", "mcpBridge marking as failed (connection timeout)");
    this._setStatus("failed");
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._setStatus("disconnected");
    uiInfo("ws-broadcast", "mcpBridge stopped");
  }

  // ── ブラウザ→サーバーリクエスト ──────────────────────────────────────

  /**
   * wsBridge へリクエストを送信し、サーバーファイル操作の結果を受け取る。
   * { type: "request", id, method, params } → { type: "response", id, result/error }
   */
  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("wsBridge に接続されていません"));
    }

    const id = generateUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`タイムアウト: ${method} (${REQUEST_TIMEOUT_MS}ms)`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: "request", id, method, params }));
    });
  }

  // ── 内部ユーティリティ ────────────────────────────────────────────────

  private _setStatus(s: McpStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusCallbacks.forEach((cb) => cb(s));
  }

  private _hasActiveConnection(): boolean {
    return this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING;
  }

  private _connect(): void {
    if (this.stopped) return;
    if (this._hasActiveConnection()) return;
    this.connectAttempts++;
    this._setStatus("connecting");
    uiInfo("ws-broadcast", `mcpBridge connecting to ${WS_URL} (attempt ${this.connectAttempts})`);

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.addEventListener("open", () => {
      uiInfo("ws-broadcast", "mcpBridge connected");
      // 登録メッセージを送信
      ws.send(JSON.stringify({ type: "register", clientId: this.clientId }));
      // ファイルストレージバックエンドを設定
      this._setStorageBackends();
      this._setStatus("connected");
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      this._handleMessage(event.data as string);
    });

    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      uiWarn("ws-broadcast", `mcpBridge disconnected, retrying in ${RETRY_DELAY_MS}ms`);
      // 切断中も store の backend 参照は残し、再接続まで request 失敗 → 上位 UI で loading
      // 表示を維持する。localStorage fallback は #923 シリーズで廃止 (spec D-8)。
      this._setStatus("disconnected");
      // 未解決リクエストを全てリジェクト
      for (const [id, handler] of this.pendingRequests.entries()) {
        clearTimeout(handler.timer);
        handler.reject(new Error("WebSocket が切断されました"));
        this.pendingRequests.delete(id);
      }
      if (!this.stopped) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this._connect();
        }, RETRY_DELAY_MS);
      }
    });

    ws.addEventListener("error", () => {
      uiWarn("ws-broadcast", "mcpBridge connection error");
    });
  }

  /** 接続時: flowStore と customBlockStore にリモートバックエンドをセット */
  private _setStorageBackends(): void {
    // arrow 関数内の this は lexical なので、enclosing method の this (インスタンス) をそのまま使う
    const flowBackend: FlowStorageBackend = {
      loadProject: () => this.request("loadProject"),
      saveProject: (project) => this.request("saveProject", { project }).then(() => undefined),
      deleteScreenData: (screenId) => this.request("deleteScreen", { screenId }).then(() => undefined),
    };
    setFlowStorageBackend(flowBackend);

    const tableBackend: TableStorageBackend = {
      loadTable: (tableId) => this.request("loadTable", { tableId }),
      listAllTables: () => this.request("listAllTables", {}) as Promise<unknown[]>,
      saveTable: (tableId, data) => this.request("saveTable", { tableId, data }).then(() => undefined),
      deleteTable: (tableId) => this.request("deleteTable", { tableId }).then(() => undefined),
    };
    setTableStorageBackend(tableBackend);

    const erLayoutBackend: ErLayoutStorageBackend = {
      loadErLayout: () => this.request("loadErLayout"),
      saveErLayout: (data) => this.request("saveErLayout", { data }).then(() => undefined),
    };
    setErLayoutStorageBackend(erLayoutBackend);

    const screenFlowPositionsBackend: ScreenFlowPositionsStorageBackend = {
      loadScreenFlowPositions: () => this.request("loadScreenFlowPositions"),
      saveScreenFlowPositions: (data) => this.request("saveScreenFlowPositions", { data }).then(() => undefined),
    };
    setScreenFlowPositionsStorageBackend(screenFlowPositionsBackend);

    const actionBackend: ProcessFlowStorageBackend = {
      loadProcessFlow: (processFlowId) => this.request("loadProcessFlow", { processFlowId }),
      saveProcessFlow: (processFlowId, data) => this.request("saveProcessFlow", { processFlowId, data }).then(() => undefined),
      deleteProcessFlow: (processFlowId) => this.request("deleteProcessFlow", { processFlowId }).then(() => undefined),
      listProcessFlows: () => this.request("listProcessFlows"),
    };
    setProcessFlowStorageBackend(actionBackend);

    const conventionsBackend: ConventionsStorageBackend = {
      loadConventions: () => this.request("loadConventions"),
      saveConventions: (catalog) => this.request("saveConventions", { catalog }).then(() => undefined),
    };
    setConventionsStorageBackend(conventionsBackend);

    const screenBackend: ScreenStorageBackend = {
      loadScreenEntity: (screenId) => this.request("loadScreenEntity", { screenId }),
      saveScreenEntity: (screenId, data) => this.request("saveScreenEntity", { screenId, data }).then(() => undefined),
    };
    setScreenStorageBackend(screenBackend);

    const sequenceBackend: SequenceStorageBackend = {
      loadSequence: (sequenceId) => this.request("loadSequence", { sequenceId }),
      saveSequence: (sequenceId, data) => this.request("saveSequence", { sequenceId, data }).then(() => undefined),
      deleteSequence: (sequenceId) => this.request("deleteSequence", { sequenceId }).then(() => undefined),
    };
    setSequenceStorageBackend(sequenceBackend);

    const viewBackend: ViewStorageBackend = {
      loadView: (viewId) => this.request("loadView", { viewId }),
      listAllViews: () => this.request("listAllViews", {}) as Promise<unknown[]>,
      saveView: (viewId, data) => this.request("saveView", { viewId, data }).then(() => undefined),
      deleteView: (viewId) => this.request("deleteView", { viewId }).then(() => undefined),
    };
    setViewStorageBackend(viewBackend);

    const viewDefinitionBackend: ViewDefinitionStorageBackend = {
      loadViewDefinition: (viewDefinitionId) => this.request("loadViewDefinition", { viewDefinitionId }),
      listAllViewDefinitions: () => this.request("listAllViewDefinitions", {}) as Promise<unknown[]>,
      saveViewDefinition: (viewDefinitionId, data) => this.request("saveViewDefinition", { viewDefinitionId, data }).then(() => undefined),
      deleteViewDefinition: (viewDefinitionId) => this.request("deleteViewDefinition", { viewDefinitionId }).then(() => undefined),
    };
    setViewDefinitionStorageBackend(viewDefinitionBackend);

    const pageLayoutBackend: PageLayoutStorageBackend = {
      loadPageLayout: (pageLayoutId) => this.request("loadPageLayout", { pageLayoutId }),
      listAllPageLayouts: () => this.request("listAllPageLayouts", {}) as Promise<unknown[]>,
      savePageLayout: (pageLayoutId, data) => this.request("savePageLayout", { pageLayoutId, data }).then(() => undefined),
      deletePageLayout: (pageLayoutId) => this.request("deletePageLayout", { pageLayoutId }).then(() => undefined),
    };
    setPageLayoutStorageBackend(pageLayoutBackend);

    const genericDefinitionBackend: GenericDefinitionStorageBackend = {
      listAll: (kind: GenericDefinitionKind) => this.request("listAllGenericDefinitions", { kind }) as Promise<unknown[]>,
      load: (kind: GenericDefinitionKind, name: string) => this.request("loadGenericDefinition", { kind, name }),
      save: (kind: GenericDefinitionKind, name: string, data: unknown) => this.request("saveGenericDefinition", { kind, name, data }).then(() => undefined),
      delete: (kind: GenericDefinitionKind, name: string) => this.request("deleteGenericDefinition", { kind, name }).then(() => undefined),
    };
    setGenericDefinitionStorageBackend(genericDefinitionBackend);
  }

  // ── メッセージ受信 ─────────────────────────────────────────────────────

  private _handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      console.error("[mcpBridge] failed to parse message:", data);
      return;
    }

    // ── ブラウザリクエストへのサーバー応答 ──
    if (msg.type === "response") {
      const res = msg as unknown as { type: "response"; id: string; result?: unknown; error?: string };
      const handler = this.pendingRequests.get(res.id);
      if (handler) {
        clearTimeout(handler.timer);
        this.pendingRequests.delete(res.id);
        if (res.error) {
          handler.reject(new Error(res.error));
        } else {
          handler.resolve(res.result);
        }
      }
      return;
    }

    // ── サーバーからのブロードキャスト ──
    if (msg.type === "broadcast") {
      const event = msg.event as string;
      const broadcastData = msg.data;
      // S-18 (#1147): production console 煩雑化回避のため DEV のみ出力。
      // migration 通知 / 接続 lifecycle は production 保持。
      if (import.meta.env.DEV) console.log("[mcpBridge] broadcast:", event, broadcastData);
      if (event === "extensionsChanged") {
        this.extensionsCache = null;
        this.extensionsChangedHandlers.forEach((handler) => handler());
      }
      const handlers = this.broadcastHandlers.get(event);
      if (handlers) {
        handlers.forEach((h) => h(broadcastData));
      }
      return;
    }

    // ── MCP コマンド（サーバー→ブラウザ） ──
    this._dispatch(msg as unknown as Command);
  }

  // ── MCP コマンドディスパッチ ──────────────────────────────────────────

  private _dispatch(cmd: Command): void {
    this._dispatchAsync(cmd).catch((e) => {
      console.error("[mcpBridge] unhandled dispatch error:", e);
    });
  }

  private async _dispatchAsync(cmd: Command): Promise<void> {
    const { id, method, params } = cmd;

    const respond = (result: unknown): void => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id, result } satisfies Response));
      }
    };

    const respondError = (error: string): void => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ id, error } satisfies Response));
      }
    };

    try {
      switch (method) {
        case "listScreens": {
          const project = await loadProject();
          const screens = project.screens.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            path: s.path,
            hasDesign: s.hasDesign,
          }));
          respond({ screens });
          break;
        }

        case "addScreen": {
          // RFC #1021 pl-6 (Codex 2nd review Must-fix): purpose を destructure + addScreen に渡す
          // (旧実装は purpose を捨てて undefined のまま追加していたので AI 経由で gadget が作れない bug)
          // RFC #1284 / #1297 I-5: id (kebab-case EntityId) を任意で受け取って addScreen に渡す
          const { id: reqId, name, type, path: screenPath, position, purpose: reqPurpose } = (params ?? {}) as {
            id?: string;
            name: string;
            type?: ScreenType;
            path?: string;
            position?: { x: number; y: number };
            purpose?: "page" | "gadget";
          };
          if (!name) {
            respondError("name は必須です");
            break;
          }
          // RFC #1284 / #1297 I-5: AI agent が指定する id は kebab-case EntityId 形式必須。
          // 空文字 / 未指定は addScreen 側で fallback (`scr-<8桁>`) が採番される。
          if (reqId !== undefined && reqId !== "" && !isValidEntityId(reqId)) {
            respondError(
              `id 形式が不正です。kebab-case 英単語 (例: "today-sales") を指定してください: got ${JSON.stringify(reqId)}`,
            );
            break;
          }
          const project = await loadProject();
          const screen = await addScreen(project, name, type ?? "other", {
            path: screenPath,
            position,
            purpose: reqPurpose,
            id: reqId,
          });
          // 新しい画面は空の業務部品レイアウト (見出しだけ) を持つ
          const entity = await buildDefaultScreen(screen.id);
          await saveScreenEntity(entity);
          this.flowChangeHandler?.();
          respond({ screenId: screen.id });
          break;
        }

        case "updateScreenMeta": {
          const { screenId, thumbnail, ...patch } = (params ?? {}) as {
            screenId: string;
            name?: string;
            type?: ScreenType;
            description?: string;
            path?: string;
            thumbnail?: string;
            // RFC #1021 pl-6 (Codex B-2): MCP update_screen で purpose / pageLayoutId 更新を許可
            purpose?: "page" | "gadget";
            pageLayoutId?: string | null;
          };
          if (!screenId) {
            respondError("screenId は必須です");
            break;
          }
          const project = await loadProject();
          if (thumbnail !== undefined) {
            await updateScreenThumbnail(project, screenId, thumbnail);
          }
          if (Object.keys(patch).length > 0) {
            // RFC #1021 pl-6 (Codex 2nd review Should-fix): pageLayoutId='' or null は **解除** 意図のため
            // `null` marker のまま flowStore.updateScreen に伝える (旧実装は undefined に変換 → undefined-stripping で
            // 解除自体が消失していた)
            const cleanedPatch: Parameters<typeof updateScreen>[2] = { ...patch } as Parameters<typeof updateScreen>[2];
            if (patch.pageLayoutId === "" || patch.pageLayoutId === null) {
              // null を解除 marker として明示
              (cleanedPatch as Record<string, unknown>).pageLayoutId = null;
            }
            const updated = await updateScreen(project, screenId, cleanedPatch);
            if (!updated) {
              respondError(`画面が見つかりません: ${screenId}`);
              break;
            }
          }
          this.flowChangeHandler?.();
          respond({ success: true });
          break;
        }

        case "removeScreenNode": {
          const { screenId } = (params ?? {}) as { screenId: string };
          if (!screenId) {
            respondError("screenId は必須です");
            break;
          }
          const project = await loadProject();
          const ok = await removeScreen(project, screenId);
          if (!ok) {
            respondError(`画面が見つかりません: ${screenId}`);
            break;
          }
          this.flowChangeHandler?.();
          respond({ success: true });
          break;
        }

        case "addFlowEdge": {
          const { source, target, label, trigger } = (params ?? {}) as {
            source: string;
            target: string;
            label: string;
            trigger?: TransitionTrigger;
          };
          if (!source || !target) {
            respondError("source と target は必須です");
            break;
          }
          const project = await loadProject();
          const edge = await addEdge(project, source, target, label ?? "", trigger ?? "click");
          this.flowChangeHandler?.();
          respond({ edgeId: edge.id });
          break;
        }

        case "removeFlowEdge": {
          const { edgeId } = (params ?? {}) as { edgeId: string };
          if (!edgeId) {
            respondError("edgeId は必須です");
            break;
          }
          const project = await loadProject();
          const ok = await removeEdge(project, edgeId);
          if (!ok) {
            respondError(`エッジが見つかりません: ${edgeId}`);
            break;
          }
          this.flowChangeHandler?.();
          respond({ success: true });
          break;
        }

        case "getFlow": {
          const project = await loadProject();
          const mermaid = generateMermaid(project);
          respond({ project, mermaid });
          break;
        }

        case "navigateScreen": {
          const { screenId } = (params ?? {}) as { screenId: string };
          if (!screenId) {
            respondError("screenId は必須です");
            break;
          }
          if (this.navigateHandler) {
            this.navigateHandler(`/screen/design/${screenId}`);
            respond({ success: true });
          } else {
            respondError("ナビゲーションハンドラが登録されていません");
          }
          break;
        }

        // ── タブ操作 ──────────────────────────────────────────────────────

        case "openTab": {
          const { screenId: tScreenId, tableId: tTableId } = (params ?? {}) as {
            screenId?: string;
            tableId?: string;
          };
          if (tScreenId) {
            const project = await loadProject();
            const screen = project.screens.find((s) => s.id === tScreenId);
            if (!screen) { respondError(`画面が見つかりません: ${tScreenId}`); break; }
            openTab({ id: makeTabId("design", tScreenId), type: "design", resourceId: tScreenId, label: screen.name });
            if (this.navigateHandler) this.navigateHandler(`/screen/design/${tScreenId}`);
          } else if (tTableId) {
            const table = await loadTable(tTableId);
            if (!table) { respondError(`テーブルが見つかりません: ${tTableId}`); break; }
            openTab({ id: makeTabId("table", tTableId), type: "table", resourceId: tTableId, label: table.name ?? table.physicalName });
            if (this.navigateHandler) this.navigateHandler(`/table/edit/${tTableId}`);
          } else {
            respondError("screenId または tableId が必要です");
            break;
          }
          respond({ success: true });
          break;
        }

        case "closeTab": {
          const { tabId: cTabId, force } = (params ?? {}) as { tabId: string; force?: boolean };
          if (!cTabId) { respondError("tabId は必須です"); break; }
          const closed = closeTab(cTabId, force ?? false);
          if (!closed) { respondError("未保存の変更があります。force: true を指定して強制閉じできます"); break; }
          respond({ success: true });
          break;
        }

        case "switchTab": {
          const { tabId: sTabId } = (params ?? {}) as { tabId: string };
          if (!sTabId) { respondError("tabId は必須です"); break; }
          const tabs = getTabs();
          if (!tabs.find((t) => t.id === sTabId)) { respondError(`タブが見つかりません: ${sTabId}`); break; }
          setActiveTab(sTabId);
          const tab = tabs.find((t) => t.id === sTabId)!;
          if (this.navigateHandler) {
            const path =
              tab.type === "design" ? `/screen/design/${tab.resourceId}`
              : tab.type === "table" ? `/table/edit/${tab.resourceId}`
              : tab.type === "process-flow" ? `/process-flow/edit/${tab.resourceId}`
              : `/screen/flow`;
            this.navigateHandler(path);
          }
          respond({ success: true });
          break;
        }

        case "listTabs": {
          const allTabs = getTabs().map((t) => ({
            id: t.id,
            type: t.type,
            resourceId: t.resourceId,
            label: t.label,
            isDirty: t.isDirty,
            isPinned: t.isPinned,
            isActive: t.id === getActiveTabId(),
          }));
          respond({ tabs: allTabs, activeTabId: getActiveTabId() });
          break;
        }

        case "saveScreen": {
          const { screenId: saveScreenId } = (params ?? {}) as { screenId: string };
          if (!saveScreenId) { respondError("screenId は必須です"); break; }
          // edit-session モデル下では editSession.save 経由で本体ファイルに書き込む
          const sessionsResult = await this.request("editSession.list", { resourceType: "screen-item", resourceId: saveScreenId }) as { sessions: Array<{ id: string }> } | null;
          if (sessionsResult && sessionsResult.sessions.length > 0) {
            const esId = sessionsResult.sessions[0].id;
            await this.request("editSession.save", { editSessionId: esId });
          }
          setDirty(makeTabId("design", saveScreenId), false);
          respond({ success: true });
          break;
        }

        case "saveAll": {
          const dirtyTabs = getTabs().filter((t) => t.isDirty && t.type === "design");
          const results: { screenId: string; success: boolean; error?: string }[] = [];
          for (const tab of dirtyTabs) {
            try {
              // edit-session モデル下では editSession.save 経由で本体ファイルに書き込む
              const sessionsResult = await this.request("editSession.list", { resourceType: "screen-item", resourceId: tab.resourceId }) as { sessions: Array<{ id: string }> } | null;
              if (sessionsResult && sessionsResult.sessions.length > 0) {
                const esId = sessionsResult.sessions[0].id;
                await this.request("editSession.save", { editSessionId: esId });
              }
              setDirty(tab.id, false);
              results.push({ screenId: tab.resourceId, success: true });
            } catch (e) {
              results.push({ screenId: tab.resourceId, success: false, error: String(e) });
            }
          }
          respond({ saved: results.filter((r) => r.success).length, total: dirtyTabs.length, results });
          break;
        }

        // ── browser-first 処理フロー操作 ──────────────────────────────

        case "getProcessFlow": {
          const { id: agId } = (params ?? {}) as { id: string };
          const handler = this.processFlowHandlers.get(agId);
          if (!handler) {
            respondError(`ProcessFlowEditor が開かれていません: ${agId}`);
            break;
          }
          respond(handler.get());
          break;
        }

        case "applyProcessFlowMutation": {
          const { id: agId, type: mutType, params: mutParams } = (params ?? {}) as {
            id: string;
            type: string;
            params: unknown;
          };
          const handler = this.processFlowHandlers.get(agId);
          if (!handler) {
            respondError(`ProcessFlowEditor が開かれていません: ${agId}`);
            break;
          }
          try {
            handler.mutate(mutType, mutParams);
            respond({ success: true });
          } catch (e) {
            respondError(String(e));
          }
          break;
        }

        default:
          respondError(`未知のメソッド: ${method}`);
      }
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── セッション ──────────────────────────────────────────────────────────

  getSessionId(): string {
    return this.clientId;
  }
}

// ── ヘルパー関数 ────────────────────────────────────────────────────────────

function isExtensionsBundle(value: unknown): value is RawExtensionsBundle {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


// ── HMR 対応: 既存インスタンスを再利用 ────────────────────────────────────

if (window.__mcpBridge) {
  window.__mcpBridge.stop();
}
const bridge = new McpBridgeImpl();
window.__mcpBridge = bridge;

export const mcpBridge = bridge;
