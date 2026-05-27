import { CodexClient, type CodexClientOptions } from "./client.js";
import type { CloseOptions } from "./transport.js";
import { AccountManager } from "./account.js";
import { loadCodexConfig, type CodexConfig } from "./config.js";
import { JsonRpcError } from "./jsonRpc.js";
import type { ClientInfo } from "./types/ClientInfo.js";
import type { ServerNotification } from "./types/ServerNotification.js";
import type { ServerRequest } from "./types/ServerRequest.js";
import type { AccountLoginCompletedNotification } from "./types/v2/AccountLoginCompletedNotification.js";

const DEFAULT_CLIENT_INFO: ClientInfo = {
  name: "Harnize Harmony",
  title: null,
  version: "0.1.0",
};

export interface CodexConnectionOptions {
  config?: CodexConfig;
  clientInfo?: ClientInfo;
  /** Internal hook for tests: provide a factory that returns a CodexClient. */
  _clientFactory?: (options: CodexClientOptions) => Promise<CodexClient>;
}

type NotificationListener = (n: ServerNotification) => void;
type ServerRequestHandler = ((r: ServerRequest) => Promise<unknown> | unknown) | null;

/**
 * Manages the Codex connection lifecycle with on-demand connect semantics.
 *
 * - Does NOT connect at construction time.
 * - First call to `connect()` / `request()` / `notify()` triggers `CodexClient.connect()`.
 * - Subsequent calls reuse the same client.
 * - Transport close is detected (in-flight requests are already rejected by CodexClient),
 *   but automatic reconnect is intentionally not done (lazy: next call reconnects).
 * - Notifications are dispatched to registered listeners via `subscribe()`.
 * - `account/login/completed` is additionally forwarded to `AccountManager`.
 * - Server-initiated requests are forwarded to the handler registered with `subscribeServerRequest()`.
 */
export class CodexConnection {
  private readonly config: CodexConfig;
  private readonly clientInfo: ClientInfo;
  private readonly clientFactory: (options: CodexClientOptions) => Promise<CodexClient>;

  private _client: CodexClient | null = null;
  private _connecting: Promise<CodexClient> | null = null;
  /**
   * 接続中 shutdown 経路用 (#1400 Round 2)。
   * close() で abort すると StdioTransport が child を即時 SIGKILL。
   * connect 完了後は次回 connect のために null に戻す。
   */
  private _connectAbort: AbortController | null = null;

  private readonly _listeners = new Set<NotificationListener>();
  private _serverRequestHandler: ServerRequestHandler = null;

  /** AccountManager is constructed once and kept alive across reconnects. */
  private _accountManager: AccountManager | null = null;

  constructor(opts?: CodexConnectionOptions) {
    this.config = opts?.config ?? loadCodexConfig();
    this.clientInfo = opts?.clientInfo ?? DEFAULT_CLIENT_INFO;
    this.clientFactory = opts?._clientFactory ?? CodexClient.connect;
  }

  // ── AccountManager (lazy, survives reconnect) ────────────────────────────

  /**
   * AccountManager facade. Lazily created on first access.
   * When the underlying client is replaced after reconnect, AccountManager is updated.
   */
  get account(): AccountManager {
    if (!this._accountManager) {
      // Provide a thin CodexClient-compatible proxy so AccountManager always
      // routes through the current connection (handles lazy connect + reconnect).
      const self = this;
      const proxy = {
        async request<T>(method: string, params?: unknown): Promise<T> {
          return self.request<T>(method, params);
        },
        notify(method: string, params?: unknown): void {
          self.notify(method, params);
        },
      } as unknown as import("./client.js").CodexClient;
      this._accountManager = new AccountManager(proxy);
    }
    return this._accountManager;
  }

  // ── Connection state ─────────────────────────────────────────────────────

  isConnected(): boolean {
    return this._client !== null;
  }

  /**
   * Returns the current client, connecting if necessary.
   * Re-entrant: concurrent callers share the same connect() promise.
   */
  async connect(): Promise<CodexClient> {
    if (this._client) return this._client;
    if (this._connecting) return this._connecting;

    this._connecting = this._doConnect();
    try {
      const client = await this._connecting;
      return client;
    } finally {
      this._connecting = null;
    }
  }

  private async _doConnect(): Promise<CodexClient> {
    // 接続中 shutdown を可能にする AbortController (#1400 Round 2)。
    // close() で abort すると StdioTransport が即時 child を SIGKILL。
    this._connectAbort = new AbortController();
    const client = await this.clientFactory({
      config: this.config,
      clientInfo: this.clientInfo,
      onNotification: (n) => this._handleNotification(n),
      onServerRequest: (r) => this._handleServerRequest(r),
      onError: (err) => {
        console.error("[CodexConnection] transport error:", err.message);
      },
      signal: this._connectAbort.signal,
    });

    // Detect transport close so we can clear the reference (lazy reconnect on next call).
    // CodexClient doesn't expose a close event directly; we hook it via the internal rpc
    // by registering a request that immediately resolves — but that's not ideal. Instead,
    // we watch the notification channel: when the client closes, in-flight requests reject
    // but we still need to clear _client. We use a close probe via a Promise race.
    // Simpler: wrap close detection at the transport level.
    // Since CodexClient doesn't expose an "onClose" callback directly, we detect it
    // indirectly: we call a no-op ping that the client will reject when closed; but that
    // would be wasteful. Instead we rely on the fact that once the transport closes,
    // `_client.request()` will throw, and in `request()` we clear `_client` on error.
    // Additionally, we attach a cleanup via a hidden weak mechanism here:
    this._attachCloseDetection(client);

    this._client = client;
    // 接続成功後は AbortController を破棄 (次回 connect で新規に作る)。
    // close() が後で呼ばれた時は通常の client.close() 経路で kill される。
    this._connectAbort = null;
    this._broadcastConnectionState("connected");
    return client;
  }

