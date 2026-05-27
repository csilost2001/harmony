import * as net from "net";
import WebSocketImpl from "ws";

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
 * ブラウザ役として wsBridge (ws://localhost:5179) にリクエストを送るヘルパー (#958)。
 *
 * #683 で per-session activePath を廃止した結果、 短命 WS + 都度 clientId 発行では
 * `workspace.open` 後の次 request で activePath が消える構造的問題があった。
 * 永続 WS + clientId 共有構造に書き直し:
 *   - 1 spec / 1 process で 1 つの WS connection を保持
 *   - 同一 connection で同一 clientId を保ち、 activePath を維持
 *   - `openBrowserSessionWorkspace` で初回 workspace.open を呼ぶ
 *   - reqId による response 多重化 (同時 in-flight に対応)
 *   - `closeBrowserSession` で afterAll cleanup
 *
 * `WebSocket` は Node 22+ で global だが、 Node 20 では未定義のため `ws` パッケージを使う。
 */

let _ws: WebSocketImpl | null = null;
let _clientId: string | null = null;
let _connectPromise: Promise<void> | null = null;
const _pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

async function ensureConnected(): Promise<void> {
  if (_ws && _ws.readyState === WebSocketImpl.OPEN) return;
  if (_connectPromise) return _connectPromise;
  _connectPromise = new Promise<void>((resolve, reject) => {
    const ws = new WebSocketImpl("ws://localhost:5179");
    const clientId = `test-client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "register", clientId }));
      _ws = ws;
      _clientId = clientId;
      resolve();
    });
    ws.on("error", (err) => {
      _connectPromise = null;
      reject(new Error(`WebSocket error: ${err.message}`));
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; id?: string; error?: string; result?: unknown };
        if (msg.type === "response" && typeof msg.id === "string") {
          const pending = _pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            _pendingRequests.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error));
            else pending.resolve(msg.result);
          }
        }
      } catch {
        /* 別メッセージは無視 */
      }
    });
    ws.on("close", () => {
      _ws = null;
      _clientId = null;
      _connectPromise = null;
      _pendingRequests.forEach(({ reject, timer }) => {
        clearTimeout(timer);
        reject(new Error("WebSocket closed"));
      });
      _pendingRequests.clear();
    });
  });
  return _connectPromise;
}

export async function sendBrowserRequest(method: string, params: unknown = {}): Promise<unknown> {
  await ensureConnected();
  const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingRequests.delete(reqId);
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 10000);
    _pendingRequests.set(reqId, { resolve, reject, timer });
    if (!_ws || _ws.readyState !== WebSocketImpl.OPEN) {
      clearTimeout(timer);
      _pendingRequests.delete(reqId);
      reject(new Error("WebSocket is not open"));
      return;
    }
    _ws.send(JSON.stringify({ type: "request", id: reqId, method, params }));
  });
}

/**
 * 永続 WS の clientId に対して workspace.open を発行し、 以降の request で
 * activePath が立った状態を維持する。 各 spec の beforeAll で呼ぶ想定。
 */
export async function openBrowserSessionWorkspace(workspacePath: string): Promise<void> {
  await ensureConnected();
  await sendBrowserRequest("workspace.open", { path: workspacePath });
}

/**
 * afterAll で WS を閉じる。 同一 process 内で複数 spec が走る場合、
 * 後続 spec が再接続するため close でも問題ない (lazy init)。
 */
export async function closeBrowserSession(): Promise<void> {
  if (_ws) {
    const ws = _ws;
    _ws = null;
    _clientId = null;
    _connectPromise = null;
    ws.close();
  }
}

export async function observeBroadcastDuring<T>(
  workspacePath: string,
  event: string,
  action: () => Promise<T>,
): Promise<{ result: T; broadcast: unknown }> {
  const observer = new WebSocketImpl("ws://localhost:5179");
  const observerClientId = `observer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const openReqId = `observer-open-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await new Promise<void>((resolve, reject) => {
    observer.on("open", () => {
      observer.send(JSON.stringify({ type: "register", clientId: observerClientId }));
      observer.send(JSON.stringify({ type: "request", id: openReqId, method: "workspace.open", params: { path: workspacePath } }));
    });
    observer.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { type?: string; id?: string; error?: string };
      if (msg.type === "response" && msg.id === openReqId) {
        if (msg.error) reject(new Error(msg.error));
        else resolve();
      }
    });
    observer.on("error", (err) => reject(new Error(`Observer WebSocket error: ${err.message}`)));
  });

  try {
    const broadcastPromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for broadcast ${event}`)), 10000);
      observer.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as { type?: string; event?: string; data?: unknown };
        if (msg.type === "broadcast" && msg.event === event) {
          clearTimeout(timer);
          resolve(msg.data);
        }
      });
    });
    const [result, broadcast] = await Promise.all([action(), broadcastPromise]);
    return { result, broadcast };
  } finally {
    observer.close();
  }
}
