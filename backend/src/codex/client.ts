import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { JsonRpcClient, JsonRpcError } from "./jsonRpc.js";
import {
  JsonRpcTransport,
  StdioTransport,
  WebSocketTransport,
} from "./transport.js";
import { loadCodexConfig, type CodexConfig } from "./config.js";
import type { ClientInfo } from "./types/ClientInfo.js";
import type { InitializeCapabilities } from "./types/InitializeCapabilities.js";
import type { InitializeParams } from "./types/InitializeParams.js";
import type { InitializeResponse } from "./types/InitializeResponse.js";
import type { ServerNotification } from "./types/ServerNotification.js";
import type { ServerRequest } from "./types/ServerRequest.js";

export interface CodexClientOptions {
  config?: CodexConfig;
  clientInfo: ClientInfo;
  capabilities?: InitializeCapabilities;
  onNotification?: (notification: ServerNotification) => void;
  onServerRequest?: (request: ServerRequest) => Promise<unknown> | unknown;
  onError?: (err: Error) => void;
}

const OVERLOAD_ERROR_CODE = -32001;
const MAX_OVERLOAD_RETRIES = 4;

export class CodexClient {
  private readonly rpc: JsonRpcClient;
  private readonly transport: JsonRpcTransport;
  private readonly initializeResponse: InitializeResponse;
  private didInitialize = false;

  private constructor(
    transport: JsonRpcTransport,
    rpc: JsonRpcClient,
    initializeResponse: InitializeResponse,
  ) {
    this.transport = transport;
    this.rpc = rpc;
    this.initializeResponse = initializeResponse;
    this.didInitialize = true;
  }

  static async connect(options: CodexClientOptions): Promise<CodexClient> {
    const config = options.config ?? loadCodexConfig();
    const transport = await createTransport(config);
    if (options.onError) transport.on("error", options.onError);

    const rpc = new JsonRpcClient({
      transport,
      onNotification: (n) => {
        options.onNotification?.(n as unknown as ServerNotification);
      },
      onServerRequest: async (r) => {
        if (!options.onServerRequest) {
          throw new JsonRpcError(-32601, `No handler for server request: ${r.method}`);
        }
        return options.onServerRequest(r as unknown as ServerRequest);
      },
      onParseError: (raw, err) => {
        options.onError?.(
          new Error(
            `Codex JSON-RPC parse error: ${err.message}; raw=${raw.slice(0, 200)}`,
          ),
        );
      },
    });

    const params: InitializeParams = {
      clientInfo: options.clientInfo,
      capabilities: options.capabilities ?? null,
    };
    const initializeResponse = (await requestWithOverloadRetry(
      rpc,
      "initialize",
      params,
    )) as InitializeResponse;
    rpc.notify("initialized", undefined);

    return new CodexClient(transport, rpc, initializeResponse);
  }

  getInitializeResponse(): InitializeResponse {
    return this.initializeResponse;
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    opts?: { signal?: AbortSignal },
  ): Promise<T> {
    if (!this.didInitialize) {
      throw new Error("CodexClient.request called before initialize");
    }
    return requestWithOverloadRetry<T>(this.rpc, method, params, opts);
  }

  notify(method: string, params?: unknown): void {
    if (!this.didInitialize) {
      throw new Error("CodexClient.notify called before initialize");
    }
    this.rpc.notify(method, params);
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }
}

async function requestWithOverloadRetry<T>(
  rpc: JsonRpcClient,
  method: string,
  params: unknown,
  opts?: { signal?: AbortSignal },
  attempt = 1,
): Promise<T> {
  try {
    return await rpc.request<T>(method, params, opts);
  } catch (err) {
    if (
      err instanceof JsonRpcError &&
      err.code === OVERLOAD_ERROR_CODE &&
      attempt <= MAX_OVERLOAD_RETRIES
    ) {
      const backoff = Math.min(2 ** attempt * 250, 4000) + Math.random() * 250;
      await setTimeoutPromise(backoff);
      return requestWithOverloadRetry<T>(rpc, method, params, opts, attempt + 1);
    }
    throw err;
  }
}

async function createTransport(config: CodexConfig): Promise<JsonRpcTransport> {
  if (config.transport === "websocket") {
    if (!config.websocket) {
      throw new Error(
        "Codex transport=websocket but HARMONY_CODEX_WS_URL is unset. Configure URL or switch to spawn.",
      );
    }
    const ws = new WebSocketTransport(config.websocket);
    await ws.ready();
    return ws;
  }
  return new StdioTransport(config.spawn);
}