  /**
   * Attach close detection to a connected client.
   * We do this by scheduling a periodic check: if the client rejects a trivial request
   * due to "closed", clear _client. However, a cleaner approach is to wrap in a sentinel
   * Promise that we reject manually.
   *
   * Implementation: We create a "watchdog" Promise that we never resolve — CodexClient
   * does not expose onClose directly. Instead, we detect close lazily in `request()`:
   * if it throws "JsonRpcClient: closed", we reset _client.
   *
   * So _attachCloseDetection is intentionally a no-op here; the lazy detection in
   * `request()` is sufficient for the use-case.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _attachCloseDetection(_client: CodexClient): void {
    // Lazy close detection: handled in request() via error code check.
    // If needed, a more eager hook can be added here in the future.
  }

  // ── Messaging ────────────────────────────────────────────────────────────

  async request<T>(method: string, params?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
    const client = await this.connect();
    try {
      return await client.request<T>(method, params, opts);
    } catch (err) {
      // Detect client-closed errors and clear the reference so the next call reconnects.
      if (err instanceof Error && (err.message.includes("closed") || err.message.includes("transport closed"))) {
        if (this._client === client) {
          this._client = null;
          this._broadcastConnectionState("disconnected");
        }
      }
      throw err;
    }
  }

  notify(method: string, params?: unknown): void {
    if (!this._client) {
      console.warn(`[CodexConnection] notify(${method}) called but not connected; dropping`);
      return;
    }
    try {
      this._client.notify(method, params);
    } catch (err) {
      if (err instanceof Error && err.message.includes("closed")) {
        this._client = null;
        this._broadcastConnectionState("disconnected");
      } else {
        throw err;
      }
    }
  }

  // ── Notification subscription ─────────────────────────────────────────────

  /**
   * Subscribe to ServerNotification (excluding account/login/completed which is
   * consumed internally by AccountManager).
   * Returns an unsubscribe function.
   */
  subscribe(listener: NotificationListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  // ── Server request subscription ──────────────────────────────────────────

  /**
   * Register a handler for server-initiated requests.
   * Only one handler is allowed; a later call overrides the previous one.
   * Pass `null` to deregister.
   */
  subscribeServerRequest(handler: ServerRequestHandler): void {
    this._serverRequestHandler = handler;
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  async close(opts?: CloseOptions): Promise<void> {
    // 接続中 race 対策 (#1400 Round 2): in-flight connect があれば abort で子プロセスを即時 kill。
    // connect 中 SIGINT が入った場合、AbortController が StdioTransport の child を SIGKILL する。
    if (this._connectAbort) {
      this._connectAbort.abort();
      this._connectAbort = null;
    }
    // 接続中 Promise の reject / resolve を待つ (kill 後の cleanup を確実に走らせるため)。
    // hang 防止に 1.5 秒で諦める — 親 safeguard 3 秒 + tsx force-kill 5 秒の範囲に収める。
    const inFlight = this._connecting;
    if (inFlight) {
      try {
        await Promise.race([
          inFlight.catch(() => null),
          new Promise<null>((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch { /* ignore */ }
    }
    const client = this._client;
    this._client = null;
    this._connecting = null;
    if (client) {
      try {
        await client.close(opts);
      } catch { /* ignore close errors */ }
      this._broadcastConnectionState("disconnected");
    }
  }

  // ── Internal dispatch ─────────────────────────────────────────────────────

  private _handleNotification(n: ServerNotification): void {
    // account/login/completed: forward to AccountManager (if it has been initialized)
    if (n.method === "account/login/completed") {
      if (this._accountManager) {
        this._accountManager.handleLoginCompletedNotification(
          n.params as AccountLoginCompletedNotification,
        );
      }
      // Also broadcast to other listeners
    }
    for (const listener of this._listeners) {
      try {
        listener(n);
      } catch (err) {
        console.error("[CodexConnection] notification listener threw:", err);
      }
    }
  }

  private async _handleServerRequest(r: ServerRequest): Promise<unknown> {
    if (!this._serverRequestHandler) {
      throw new JsonRpcError(-32601, `No handler registered for server request: ${r.method}`);
    }
    return this._serverRequestHandler(r);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _broadcastConnectionState(_state: "connected" | "disconnected" | "error"): void {
    // Connection state changes are communicated to wsBridge via the public API.
    // This hook is intentionally left for future use; wsBridge registers a subscriber.
  }
}
