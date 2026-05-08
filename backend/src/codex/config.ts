import type { StdioTransportOptions, WebSocketTransportOptions } from "./transport.js";

export type CodexTransportKind = "spawn" | "websocket";

export interface CodexConfig {
  transport: CodexTransportKind;
  spawn: Required<Pick<StdioTransportOptions, "command" | "args">>;
  websocket: WebSocketTransportOptions | null;
}

const DEFAULT_COMMAND = "codex";
const DEFAULT_ARGS = ["app-server"];

export function loadCodexConfig(env: NodeJS.ProcessEnv = process.env): CodexConfig {
  const kindRaw = (env.HARMONY_CODEX_TRANSPORT ?? "spawn").toLowerCase();
  const transport: CodexTransportKind =
    kindRaw === "websocket" || kindRaw === "ws" ? "websocket" : "spawn";

  const command = env.HARMONY_CODEX_SPAWN_COMMAND ?? DEFAULT_COMMAND;
  const args = env.HARMONY_CODEX_SPAWN_ARGS
    ? env.HARMONY_CODEX_SPAWN_ARGS.split(/\s+/).filter(Boolean)
    : [...DEFAULT_ARGS];

  const wsUrl = env.HARMONY_CODEX_WS_URL;
  const wsToken = env.HARMONY_CODEX_WS_AUTH_TOKEN;

  const websocket: WebSocketTransportOptions | null = wsUrl
    ? { url: wsUrl, ...(wsToken ? { authToken: wsToken } : {}) }
    : null;

  return {
    transport,
    spawn: { command, args },
    websocket,
  };
}
