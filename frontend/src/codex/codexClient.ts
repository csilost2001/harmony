/**
 * CodexBrowserClient — typed API over `mcpBridge` for Codex WS messages.
 *
 * Each method translates to exactly one `mcpBridge.request(method, params)` call.
 * Notification and server-request subscriptions delegate to `mcpBridge.onBroadcast`.
 *
 * Design decisions:
 * - Constructor injection for mcpBridge (enables easy mocking in tests).
 * - Singleton exported as `codexClient` for production use.
 * - subscribeServerRequest uses lazy one-time onBroadcast registration to
 *   avoid duplicate listeners across multiple subscribe calls.
 */

import type {
  AccountState,
  ChatgptLoginStartResult,
  GetAccountRateLimitsResponse,
  ApprovalHandler,
  CodexNotification,
  CodexServerRequest,
} from "./types.ts";
import { mcpBridge } from "../mcp/mcpBridge.ts";

// ── Bridge interface (minimal surface, injectable for tests) ─────────────────

export interface McpBridgeLike {
  request(method: string, params?: unknown): Promise<unknown>;
  onBroadcast(event: string, handler: (data: unknown) => void): () => void;
}

// ── Client class ──────────────────────────────────────────────────────────────

export class CodexBrowserClient {
  private readonly bridge: McpBridgeLike;

  /** Null until first subscribeServerRequest call. */
  private _serverRequestUnsub: (() => void) | null = null;
  /** Latest registered handler (last write wins, null = cleared). */
  private _approvalHandler: ApprovalHandler | null = null;

  constructor(bridge: McpBridgeLike) {
    this.bridge = bridge;
  }

  // ── account ────────────────────────────────────────────────────────────────

  readonly account = {
    /** Read current account state. */
    read: (): Promise<AccountState> => {
      return this.bridge
        .request("codex.account.read")
        .then((r) => r as AccountState);
    },

    /**
     * Start the ChatGPT OAuth login flow.
     * Returns `{ loginId, authUrl }` — open `authUrl` in a browser.
     */
    startChatgptLogin: (): Promise<ChatgptLoginStartResult> => {
      return this.bridge
        .request("codex.account.login.start")
        .then((r) => r as ChatgptLoginStartResult);
    },

    /** Cancel an in-progress ChatGPT login by loginId. */
    cancelChatgptLogin: (loginId: string): Promise<void> => {
      return this.bridge
        .request("codex.account.login.cancel", { loginId })
        .then(() => undefined);
    },

    /** Logout the current account. */
    logout: (): Promise<void> => {
      return this.bridge
        .request("codex.account.logout")
        .then(() => undefined);
    },

    /** Read current rate limit snapshot. */
    rateLimits: (): Promise<GetAccountRateLimitsResponse> => {
      return this.bridge
        .request("codex.account.rateLimits.read")
        .then((r) => r as GetAccountRateLimitsResponse);
    },
  };

  // ── thread ────────────────────────────────────────────────────────────────

  readonly thread = {
    /** Start a new Codex conversation thread. */
    start: (params: unknown): Promise<unknown> => {
      return this.bridge.request("codex.thread.start", params);
    },

    /** Resume an existing thread. */
    resume: (params: unknown): Promise<unknown> => {
      return this.bridge.request("codex.thread.resume", params);
    },
  };

  // ── turn ──────────────────────────────────────────────────────────────────

  readonly turn = {
    /** Start a new turn within the active thread. */
    start: (params: unknown): Promise<unknown> => {
      return this.bridge.request("codex.turn.start", params);
    },

    /** Steer (redirect) an in-progress turn. */
    steer: (params: unknown): Promise<unknown> => {
      return this.bridge.request("codex.turn.steer", params);
    },

    /** Interrupt (cancel) an in-progress turn. */
    interrupt: (params: unknown): Promise<unknown> => {
      return this.bridge.request("codex.turn.interrupt", params);
    },
  };

  // ── model ──────────────────────────────────────────────────────────────────

  /** List available models. */
  model = {
    list: (): Promise<unknown> => {
      return this.bridge.request("codex.model.list");
    },
  };

  // ── notifications ──────────────────────────────────────────────────────────

  /**
   * Subscribe to Codex server notifications.
   * Returns an unsubscribe function.
   */
  subscribeNotification(
    handler: (n: CodexNotification) => void,
  ): () => void {
    return this.bridge.onBroadcast("codex.notification", (data) => {
      handler(data as CodexNotification);
    });
  }

  // ── server-initiated approval requests ────────────────────────────────────

  /**
   * Register (or clear) the handler for Codex server approval requests.
   *
   * - Only one handler is active at a time (last write wins).
   * - Pass `null` to clear and stop auto-responding.
   * - The underlying `onBroadcast` subscription is created lazily on first
   *   non-null registration and never torn down (handler null = warn + skip).
   */
  subscribeServerRequest(handler: ApprovalHandler | null): void {
    this._approvalHandler = handler;

    if (this._serverRequestUnsub === null && handler !== null) {
      // Lazy one-time registration — never call onBroadcast again after this.
      this._serverRequestUnsub = this.bridge.onBroadcast(
        "codex.serverRequest",
        (data) => {
          const req = data as CodexServerRequest;

          if (this._approvalHandler === null) {
            console.warn(
              "[CodexBrowserClient] serverRequest received but no handler registered — " +
                "backend approval timeout will apply.",
              req,
            );
            return;
          }

          const currentHandler = this._approvalHandler;
          Promise.resolve()
            .then(() => currentHandler(req))
            .then((result) => {
              return this.bridge.request("codex.serverRequest.respond", {
                requestId: req.id,
                result,
              });
            })
            .catch((err: unknown) => {
              const code =
                err instanceof Error &&
                "code" in err &&
                typeof (err as { code?: unknown }).code === "number"
                  ? (err as { code: number }).code
                  : -32000;
              const message =
                err instanceof Error
                  ? err.message
                  : String(err);
              return this.bridge.request("codex.serverRequest.respond", {
                requestId: req.id,
                error: { code, message },
              });
            });
        },
      );
    }
  }
}

// ── Singleton for production use ──────────────────────────────────────────────

export const codexClient = new CodexBrowserClient(mcpBridge);
