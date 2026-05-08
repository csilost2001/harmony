import { describe, expect, it, vi } from "vitest";
import { CodexConnection } from "./connection.js";
import { CodexClient } from "./client.js";
import { JsonRpcClient, JsonRpcError } from "./jsonRpc.js";
import { JsonRpcTransport } from "./transport.js";
import type { ServerNotification } from "./types/ServerNotification.js";
import type { CodexClientOptions } from "./client.js";

// ── MockTransport (same pattern as jsonRpc.test.ts) ──────────────────────────

class MockTransport extends JsonRpcTransport {
  sent: string[] = [];
  send(message: string): void {
    this.sent.push(message);
  }
  async close(): Promise<void> {
    this.emit("close", { kind: "local" });
  }
  /** Inject a JSON-RPC message frame into the transport (simulates server push). */
  inject(message: object): void {
    this.emit("message", JSON.stringify(message));
  }
}

// ── MockCodexClient factory ────────────────────────────────────────────────────
//
// We create a real `JsonRpcClient` backed by `MockTransport`.
// CodexConnection passes its option callbacks (onNotification, onServerRequest)
// when it calls the factory; we wire those into the JsonRpcClient so that
// injecting JSON-RPC frames into the transport triggers the correct callbacks.

function createConnectionWithMock(overrides?: {
  factoryError?: Error;
}): {
  conn: CodexConnection;
  transport: MockTransport;
  /** Inject a JSON-RPC notification into the transport (server → client push). */
  injectNotification: (method: string, params?: object) => void;
  /**
   * Inject a JSON-RPC server-initiated request into the transport.
   * The JsonRpcClient will call onServerRequest, which in turn calls
   * CodexConnection._handleServerRequest, and sends the response via transport.send().
   */
  injectServerRequest: (id: number | string, method: string, params?: object) => void;
} {
  const transport = new MockTransport();
  let capturedOpts: CodexClientOptions | null = null;
  let rpc: JsonRpcClient | null = null;

  const factory = vi.fn(async (opts: CodexClientOptions): Promise<CodexClient> => {
    if (overrides?.factoryError) throw overrides.factoryError;
    capturedOpts = opts;

    rpc = new JsonRpcClient({
      transport,
      onNotification: (n) => {
        capturedOpts?.onNotification?.(n as unknown as ServerNotification);
      },
      onServerRequest: async (r) => {
        if (!capturedOpts?.onServerRequest) {
          throw new JsonRpcError(-32601, `No handler for server request: ${r.method}`);
        }
        return capturedOpts.onServerRequest(
          r as unknown as import("./types/ServerRequest.js").ServerRequest,
        );
      },
    });

    const client: CodexClient = {
      request: <T>(method: string, params?: unknown, opts2?: { signal?: AbortSignal }) =>
        rpc!.request<T>(method, params, opts2),
      notify: (method: string, params?: unknown) => rpc!.notify(method, params),
      close: () => rpc!.close(),
      getInitializeResponse: () =>
        ({}) as import("./types/InitializeResponse.js").InitializeResponse,
    } as unknown as CodexClient;

    return client;
  });

  const conn = new CodexConnection({ _clientFactory: factory });

  return {
    conn,
    transport,
    injectNotification: (method: string, params: object = {}) => {
      transport.inject({ jsonrpc: "2.0", method, params });
    },
    injectServerRequest: (id: number | string, method: string, params: object = {}) => {
      // A JSON-RPC frame with both `id` and `method` is a server-initiated request.
      transport.inject({ jsonrpc: "2.0", id, method, params });
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CodexConnection", () => {
  describe("on-demand connect", () => {
    it("does not connect at construction time", () => {
      const factory = vi.fn();
      new CodexConnection({ _clientFactory: factory });
      expect(factory).not.toHaveBeenCalled();
    });

    it("isConnected() returns false before first request", () => {
      const { conn } = createConnectionWithMock();
      expect(conn.isConnected()).toBe(false);
    });

    it("calling request() triggers connect() and resolves correctly", async () => {
      const { transport, conn } = createConnectionWithMock();

      const reqP = conn.request<string>("ping", {});
      await new Promise((r) => setImmediate(r));

      // Reply to the request
      const sent = JSON.parse(transport.sent[0]!);
      transport.inject({ jsonrpc: "2.0", id: sent.id, result: "pong" });

      await expect(reqP).resolves.toBe("pong");
      expect(conn.isConnected()).toBe(true);
    });

    it("concurrent connect() calls only create one client", async () => {
      let clientCount = 0;
      const factory = vi.fn(async (): Promise<CodexClient> => {
        clientCount++;
        // Build a minimal no-op client
        return {
          request: async () => undefined,
          notify: () => undefined,
          close: async () => undefined,
          getInitializeResponse: () =>
            ({}) as import("./types/InitializeResponse.js").InitializeResponse,
        } as unknown as CodexClient;
      });
      const conn = new CodexConnection({ _clientFactory: factory });

      const [c1, c2, c3] = await Promise.all([conn.connect(), conn.connect(), conn.connect()]);
      expect(clientCount).toBe(1);
      expect(c1).toBe(c2);
      expect(c2).toBe(c3);
    });
  });

  describe("notification subscribe / unsubscribe", () => {
    it("delivers notifications to all listeners", async () => {
      const { conn, injectNotification } = createConnectionWithMock();
      await conn.connect();

      const listener1 = vi.fn();
      const listener2 = vi.fn();
      conn.subscribe(listener1);
      conn.subscribe(listener2);

      injectNotification("turn/started", { turnId: "t1" });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      const received = listener1.mock.calls[0]![0] as ServerNotification;
      expect(received.method).toBe("turn/started");
    });

    it("unsubscribe prevents further delivery", async () => {
      const { conn, injectNotification } = createConnectionWithMock();
      await conn.connect();

      const listener = vi.fn();
      const unsub = conn.subscribe(listener);
      unsub();

      injectNotification("turn/started", { turnId: "t1" });
      expect(listener).not.toHaveBeenCalled();
    });

    it("multiple subscribe/unsubscribe cycles work correctly", async () => {
      const { conn, injectNotification } = createConnectionWithMock();
      await conn.connect();

      const listener = vi.fn();
      const unsub1 = conn.subscribe(listener);
      injectNotification("turn/started", { turnId: "t1" });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub1();
      injectNotification("turn/started", { turnId: "t2" });
      expect(listener).toHaveBeenCalledTimes(1); // still 1, not 2

      const unsub2 = conn.subscribe(listener);
      injectNotification("turn/started", { turnId: "t3" });
      expect(listener).toHaveBeenCalledTimes(2);
      unsub2();
    });
  });

  describe("account/login/completed notification", () => {
    it("forwards account/login/completed to AccountManager", async () => {
      const { conn, injectNotification } = createConnectionWithMock();
      await conn.connect();

      const accountMgr = conn.account;
      const handleSpy = vi.spyOn(accountMgr, "handleLoginCompletedNotification");

      injectNotification("account/login/completed", {
        loginId: "L1",
        success: true,
        error: null,
      });

      expect(handleSpy).toHaveBeenCalledWith({ loginId: "L1", success: true, error: null });
    });

    it("also delivers account/login/completed to subscribe() listeners", async () => {
      const { conn, injectNotification } = createConnectionWithMock();
      await conn.connect();

      const listener = vi.fn();
      conn.subscribe(listener);

      injectNotification("account/login/completed", {
        loginId: "L1",
        success: true,
        error: null,
      });

      expect(listener).toHaveBeenCalledTimes(1);
      const received = listener.mock.calls[0]![0] as ServerNotification;
      expect(received.method).toBe("account/login/completed");
    });

    it("AccountManager handleLoginCompletedNotification resolves pending login", async () => {
      const { conn, transport, injectNotification } = createConnectionWithMock();
      await conn.connect();

      // Mock account/login/start response
      const startReqP = conn.account.startChatgptLogin();
      await new Promise((r) => setImmediate(r));

      const sent = JSON.parse(transport.sent[0]!);
      transport.inject({
        jsonrpc: "2.0",
        id: sent.id,
        result: { type: "chatgpt", loginId: "L99", authUrl: "https://example.com/auth" },
      });

      const pending = await startReqP;
      expect(pending.loginId).toBe("L99");

      injectNotification("account/login/completed", {
        loginId: "L99",
        success: true,
        error: null,
      });

      await expect(pending.completion).resolves.toBeUndefined();
    });
  });

  describe("server request handler", () => {
    it("registered handler receives server request and response is sent back", async () => {
      const { conn, transport, injectServerRequest } = createConnectionWithMock();
      await conn.connect();

      conn.subscribeServerRequest(async (r) => {
        expect(r.method).toBe("item/commandExecution/requestApproval");
        return { approved: true };
      });

      injectServerRequest(42, "item/commandExecution/requestApproval", {});
      await new Promise((r) => setImmediate(r));

      const reply = transport.sent.find((s) => {
        const msg = JSON.parse(s) as { id?: unknown; result?: unknown };
        return "result" in msg && msg.id === 42;
      });
      expect(reply).toBeDefined();
      expect(JSON.parse(reply!).result).toEqual({ approved: true });
    });

    it("no handler registered: -32601 error is sent back", async () => {
      const { conn, transport, injectServerRequest } = createConnectionWithMock();
      await conn.connect();

      // No subscribeServerRequest call

      injectServerRequest(99, "item/commandExecution/requestApproval", {});
      await new Promise((r) => setImmediate(r));

      const errReply = transport.sent.find((s) => {
        const msg = JSON.parse(s) as { id?: unknown; error?: unknown };
        return "error" in msg && msg.id === 99;
      });
      expect(errReply).toBeDefined();
      expect(JSON.parse(errReply!).error?.code).toBe(-32601);
    });

    it("later subscribeServerRequest call overrides the previous handler", async () => {
      const { conn, transport, injectServerRequest } = createConnectionWithMock();
      await conn.connect();

      const handler1 = vi.fn().mockResolvedValue({ from: "handler1" });
      const handler2 = vi.fn().mockResolvedValue({ from: "handler2" });

      conn.subscribeServerRequest(handler1);
      conn.subscribeServerRequest(handler2);

      injectServerRequest(55, "item/commandExecution/requestApproval", {});
      await new Promise((r) => setImmediate(r));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();

      const reply = transport.sent.find((s) => {
        const msg = JSON.parse(s) as { id?: unknown; result?: unknown };
        return "result" in msg && msg.id === 55;
      });
      expect(reply).toBeDefined();
      expect(JSON.parse(reply!).result).toEqual({ from: "handler2" });
    });

    it("subscribeServerRequest(null) deregisters the handler → -32601", async () => {
      const { conn, transport, injectServerRequest } = createConnectionWithMock();
      await conn.connect();

      conn.subscribeServerRequest(vi.fn().mockResolvedValue({}));
      conn.subscribeServerRequest(null);

      injectServerRequest(77, "item/commandExecution/requestApproval", {});
      await new Promise((r) => setImmediate(r));

      const errReply = transport.sent.find((s) => {
        const msg = JSON.parse(s) as { id?: unknown; error?: unknown };
        return "error" in msg && msg.id === 77;
      });
      expect(errReply).toBeDefined();
      expect(JSON.parse(errReply!).error?.code).toBe(-32601);
    });
  });

  describe("close", () => {
    it("close() sets isConnected() to false", async () => {
      const { conn } = createConnectionWithMock();
      await conn.connect();
      expect(conn.isConnected()).toBe(true);

      await conn.close();
      expect(conn.isConnected()).toBe(false);
    });

    it("in-flight requests are rejected when close() is called", async () => {
      const { conn } = createConnectionWithMock();
      await conn.connect();

      const reqP = conn.request("slow/method", {});
      await conn.close();

      await expect(reqP).rejects.toThrow();
    });

    it("close() is idempotent", async () => {
      const { conn } = createConnectionWithMock();
      await conn.connect();
      await conn.close();
      await expect(conn.close()).resolves.toBeUndefined();
    });
  });

  describe("connect() failure", () => {
    it("rejects request() if factory throws", async () => {
      const { conn } = createConnectionWithMock({ factoryError: new Error("spawn failed") });
      await expect(conn.request("ping")).rejects.toThrow(/spawn failed/);
    });

    it("after factory throws, subsequent connect() retries", async () => {
      let failOnce = true;
      const factory = vi.fn(async (): Promise<CodexClient> => {
        if (failOnce) {
          failOnce = false;
          throw new Error("first attempt failed");
        }
        return {
          request: async () => undefined,
          notify: () => undefined,
          close: async () => undefined,
          getInitializeResponse: () =>
            ({}) as import("./types/InitializeResponse.js").InitializeResponse,
        } as unknown as CodexClient;
      });
      const conn = new CodexConnection({ _clientFactory: factory });

      await expect(conn.connect()).rejects.toThrow(/first attempt/);
      // Second attempt should succeed
      await expect(conn.connect()).resolves.toBeDefined();
    });
  });

  describe("account property", () => {
    it("returns the same AccountManager instance on repeated access", () => {
      const { conn } = createConnectionWithMock();
      expect(conn.account).toBe(conn.account);
    });

    it("account.readState() routes through connection.request()", async () => {
      const { conn, transport } = createConnectionWithMock();

      const readP = conn.account.readState();
      await new Promise((r) => setImmediate(r));

      // Should have sent a request to the transport
      expect(transport.sent.length).toBeGreaterThan(0);
      const sent = JSON.parse(transport.sent[0]!);
      expect(sent.method).toBe("account/read");

      transport.inject({
        jsonrpc: "2.0",
        id: sent.id,
        result: {
          account: { type: "chatgpt", email: "u@example.com", planType: "plus" },
          requiresOpenaiAuth: false,
        },
      });

      const state = await readP;
      expect(state.kind).toBe("authenticated");
    });
  });
});
