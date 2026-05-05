import type { Editor as GEditor, Component, Block } from "grapesjs";
import html2canvas from "html2canvas";
import { generateUUID } from "../utils/uuid";
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
  loadCustomBlocks,
  upsertCustomBlock,
  deleteCustomBlock,
  injectCustomBlockCss,
  setCustomBlocksBackend,
  type CustomBlocksStorageBackend,
  type CustomBlock,
} from "../store/customBlockStore";
import {
  setPuckComponentsBackend,
  type PuckComponentsStorageBackend,
} from "../store/puckComponentsStore";
import {
  setTableStorageBackend,
  type TableStorageBackend,
} from "../store/tableStore";
import {
  setErLayoutStorageBackend,
  type ErLayoutStorageBackend,
} from "../store/erLayoutStore";
import {
  setScreenLayoutStorageBackend,
  type ScreenLayoutStorageBackend,
} from "../store/screenLayoutStore";
import {
  setProcessFlowStorageBackend,
  type ProcessFlowStorageBackend,
} from "../store/processFlowStore";
import {
  setConventionsStorageBackend,
  type ConventionsStorageBackend,
} from "../store/conventionsStore";
import {
  loadScreenItems,
  setItemsInCache,
  type ScreenItemsDocument,
} from "../store/screenItemsStore";
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
import type { RawExtensionsBundle } from "../schemas/loadExtensions";

export type McpStatus = "disconnected" | "connecting" | "connected" | "failed";
export type ThemeIdLike = "standard" | "card" | "compact" | "dark";

type StatusCallback = (s: McpStatus) => void;
type ThemeHandler = (theme: ThemeIdLike) => void;
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

