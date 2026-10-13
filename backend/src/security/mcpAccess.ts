/**
 * AI (MCP) に許す操作の範囲。環境変数で絞れる (未設定なら、すべての tool を使える)。
 *
 * - HARMONY_MCP_MODE=readonly   読み取りの tool だけを使える (設計を読む・点検する用途。書き込み・削除・改名・保存はできない)
 * - HARMONY_MCP_DENY=a,b        使わせない tool の名前 (`designer__` は省略できる。例: `remove_table,rename_entity`)
 *
 * 使えない tool は、一覧 (tools/list) にも出さず、呼ばれても拒否する。仕様: docs/spec/server-security.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export type McpMode = "full" | "readonly";

export function currentMcpMode(env: NodeJS.ProcessEnv = process.env): McpMode {
  return env.HARMONY_MCP_MODE?.trim().toLowerCase() === "readonly" ? "readonly" : "full";
}

/** 拒否する tool の名前 (`designer__` 付きに揃えたもの) */
export function deniedTools(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.HARMONY_MCP_DENY ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => (s.includes("__") ? s : `designer__${s}`)));
}

/** 読み取りだけで、データを変えない tool か (名前の規則 + 明示した例外) */
const READ_NAME = /^designer__(list|get|find|check|generate|export)_/;
const READ_EXACT = new Set([
  "designer__workspace_list", "designer__workspace_status", "designer__workspace_inspect",
  // 作業するワークスペースの切り替え (データは変えない。init: true の新規作成だけは、isToolAllowed で除く)
  "designer__workspace_open", "designer__workspace_close",
  // 画面 (ブラウザ) のタブ・移動の操作。設計のデータは変えない
  "designer__open_tab", "designer__close_tab", "designer__switch_tab", "designer__navigate_screen",
  "editSession__list", "editSession__fetch_payload",
]);
export function isReadOnlyTool(name: string): boolean {
  return READ_EXACT.has(name) || READ_NAME.test(name);
}

export function isToolAllowed(name: string, env: NodeJS.ProcessEnv = process.env, args?: Record<string, unknown>): boolean {
  if (deniedTools(env).has(name)) return false;
  if (currentMcpMode(env) === "readonly") {
    if (!isReadOnlyTool(name)) return false;
    // ワークスペースを開くだけなら読み取り。新規に作る (init: true) のは書き込み
    if (name === "designer__workspace_open" && args?.init === true) return false;
  }
  return true;
}

/** 使えない tool なら、理由つきで拒否する */
export function assertToolAllowed(name: string, env: NodeJS.ProcessEnv = process.env, args?: Record<string, unknown>): void {
  if (isToolAllowed(name, env, args)) return;
  const why = deniedTools(env).has(name) ? "この環境では使わせない設定 (HARMONY_MCP_DENY) です" : "この環境は読み取り専用 (HARMONY_MCP_MODE=readonly) のため、書き込みの tool は使えません";
  throw new McpError(ErrorCode.InvalidRequest, `${name} は使えません: ${why}`);
}

/** tools/list に出す tool (使えないものを除く) */
export function filterTools<T extends { name: string }>(tools: readonly T[], env: NodeJS.ProcessEnv = process.env): T[] {
  return tools.filter((t) => isToolAllowed(t.name, env));
}
