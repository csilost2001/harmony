/**
 * AI (MCP) に許す操作の範囲。環境変数で絞れる (未設定なら、すべての tool を使える)。
 *
 * - HARMONY_MCP_MODE=readonly   読み取りの tool だけを使える (設計を読む・点検する用途。書き込み・削除・改名・保存はできない)
 * - HARMONY_MCP_DENY=a,b        使わせない tool の名前 (`designer__` は省略できる。例: `remove_table,rename_entity`)
 *
 * 使えない tool は、一覧 (tools/list) にも出さず、呼ばれても拒否する。読み取り専用で通すのは、許可リスト (READ_ONLY_TOOLS) の tool だけ。仕様: docs/spec/server-security.md
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

/**
 * 読み取りだけで、データを変えない tool (許可リスト)。名前の規則 (`get_` で始まる など) では決めない:
 * 将来、`get_` で始まる書き込みの tool が増えても、読み取り専用の環境で通ってしまわないように、足すときに 1 件ずつ中身を確かめて、ここへ足す。
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "designer__analyze_design", "designer__check_design", "designer__get_project_context", "designer__list_designs", "designer__get_design", "designer__get_conventions", "designer__get_tech_stack", "designer__search_design", "designer__list_steps", "designer__get_step", "designer__get_flow_story", "designer__analyze_branches", "designer__validate_design", "designer__get_changes_since", "designer__compare_workspaces", "designer__get_design_document", "designer__get_tool_guide", "designer__get_generation_brief", "designer__check_test_coverage", "designer__check_screen_item_refs", "designer__export_openapi", "designer__generate_test_data", "designer__export_arazzo", "designer__export_spec",
  "designer__find_all_markers", "designer__find_references", "designer__generate_ddl", "designer__generate_er_mermaid",
  "designer__get_business_flow", "designer__get_er_diagram", "designer__get_extension_package", "designer__get_flow", "designer__get_page_layout",
  "designer__get_process_flow", "designer__get_rename_context", "designer__get_report", "designer__get_response_type_extension",
  "designer__get_screen_layout", "designer__get_table", "designer__get_test_viewpoints",
  "designer__list_business_flows", "designer__list_extension_packages", "designer__list_extensions", "designer__list_layout_components",
  "designer__list_markers", "designer__list_page_layouts", "designer__list_process_flows", "designer__list_reports",
  "designer__list_response_type_extensions", "designer__list_screens", "designer__list_tables", "designer__list_tabs", "designer__list_versions",
  "designer__check_generation_drift", "designer__get_regeneration_diff", "designer__list_review_comments",
  "designer__workspace_inspect", "designer__workspace_list", "designer__workspace_status",
  // 作業するワークスペースの切り替え (データは変えない。init: true の新規作成だけは、isToolAllowed で除く)
  "designer__workspace_open", "designer__workspace_close",
  // 画面 (ブラウザ) のタブ・移動の操作。設計のデータは変えない
  "designer__open_tab", "designer__close_tab", "designer__switch_tab", "designer__navigate_screen",
  "editSession__list", "editSession__fetch_payload",
]);
export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
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
