import type { JsonRpcTransport } from "./transport.js";

export type RequestId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponseSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: RequestId;
  result: T;
}

export interface JsonRpcResponseError {
  jsonrpc: "2.0";
  id: RequestId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<T = unknown> = JsonRpcResponseSuccess<T> | JsonRpcResponseError;

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

export interface JsonRpcClientOptions {
  transport: JsonRpcTransport;
  onNotification?: (notification: JsonRpcNotification) => void;
  onServerRequest?: (request: JsonRpcRequest) => Promise<unknown> | unknown;
  onParseError?: (raw: string, error: Error) => void;
  serverRequestUnhandled?: "error" | "ignore";
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

let monoId = 0;
function nextId(): number {
  monoId = (monoId + 1) & 0x7fffffff;
  return monoId;
}

export class JsonRpcClient {
  private readonly transport: JsonRpcTransport;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly onNotification?: (n: JsonRpcNotification) => void;
  private readonly onServerRequest?: (r: JsonRpcRequest) => Promise<unknown> | unknown;
  private readonly onParseError?: (raw: string, err: Error) => void;
  private readonly serverRequestUnhandled: "error" | "ignore";
  private didClose = false;

  constructor(options: JsonRpcClientOptions) {
    this.transport = options.transport;
    this.onNotification = options.onNotification;
    this.onServerRequest = options.onServerRequest;
    this.onParseError = options.onParseError;
    this.serverRequestUnhandled = options.serverRequestUnhandled ?? "error";
    this.transport.on("message", this.handleMessage);
    this.transport.on("close", this.handleClose);
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<T> {
    if (this.didClose) return Promise.reject(new Error("JsonRpcClient: closed"));
    const id = nextId();
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      if (opts?.signal) {
        if (opts.signal.aborted) {
          reject(opts.signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }
        const abortHandler = () => {
          this.pending.delete(id);
          reject(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        opts.signal.addEventListener("abort", abortHandler, { once: true });
        pending.signal = opts.signal;
        pending.abortHandler = abortHandler;
      }
      this.pending.set(id, pending);
      try {
        this.transport.send(JSON.stringify(message));
      } catch (err) {
        this.pending.delete(id);
        if (pending.signal && pending.abortHandler) {
          pending.signal.removeEventListener("abort", pending.abortHandler);
        }
        reject(err);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.didClose) throw new Error("JsonRpcClient: closed");
    const message: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.transport.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.didClose) return;
    this.didClose = true;
    const closeError = new Error("JsonRpcClient: closed");
    for (const [, p] of this.pending) {
      if (p.signal && p.abortHandler) p.signal.removeEventListener("abort", p.abortHandler);
      p.reject(closeError);
    }
    this.pending.clear();
    await this.transport.close();
  }

  private handleMessage = (raw: string): void => {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw) as JsonRpcMessage;
    } catch (err) {
      this.onParseError?.(raw, err as Error);
      return;
    }
    if (typeof msg !== "object" || msg === null || (msg as { jsonrpc?: string }).jsonrpc !== "2.0") {
      this.onParseError?.(raw, new Error("Missing jsonrpc:2.0 field"));
      return;
    }
    const hasId = "id" in msg && msg.id !== undefined && msg.id !== null;
    const hasMethod = "method" in msg;
    if (hasId && hasMethod) {
      void this.handleServerRequest(msg as JsonRpcRequest);
    } else if (hasId) {
      this.handleResponse(msg as JsonRpcResponse);
    } else if (hasMethod) {
      this.onNotification?.(msg as JsonRpcNotification);
    } else {
      this.onParseError?.(raw, new Error("Unrecognized JSON-RPC frame"));
    }
  };

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener("abort", pending.abortHandler);
    }
    if ("error" in response) {
      pending.reject(
        new JsonRpcError(response.error.code, response.error.message, response.error.data),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    if (!this.onServerRequest) {
      if (this.serverRequestUnhandled === "ignore") return;
      this.sendError(request.id, -32601, `Method not found: ${request.method}`);
      return;
    }
    try {
      const result = await this.onServerRequest(request);
      const response: JsonRpcResponseSuccess = {
        jsonrpc: "2.0",
        id: request.id,
        result,
      };
      this.transport.send(JSON.stringify(response));
    } catch (err) {
      if (err instanceof JsonRpcError) {
        this.sendError(request.id, err.code, err.message, err.data);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.sendError(request.id, -32000, message);
      }
    }
  }

  private sendError(id: RequestId, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponseError = {
      jsonrpc: "2.0",
      id,
      error: { code, message, data },
    };
    this.transport.send(JSON.stringify(response));
  }

  private handleClose = (): void => {
    if (this.didClose) return;
    this.didClose = true;
    const err = new Error("transport closed");
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  };
}
