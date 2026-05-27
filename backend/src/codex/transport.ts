import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

export type TransportCloseReason =
  | { kind: "remote"; code?: number; signal?: string; reason?: string }
  | { kind: "local" };

export interface TransportEventMap {
  message: [string];
  close: [TransportCloseReason];
  error: [Error];
}

/**
 * close() 呼出し時の動作オプション (#1400)。
 *
 * shutdown context (Ctrl+C 等) では graceful 5s/10s を待つ余裕がないため、
 * 短縮 timer を渡して即時 SIGTERM → SIGKILL する。通常 close は default 値で
 * graceful 終了。
 */
export interface CloseOptions {
  /** SIGTERM を撃つまでの遅延 ms (default: 5000) */
  sigtermDelayMs?: number;
  /** SIGKILL を撃つまでの遅延 ms (default: 10000) */
  sigkillDelayMs?: number;
}

export abstract class JsonRpcTransport extends EventEmitter<TransportEventMap> {
  abstract send(message: string): void;
  abstract close(opts?: CloseOptions): Promise<void>;
}

export interface StdioTransportOptions {
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export class StdioTransport extends JsonRpcTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private didClose = false;

  constructor(options: StdioTransportOptions = {}) {
    super();
    const command = options.command ?? "codex";
    const args = options.args ?? ["app-server"];
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? process.env,
      cwd: options.cwd,
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.emit("error", new Error(`codex stderr: ${chunk.trimEnd()}`));
    });
    this.child.on("exit", (code, signal) => {
      if (this.didClose) return;
      this.didClose = true;
      this.emit("close", { kind: "remote", code: code ?? undefined, signal: signal ?? undefined });
    });
    this.child.on("error", (err) => {
      this.emit("error", err);
    });
  }

  send(message: string): void {
    if (this.didClose) throw new Error("StdioTransport: send after close");
    if (!this.child.stdin.writable) throw new Error("StdioTransport: stdin not writable");
    this.child.stdin.write(message + "\n");
  }

  async close(opts?: CloseOptions): Promise<void> {
    if (this.didClose) return;
    this.didClose = true;
    const sigtermMs = opts?.sigtermDelayMs ?? 5000;
    const sigkillMs = opts?.sigkillDelayMs ?? 10000;
    return new Promise<void>((resolve) => {
      this.child.once("exit", () => resolve());
      this.child.stdin.end();
      setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill("SIGTERM");
      }, sigtermMs).unref();
      setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill("SIGKILL");
      }, sigkillMs).unref();
      this.emit("close", { kind: "local" });
    });
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    let newlineIdx = this.buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trimEnd();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) this.emit("message", line);
      newlineIdx = this.buffer.indexOf("\n");
    }
  }
}

export interface WebSocketTransportOptions {
  url: string;
  headers?: Record<string, string>;
  authToken?: string;
}

export class WebSocketTransport extends JsonRpcTransport {
  private readonly ws: WebSocket;
  private didClose = false;

  constructor(options: WebSocketTransportOptions) {
    super();
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
    this.ws = new WebSocket(options.url, { headers });
    this.ws.on("message", (data) => {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
      this.emit("message", text);
    });
    this.ws.on("close", (code, reason) => {
      if (this.didClose) return;
      this.didClose = true;
      this.emit("close", { kind: "remote", code, reason: reason.toString() });
    });
    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  send(message: string): void {
    if (this.didClose) throw new Error("WebSocketTransport: send after close");
    this.ws.send(message);
  }

  async close(_opts?: CloseOptions): Promise<void> {
    // WebSocketTransport は child process を持たないため CloseOptions は無視 (受け取りのみ、interface 準拠)
    if (this.didClose) return;
    this.didClose = true;
    return new Promise<void>((resolve) => {
      this.ws.once("close", () => resolve());
      this.ws.close(1000, "client closing");
      this.emit("close", { kind: "local" });
    });
  }

  ready(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.ws.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.ws.off("open", onOpen);
        reject(err);
      };
      this.ws.once("open", onOpen);
      this.ws.once("error", onError);
    });
  }
}