const WS_URL = `ws://${window.location.hostname}:5179`;
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
  private editor: GEditor | null = null;
  private currentScreenId: string | null = null;
  private processFlowHandlers = new Map<string, ProcessFlowHandler>();
  private status: McpStatus = "disconnected";
  private statusCallbacks: Set<StatusCallback> = new Set();
  private themeHandler: ThemeHandler | null = null;
  private navigateHandler: NavigateHandler | null = null;
  private flowChangeHandler: FlowChangeHandler | null = null;
  private extensionsCache: Promise<RawExtensionsBundle> | null = null;
  private extensionsChangedHandlers: Set<ExtensionsChangedHandler> = new Set();
  private broadcastHandlers = new Map<string, Set<BroadcastHandler>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** 接続試行カウンタ */
  private connectAttempts = 0;

  /** ブラウザセッション固有の一意 ID（再接続でも不変） */
  private readonly clientId = generateUUID();

  /** ブラウザ→サーバーリクエストの応答待ちハンドラ */
  private pendingRequests = new Map<
    string,
    { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  getClientId(): string {
    return this.clientId;
  }

  // ── ハンドラ setter ────────────────────────────────────────────────────

  setCurrentScreenId(screenId: string | null): void {
    this.currentScreenId = screenId;
  }

  setProcessFlowHandler(id: string, handler: ProcessFlowHandler | null): void {
    if (handler) {
      this.processFlowHandlers.set(id, handler);
    } else {
      this.processFlowHandlers.delete(id);
    }
  }

  setThemeHandler(handler: ThemeHandler | null): void {
    this.themeHandler = handler;
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

  start(editor: GEditor): void {
    this.editor = editor;
    this.stopped = false;
    console.log("[mcpBridge] starting...");
    // 既存の接続が生きていればそのまま再利用（FlowEditor からの遷移時にエディターだけ差し替え）
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[mcpBridge] reusing existing connection");
      return;
    }
    this._connect();
  }

  /** フロー画面用: エディターなしで WebSocket 接続のみ起動。"failed" 状態からのリトライも可 */
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
    console.log("[mcpBridge] starting without editor (flow mode)...");
    this._connect();
  }

  /**
   * AppShell が接続タイムアウトを検出した際に呼び出す (#795-C)。
   * "connecting" → "failed" に遷移し、UI にエラー画面切替を通知する。
   * retry は startWithoutEditor() の再呼び出しで行う。
   */
  markFailed(): void {
    console.log("[mcpBridge] marking as failed (connection timeout)");
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
    console.log("[mcpBridge] stopped");
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

  private _connect(): void {
    if (this.stopped) return;
    this.connectAttempts++;
    this._setStatus("connecting");
    console.log("[mcpBridge] connecting to", WS_URL, `(attempt ${this.connectAttempts})`);

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.addEventListener("open", () => {
      console.log("[mcpBridge] connected");
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
      console.log("[mcpBridge] disconnected, retrying in", RETRY_DELAY_MS, "ms");
      // バックエンドを localStorage フォールバックに戻す
      this._clearStorageBackends();
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
      console.log("[mcpBridge] connection error");
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

    const blocksBackend: CustomBlocksStorageBackend = {
      loadCustomBlocks: () => this.request("loadCustomBlocks").then((r) => (r ?? []) as unknown[]),
      saveCustomBlocks: (blocks) => this.request("saveCustomBlocks", { blocks }).then(() => undefined),
    };
    setCustomBlocksBackend(blocksBackend);

    const puckComponentsBackend: PuckComponentsStorageBackend = {
      loadPuckComponents: () => this.request("loadPuckComponents").then((r) => (r ?? []) as unknown[]),
      savePuckComponents: (components) => this.request("savePuckComponents", { components }).then(() => undefined),
    };
    setPuckComponentsBackend(puckComponentsBackend);

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

    const screenLayoutBackend: ScreenLayoutStorageBackend = {
      loadScreenLayout: () => this.request("loadScreenLayout"),
      saveScreenLayout: (data) => this.request("saveScreenLayout", { data }).then(() => undefined),
    };
    setScreenLayoutStorageBackend(screenLayoutBackend);

    const actionBackend: ProcessFlowStorageBackend = {
      loadProcessFlow: (id) => this.request("loadProcessFlow", { id }),
      saveProcessFlow: (id, data) => this.request("saveProcessFlow", { id, data }).then(() => undefined),
      deleteProcessFlow: (id) => this.request("deleteProcessFlow", { id }).then(() => undefined),
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
  }

  /** 切断時: localStorage フォールバックに戻す */
  private _clearStorageBackends(): void {
    setFlowStorageBackend(null);
    setCustomBlocksBackend(null);
    setPuckComponentsBackend(null);
    setTableStorageBackend(null);
    setErLayoutStorageBackend(null);
    setScreenLayoutStorageBackend(null);
    setProcessFlowStorageBackend(null);
    setConventionsStorageBackend(null);
    setScreenStorageBackend(null);
    setSequenceStorageBackend(null);
    setViewStorageBackend(null);
    setViewDefinitionStorageBackend(null);
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
      console.log("[mcpBridge] broadcast:", event, broadcastData);
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

    // GrapesJS editor インスタンスが不要なメソッド一覧
    // (フロー操作 / タブ操作 / ProcessFlowHandler 操作)
    const editorFreeMethods = [
      "listScreens", "addScreen", "updateScreenMeta", "removeScreenNode",
      "addFlowEdge", "removeFlowEdge", "getFlow", "navigateScreen",
      "listCustomBlocks",
      "openTab", "closeTab", "switchTab", "listTabs", "saveScreen", "saveAll",
      "getProcessFlow", "applyProcessFlowMutation",
    ];

    if (!this.editor && !editorFreeMethods.includes(method)) {
      respondError("エディターが初期化されていません");
      return;
    }

    const editor = this.editor!;

    try {
      switch (method) {
        case "getHtml": {
          const html = editor.getHtml();
          const css = editor.getCss() ?? "";
          respond({ html, css });
          break;
        }

        case "setComponents": {
          const { html } = params as { html: string };
          editor.setComponents(html);
          respond({ success: true });
          break;
        }

        case "screenshot": {
          captureScreenshot(editor)
            .then((png) => respond({ png }))
            .catch((e: unknown) => respondError(String(e)));
          break;
        }

        case "listBlocks": {
          const all = editor.Blocks.getAll();
          const blocks = all.map((b: Block) => ({
            id: b.getId(),
            label: stripHtml(String(b.get("label") ?? "")),
            category: categoryLabel(b.get("category")),
          }));
          respond({ blocks });
          break;
        }

        case "addBlock": {
          const { blockId, targetId, position } = (params ?? {}) as {
            blockId: string;
            targetId?: string;
            position?: "before" | "after" | "inside" | "append";
          };
          const block = editor.Blocks.get(blockId);
          if (!block) {
            respondError(`ブロックが見つかりません: ${blockId}`);
            break;
          }
          const content = block.get("content");
          const wrapper = editor.DomComponents.getWrapper();
          if (!wrapper) {
            respondError("キャンバスが初期化されていません");
            break;
          }

          let parent: Component = wrapper;
          let at: number | undefined = undefined;

          if (targetId) {
            const target = findComponentById(wrapper, targetId);
            if (!target) {
              respondError(`対象要素が見つかりません: ${targetId}`);
              break;
            }
            const pos = position ?? "after";
            if (pos === "inside" || pos === "append") {
              parent = target;
            } else {
              const tParent = target.parent();
              if (!tParent) {
                respondError("対象要素の親が見つかりません");
                break;
              }
              parent = tParent;
              const siblings = tParent.components();
              const idx = siblings.indexOf(target);
              at = pos === "before" ? idx : idx + 1;
            }
          }

          const added = parent.append(content as never, { at }) as unknown as Component[];
          const first = Array.isArray(added) ? added[0] : (added as unknown as Component);
          const addedId = first && typeof (first as Component).getId === "function"
            ? (first as Component).getId()
            : "";
          respond({ addedId });
          break;
        }

        case "removeElement": {
          const { id: elId } = (params ?? {}) as { id: string };
          const wrapper = editor.DomComponents.getWrapper();
          if (!wrapper) {
            respondError("キャンバスが初期化されていません");
            break;
          }
          const target = findComponentById(wrapper, elId);
          if (!target) {
            respondError(`要素が見つかりません: ${elId}`);
            break;
          }
          target.remove();
          respond({ success: true });
          break;
        }

        case "updateElement": {
          const { id: elId, attributes, style, text, classes } = (params ?? {}) as {
            id: string;
            attributes?: Record<string, string>;
            style?: Record<string, string>;
            text?: string;
            classes?: string[];
          };
          const wrapper = editor.DomComponents.getWrapper();
          if (!wrapper) {
            respondError("キャンバスが初期化されていません");
            break;
          }
          const target = findComponentById(wrapper, elId);
          if (!target) {
            respondError(`要素が見つかりません: ${elId}`);
            break;
          }
          if (attributes && typeof attributes === "object") {
            target.addAttributes(attributes);
          }
          if (style && typeof style === "object") {
            target.addStyle(style);
          }
          if (Array.isArray(classes)) {
            target.setClass(classes);
          }
          if (typeof text === "string") {
            const leaf = findFirstTextLeaf(target);
            if (leaf) {
              leaf.components(text);
            } else if (target.components().length === 0) {
              target.components(text);
            } else {
              respondError(
                `要素 ${elId} にテキストを含む子孫が見つかりません。`,
              );
              break;
            }
          }
          respond({ success: true });
          break;
        }

        case "setTheme": {
          const { theme } = (params ?? {}) as { theme: ThemeIdLike };
          if (!["standard", "card", "compact", "dark"].includes(theme)) {
            respondError(`不正なテーマID: ${theme}`);
            break;
          }
          if (!this.themeHandler) {
            respondError("テーマハンドラが登録されていません");
            break;
          }
          this.themeHandler(theme);
          respond({ success: true });
          break;
        }

        // ── フロー操作（エディター不要） ──────────────────────────────

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
          const { name, type, path: screenPath, position, editorKind: reqEditorKind, cssFramework: reqCssFramework } = (params ?? {}) as {
            name: string;
            type?: ScreenType;
            path?: string;
            position?: { x: number; y: number };
            editorKind?: "grapesjs" | "puck";
            cssFramework?: "bootstrap" | "tailwind";
          };
          if (!name) {
            respondError("name は必須です");
            break;
          }
          const project = await loadProject();
          const screen = await addScreen(project, name, type ?? "other", {
            path: screenPath,
            position,
            editorKind: reqEditorKind,
            cssFramework: reqCssFramework,
          });
          // screen.design に editorKind/cssFramework を明示書き込み (spec § 2.5.2)
          // buildDefaultScreen は project.design を参照して解決するので project default も反映される
          const entity = await buildDefaultScreen(screen.id);
          if (reqEditorKind !== undefined) entity.design = { ...entity.design, editorKind: reqEditorKind };
          if (reqCssFramework !== undefined) entity.design = { ...entity.design, cssFramework: reqCssFramework };
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
            const updated = await updateScreen(project, screenId, patch);
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

        // ── カスタムブロック管理 ──────────────────────────────────────

        case "defineBlock": {
          const { id: blockId, label, category, content, styles, media } = (params ?? {}) as {
            id: string;
            label: string;
            category: string;
            content: string;
            styles?: string;
            media?: string;
          };

          const existing = editor.Blocks.get(blockId);
          const customBlocks = await loadCustomBlocks();
          const isCustom = customBlocks.some((b) => b.id === blockId);
          if (existing && !isCustom) {
            respondError(
              `ブロックID "${blockId}" はビルトインブロックと衝突します。別のIDを使用してください。`,
            );
            break;
          }

          editor.BlockManager.add(blockId, {
            label,
            category,
            content,
            ...(media ? { media } : {}),
          });

          const blockNow = new Date().toISOString();
          const prev = customBlocks.find((b) => b.id === blockId);
          await upsertCustomBlock({
            id: blockId,
            label,
            category,
            content,
            styles,
            media,
            createdAt: prev?.createdAt ?? blockNow,
            updatedAt: blockNow,
          } as CustomBlock);

          injectCustomBlockCss(editor, await loadCustomBlocks());
          respond({ success: true });
          break;
        }

        case "removeCustomBlock": {
          const { id: blockId } = (params ?? {}) as { id: string };
          const ok = await deleteCustomBlock(blockId);
          if (!ok) {
            respondError(`カスタムブロック "${blockId}" が見つかりません`);
            break;
          }
          editor.BlockManager.remove(blockId);
          injectCustomBlockCss(editor, await loadCustomBlocks());
          respond({ success: true });
          break;
        }

        case "listCustomBlocks": {
          const all = await loadCustomBlocks();
          const blocks = all.map((b) => ({
            id: b.id,
            label: b.label,
            category: b.category,
            hasStyles: !!b.styles,
          }));
          respond({ blocks });
          break;
        }

        // ── React エクスポート ────────────────────────────────────────

        case "exportScreen": {
          const { screenId } = (params ?? {}) as { screenId: string };
          const html = editor.getHtml();
          const css = editor.getCss() ?? "";
          const project = await loadProject();
          const screen = project.screens.find((s) => s.id === screenId);
          const screenName = screen?.name ?? "Screen";
          respond({ html, css, screenName });
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
          // edit-session モデル下では draft.commit 経由で本体ファイルに書き込む
          const hasDraftResult = await this.hasDraft("screen", saveScreenId) as { exists: boolean } | null;
          if (hasDraftResult?.exists) {
            await this.commitDraft("screen", saveScreenId);
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
              // edit-session モデル下では draft.commit 経由で本体ファイルに書き込む
              const hasDraftResult = await this.hasDraft("screen", tab.resourceId) as { exists: boolean } | null;
              if (hasDraftResult?.exists) {
                await this.commitDraft("screen", tab.resourceId);
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

        // ── browser-first 命名支援 ─────────────────────────────────────

        case "getCanvasSnapshot": {
          const { screenId: reqScreenId } = (params ?? {}) as { screenId: string };
          if (this.currentScreenId !== reqScreenId) {
            respondError(`画面 ${reqScreenId} はブラウザで開かれていません (current: ${this.currentScreenId ?? "none"})`);
            break;
          }
          const html = editor.getHtml();
          let screenItems: ScreenItemsDocument | null = null;
          try {
            screenItems = await loadScreenItems(reqScreenId);
          } catch { /* ignore */ }
          respond({ html, screenItems });
          break;
        }

        case "applyRenameInBrowser": {
          const { screenId: reqScreenId, mapping } = (params ?? {}) as {
            screenId: string;
            mapping: Record<string, string>;
          };
          if (this.currentScreenId !== reqScreenId) {
            respondError(`画面 ${reqScreenId} はブラウザで開かれていません`);
            break;
          }

          let siFile: ScreenItemsDocument | null = null;
          try {
            siFile = await loadScreenItems(reqScreenId);
          } catch (e) {
            respondError(`screenItems の読み込みに失敗: ${e}`);
            break;
          }

          const succeeded: string[] = [];
          const failed: Array<{ oldId: string; error: string }> = [];
          const wrapper = editor.DomComponents.getWrapper();

          // UndoManager を停止して直接更新
          const um = editor.UndoManager;
          um.stop();
          try {
            for (const [oldId, newId] of Object.entries(mapping)) {
              try {
                const domHits = wrapper ? updateComponentIds(wrapper, oldId, newId) : 0;
                let siHit = false;
                if (siFile) {
                  const item = siFile.items.find((i) => i.id === oldId);
                  if (item) { item.id = newId as typeof item.id; siHit = true; }
                }
                if (domHits === 0 && !siHit) {
                  failed.push({ oldId, error: `id "${oldId}" が DOM にも screen-items にも見つかりません` });
                } else {
                  succeeded.push(oldId);
                }
              } catch (e) {
                failed.push({ oldId, error: String(e) });
              }
            }
          } finally {
            um.start();
          }

          if (succeeded.length > 0) {
            if (siFile) setItemsInCache(siFile);
            setDirty(makeTabId("design", reqScreenId), true);
          }

          respond({ succeeded, failed });
          break;
        }

        default:
          respondError(`未知のメソッド: ${method}`);
      }
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── lock / draft wrapper (PR-4) ──────────────────────────────────────────

  getSessionId(): string {
    return this.clientId;
  }

  acquireLock(resourceType: string, resourceId: string, sessionId: string): Promise<unknown> {
    return this.request("lock.acquire", { resourceType, resourceId, sessionId });
  }

  releaseLock(resourceType: string, resourceId: string, sessionId: string): Promise<unknown> {
    return this.request("lock.release", { resourceType, resourceId, sessionId });
  }

  forceReleaseLock(resourceType: string, resourceId: string, sessionId: string): Promise<unknown> {
    return this.request("lock.forceRelease", { resourceType, resourceId, sessionId });
  }

  getLock(resourceType: string, resourceId: string): Promise<unknown> {
    return this.request("lock.get", { resourceType, resourceId });
  }

  readDraft(resourceType: string, id: string): Promise<unknown> {
    return this.request("draft.read", { type: resourceType, id });
  }

  updateDraft(resourceType: string, id: string, payload: unknown): Promise<unknown> {
    return this.request("draft.update", { type: resourceType, id, payload });
  }

  commitDraft(resourceType: string, id: string): Promise<unknown> {
    return this.request("draft.commit", { type: resourceType, id });
  }

  discardDraft(resourceType: string, id: string): Promise<unknown> {
    return this.request("draft.discard", { type: resourceType, id });
  }

  hasDraft(resourceType: string, id: string): Promise<unknown> {
    return this.request("draft.has", { type: resourceType, id });
  }

  createDraft(resourceType: string, id: string): Promise<unknown> {
    return this.request("draft.create", { type: resourceType, id });
  }

  // #806: Puck Data 専用 API (screens/<id>/puck-data.json)
  loadPuckData(screenId: string): Promise<unknown> {
    return this.request("loadPuckData", { screenId });
  }

  savePuckData(screenId: string, data: unknown): Promise<unknown> {
    return this.request("savePuckData", { screenId, data });
  }
}

// ── ヘルパー関数 ────────────────────────────────────────────────────────────

function updateComponentIds(component: Component, oldId: string, newId: string): number {
  const attrs = component.getAttributes();
  const updates: Record<string, string> = {};
  if (attrs.name === oldId) updates.name = newId;
  if (attrs.id === oldId) updates.id = newId;
  let hits = Object.keys(updates).length > 0 ? 1 : 0;
  if (hits > 0) component.addAttributes(updates);
  const children = component.components();
  for (let i = 0; i < children.length; i++) {
    hits += updateComponentIds(children.at(i) as Component, oldId, newId);
  }
  return hits;
}

function findFirstTextLeaf(c: Component): Component | null {
  const children = c.components();
  if (
    children.length > 0 &&
    children.at(0).get("type") === "textnode" &&
    children.length === 1
  ) {
    return c;
  }
  for (let i = 0; i < children.length; i++) {
    const child = children.at(i) as Component;
    if (child.get("type") === "textnode") continue;
    const found = findFirstTextLeaf(child);
    if (found) return found;
  }
  return null;
}

function findComponentById(root: Component, id: string): Component | null {
  if (root.getId() === id) return root;
  const children = root.components();
  for (let i = 0; i < children.length; i++) {
    const found = findComponentById(children.at(i) as Component, id);
    if (found) return found;
  }
  return null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function categoryLabel(cat: unknown): string {
  if (!cat) return "";
  if (typeof cat === "string") return cat;
  if (typeof cat === "object" && cat !== null) {
    const obj = cat as { id?: string; label?: string };
    return obj.label ?? obj.id ?? "";
  }
  return String(cat);
}

function isExtensionsBundle(value: unknown): value is RawExtensionsBundle {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function captureScreenshot(editor: GEditor): Promise<string> {
  const canvasDoc = editor.Canvas.getDocument();
  if (!canvasDoc || !canvasDoc.body) {
    throw new Error("キャンバスのドキュメントにアクセスできません");
  }
  const body = canvasDoc.body;
  const canvasEl = await html2canvas(body, {
    backgroundColor: null,
    scale: 1,
    logging: false,
    useCORS: true,
    allowTaint: true,
  });
  return canvasEl.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

// ── HMR 対応: 既存インスタンスを再利用 ────────────────────────────────────

if (window.__mcpBridge) {
  window.__mcpBridge.stop();
}
const bridge = new McpBridgeImpl();
window.__mcpBridge = bridge;

export const mcpBridge = bridge;
