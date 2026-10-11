/** サーバに繋がっていないために失敗した操作か (mcpBridge.request の失敗理由) */
export function isConnectionError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return message.includes("wsBridge に接続されていません") || message.includes("WebSocket が切断されました");
}
