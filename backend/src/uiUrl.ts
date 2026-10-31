/**
 * いま動いている Harmony の画面の URL (ブラウザで開いてもらうときの案内用。#1591)。
 *
 * - backend が画面も配る構成 (配布の Docker image・sidecar。HARMONY_STATIC_DIR にビルド済みの画面がある): backend のポート (既定 5179)
 * - それ以外 (開発。画面は Vite の開発サーバが配る): 5173
 * 環境変数 HARMONY_UI_URL があればそれを使う (上の見分けが当たらない構成の逃げ道)。
 */
export function harmonyUiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HARMONY_UI_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  if (env.HARMONY_STATIC_DIR) return `http://localhost:${env.DESIGNER_MCP_PORT ?? "5179"}`;
  return "http://localhost:5173";
}

/** ブラウザが無いときのエラー文。reason = その tool がブラウザを要する理由 */
export function browserRequiredMessage(reason?: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = harmonyUiUrl(env);
  return `デザイナーがブラウザで開かれていません。${url} を開いてください${reason ? ` (${reason})` : ""}`;
}
