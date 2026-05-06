/**
 * e2e テスト用ワークスペース定数とヘルパー (#703 R-5)
 *
 * MCP オフライン時のテストで使う固定 wsId。
 * AppShell の error-state fallback (/w/:wsId/* に goto すると
 * workspaceState.error が設定されてリダイレクトが停止し、
 * localStorage fallback でコンテンツが表示される) を利用する。
 */
import type { Page } from "@playwright/test";

/** e2e テスト専用の固定 workspace ID */
export const E2E_WS_ID = "00000000-e2e0-4000-8000-000000000000";

/**
 * `/w/<E2E_WS_ID>/<path>` の URL を生成する。
 * MCP オフライン e2e テストでのリダイレクト回避に使う。
 */
export function wsPath(path: string): string {
  return `/w/${E2E_WS_ID}${path.startsWith("/") ? path : "/" + path}`;
}

/**
 * MCP WebSocket 接続を無効化する initScript を追加する。
 * port 5179 への WebSocket 接続を即座に close させることで、
 * workspaceStore が error 状態になり localStorage fallback が有効になる。
 *
 * 既存の e2e テスト (localStorage 設定ベース) がワークスペース選択画面に
 * リダイレクトされないようにするため使う。
 */
export async function disableMcpConnection(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // WebSocket を override して port 5179 への接続を即失敗させる
    const OriginalWebSocket = window.WebSocket;
    // @ts-ignore
    window.WebSocket = function(url: string, protocols?: string | string[]) {
      if (typeof url === "string" && url.includes(":5179")) {
        // MCP ポートへの接続: 即座に close するダミー WS を返す
        // new EventTarget() を使う (Object.create では addEventListener が "Illegal invocation" になる)
        const dummy = new EventTarget() as unknown as WebSocket;
        Object.defineProperty(dummy, "readyState", { get: () => 3 /* CLOSED */ });
        Object.defineProperty(dummy, "send", { value: () => {} });
        Object.defineProperty(dummy, "close", { value: () => {} });
        Object.defineProperty(dummy, "binaryType", { value: "blob", writable: true });
        Object.defineProperty(dummy, "bufferedAmount", { value: 0 });
        Object.defineProperty(dummy, "extensions", { value: "" });
        Object.defineProperty(dummy, "protocol", { value: "" });
        Object.defineProperty(dummy, "url", { value: url });
        Object.defineProperty(dummy, "onopen", { value: null, writable: true });
        Object.defineProperty(dummy, "onclose", { value: null, writable: true });
        Object.defineProperty(dummy, "onmessage", { value: null, writable: true });
        Object.defineProperty(dummy, "onerror", { value: null, writable: true });
        // 接続を即 close (close を非同期で発火)
        setTimeout(() => {
          const closeEvent = new CloseEvent("close", { code: 1006, reason: "test-disabled", wasClean: false });
          dummy.dispatchEvent(closeEvent);
        }, 0);
        return dummy;
      }
      // @ts-ignore
      return new OriginalWebSocket(url, protocols);
    };
    // @ts-ignore
    window.WebSocket.CONNECTING = 0;
    // @ts-ignore
    window.WebSocket.OPEN = 1;
    // @ts-ignore
    window.WebSocket.CLOSING = 2;
    // @ts-ignore
    window.WebSocket.CLOSED = 3;
    // @ts-ignore
    window.WebSocket.prototype = OriginalWebSocket.prototype;
  });
}
