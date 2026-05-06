import * as net from "net";

/**
 * backend サーバが port 5179 で起動しているかを確認する。
 * 起動していなければ test.skip() を呼び出す側で利用。
 */
export async function isMcpRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.connect(5179, "127.0.0.1", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => resolve(false));
  });
}

/**
 * ブラウザ役として wsBridge (ws://localhost:5179) にリクエストを送るヘルパー。
 * `register` (clientId) → `request` (method/params) の順でメッセージを送り、
 * 同じ id の `response` が返るのを待つ。10 秒でタイムアウト。
 */
export function sendBrowserRequest(method: string, params: unknown = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:5179");
    const clientId = `test-client-${Date.now()}`;
    const reqId = `req-${Date.now()}`;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 10000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "register", clientId }));
      ws.send(JSON.stringify({ type: "request", id: reqId, method, params }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "response" && msg.id === reqId) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      } catch { /* 別メッセージは無視 */ }
    };

    ws.onerror = () => reject(new Error("WebSocket error"));
  });
}
