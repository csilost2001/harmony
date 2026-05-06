/**
 * defaultPaths.ts (#755)
 *
 * デフォルトのワークスペース作成先ディレクトリを解決するユーティリティ。
 *
 * - getDefaultWorkspacesDir(): リポジトリルートからの相対 workspaces/ ディレクトリの絶対パスを返す
 *   - 環境変数 DESIGNER_WORKSPACES_DIR が設定されている場合はその値を優先 (CI / VS Code 拡張用)
 *   - それ以外は process.cwd() 起点で解決 (backend は <repo>/backend/ から起動するため
 *     ../workspaces/ がリポジトリルートの workspaces/ になる)
 */
import path from "node:path";

/**
 * デフォルトのワークスペースディレクトリ (絶対パス) を返す。
 *
 * 優先順位:
 * 1. 環境変数 DESIGNER_WORKSPACES_DIR が設定されていればその絶対パス
 * 2. process.cwd() の親ディレクトリ (リポジトリルート相当) 配下の workspaces/
 *
 * 開発環境前提: backend の cwd は `<repo>/backend/` なので
 * `path.resolve(process.cwd(), "..", "workspaces")` がリポジトリルートの workspaces/ になる。
 */
export function getDefaultWorkspacesDir(): string {
  const envOverride = process.env.DESIGNER_WORKSPACES_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return path.resolve(envOverride.trim());
  }
  // backend は <repo>/backend/ で起動する前提。
  // cwd が repo root 直下の場合 (例: CI で `node backend/dist/index.js` を実行) にも
  // workspaces/ フォルダは repo root 配下なので、両方の起動パターンに対応するため
  // cwd に workspaces/ ディレクトリが直接あるかチェックするロジックは不要 — 常に ../workspaces/ を使う。
  // (CI では DESIGNER_WORKSPACES_DIR を設定して上書きする)
  return path.resolve(process.cwd(), "..", "workspaces");
}
