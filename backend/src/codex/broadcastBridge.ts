/**
 * CodexBroadcastBridge (#867 / #1144 Phase-2)
 *
 * wsBridge.ts から codex App Server 連携の以下責務を分離した独立 module:
 * - Lazy CodexConnection singleton (on-demand connect)
 * - codex notification 受信時の WS broadcast (cross-workspace)
 * - codex server-initiated request の WS broadcast + pending-response 管理
 * - codex.serverRequest.respond による pending request の resolve/reject
 *
 * wsBridge 側は本クラスのインスタンスを 1 つ保持し、`getConnection()` /
 * `resolveServerRequest()` / `close()` を呼ぶだけになる。codex.* RPC handler は
 * `wsHandlers/codex.ts` 側で `bridge.codex` 経由で本インスタンスを取得して使用する。
 */
import { CodexConnection } from "./connection.js";
import type { ServerNotification } from "./types/ServerNotification.js";
import type { ServerRequest } from "./types/ServerRequest.js";

/**
 * broadcast callback. wsBridge.broadcast({ wsId: null, ... }) を抽象化。
 * wsId: null = 全 session に配信 (codex notification はワークスペース横断)。
 */
type BroadcastFn = (event: string, data: unknown) => void;

export class CodexBroadcastBridge {
  /** Singleton CodexConnection — lazy (on-demand connect). */
  private _conn: CodexConnection | null = null;

  /**
   * Pending Codex server-initiated requests waiting for a browser client to respond.
   * key = requestId (from ServerRequest.id, coerced to string).
   * 5 min default timeout via HARMONY_CODEX_APPROVAL_TIMEOUT_MS.
   */
  private _pendingServerRequests = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly broadcast: BroadcastFn) {}

  /** Lazy getter for CodexConnection singleton. */
  getConnection(): CodexConnection {
    if (!this._conn) {
      this._conn = new CodexConnection();

      // Subscribe to notifications and forward to all WS clients.
      this._conn.subscribe((n: ServerNotification) => {
        this._broadcastNotification(n.method, n.params);
      });

      // Subscribe to server-initiated requests: broadcast to all clients, manage pending map.
      this._conn.subscribeServerRequest((r: ServerRequest) => {
        return this._handleServerRequest(r);
      });
    }
    return this._conn;
  }

  /** Broadcast a codex notification to all WS clients (cross-workspace). */
  private _broadcastNotification(method: string, params: unknown): void {
    this.broadcast("codex.notification", { method, params });
  }

  /** Broadcast a codex server request to all WS clients; manage pending response map. */
  private _handleServerRequest(r: ServerRequest): Promise<unknown> {
    const timeoutMs = parseInt(
      process.env.HARMONY_CODEX_APPROVAL_TIMEOUT_MS ?? "300000",
      10,
    );
    const requestId = String(r.id);

    // Reject if the same id is already pending (shouldn't happen but be safe).
    const existing = this._pendingServerRequests.get(requestId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error(`duplicate server request id: ${requestId}`));
      this._pendingServerRequests.delete(requestId);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingServerRequests.delete(requestId);
        reject(new Error(`approval timeout for server request id=${requestId}`));
      }, timeoutMs);

      this._pendingServerRequests.set(requestId, { resolve, reject, timer });

      this.broadcast("codex.serverRequest", { id: requestId, method: r.method, params: r.params });
    });
  }

  /** Handle `codex.serverRequest.respond` from browser. */
  resolveServerRequest(requestId: string, result: unknown, isError: false): void;
  resolveServerRequest(
    requestId: string,
    result: { code: number; message: string },
    isError: true,
  ): void;
  resolveServerRequest(
    requestId: string,
    result: unknown,
    isError: boolean,
  ): void {
    const pending = this._pendingServerRequests.get(requestId);
    if (!pending) return; // already resolved or timed out — silently drop
    clearTimeout(pending.timer);
    this._pendingServerRequests.delete(requestId);
    if (isError) {
      const e = result as { code: number; message: string };
      const err = new Error(e.message);
      (err as Error & { code?: number }).code = e.code;
      pending.reject(err);
    } else {
      pending.resolve(result);
    }
  }

  /** Close CodexConnection on shutdown. */
  async close(): Promise<void> {
    if (this._conn) {
      const conn = this._conn;
      this._conn = null;
      await conn.close();
    }
  }
}
