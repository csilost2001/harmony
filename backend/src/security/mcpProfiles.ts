/**
 * AI (MCP) に見せる tool の絞り込み (プロファイル)。
 *
 * tool は 100 個を超え、説明が毎回すべて AI の文脈に載る。作業の種類ごとに必要な tool だけを見せると、AI は選び間違えにくく、読む量も減る。
 * これは**権限の仕組みではない** (権限は mcpAccess.ts の HARMONY_MCP_MODE / HARMONY_MCP_DENY)。両方が掛かる。
 *
 * - 指定: 接続の URL `http://localhost:5179/mcp?profile=flow` (カンマ区切りで複数: `?profile=flow,table`)、または環境変数 HARMONY_MCP_PROFILE (URL が優先)
 * - 未指定 / `full`: すべての tool
 * - 絞った接続は、一覧に出ない tool を呼んでも断る (名前を知っていても使えない。何を見せているかを、AI と利用者が同じに保つため)
 *
 * 仕様: docs/spec/server-security.md
 */
import { isReadOnlyTool } from "./mcpAccess.js";

/** 読み取りだけのプロファイルか (read / review)。ワークスペースの新規作成 (workspace_open の init: true) は、この接続では断る */
const READ_LIKE = new Set(["read", "review"]);

export interface McpProfile {
  label: string;
  /** 共通の土台 (どの作業でも使う tool) に加えて見せる tool の名前の規則。名前 (`designer__` を除く) に対する正規表現 */
  patterns: RegExp[];
  /** 読み取りの tool をすべて足す */
  allReadOnly?: boolean;
  /** マーカーの書き込み (付ける・解決・削除) を含めない。読むだけのプロファイル用 */
  noMarkerWrites?: boolean;
}

/** どのプロファイルにも入る土台: ワークスペース・設計の俯瞰と点検・参照元・マーカーを読む・版・タブ (読み取りだけ) */
const BASE: RegExp[] = [
  /^workspace_(list|status|open|inspect|close)$/, /^get_project_context$/, /^check_design$/, /^analyze_design$/, /^find_references$/,
  /^(find_all_markers|list_markers)$/, /^list_versions$/, /^(list_tabs|open_tab|switch_tab|close_tab|navigate_screen)$/,
];
/** 設計を作る・直すプロファイル (flow / table / screen / doc) に共通の操作: 生成の記録・改名・参照の付け替え・版を戻す */
const AUTHORING: RegExp[] = [/^record_generation$/, /^(rename_entity|undo_rename|replace_references|undo_replace_references|restore_version)$/];

/** 書き込みのプロファイルに足すマーカーの操作 (人の指示・質問に答える) */
const MARKER_WRITES: RegExp[] = [/^(add_marker|resolve_marker|remove_marker)$/];

export const PROFILES: Readonly<Record<string, McpProfile>> = {
  read: { label: "設計を読む・点検する (書き込みなし)", patterns: [], allReadOnly: true, noMarkerWrites: true },
  review: {
    label: "レビュー (読む + 指摘・コメント・マーカー)",
    patterns: [/^add_review_findings$/, /^list_review_comments$/],
    allReadOnly: true,
  },
  flow: {
    label: "処理フローを作る・直す",
    patterns: [
      /process_flow/, /^add_action$/, /_step$/, /^(move|nest)_step$/, /^add_step_note$/, /^set_maturity$/, /^get_test_viewpoints$/, /^get_rename_context$/,
      /^(list_screens|get_screen_layout|list_tables|get_table|list_extensions|get_extension_package)$/, /^editSession__/, ...AUTHORING,
    ],
  },
  table: {
    label: "テーブルを作る・直す",
    patterns: [/_tables?$/, /^generate_(ddl|er_mermaid|test_data)$/, /^get_er_diagram$/, /^set_maturity$/, /^get_rename_context$/, /^editSession__/, ...AUTHORING],
  },
  screen: {
    label: "画面・画面項目・ページレイアウトを作る・直す",
    patterns: [
      /_screens?$/, /screen_layout/, /screen_item/, /^check_screen_item_refs$/, /layout_component/, /page_layout/, /_edge$/, /^get_flow$/, /^set_maturity$/,
      /^get_rename_context$/, /^(list_tables|get_table|list_process_flows|get_process_flow)$/, /^editSession__/, ...AUTHORING,
    ],
  },
  doc: {
    label: "業務フロー・帳票・拡張を作る・直す",
    patterns: [/business_flow/, /_reports?$/, /response_type_extension/, /^set_maturity$/, /^get_rename_context$/, /^editSession__/, /^(list_extensions|get_extension_package|list_extension_packages)$/, /^add_.*_extension$/, /^(remove_extension|add_catalog_entry|remove_catalog_entry)$/, /^(list_screens|list_tables|list_process_flows)$/, ...AUTHORING],
  },
  maint: {
    label: "保守: 一括保存・版の復旧・登録簿の修復・スキーマ移行・パック・ワークスペースの削除",
    patterns: [/^(save_all|restore_version|repair_registry|persist_uuids|migrate_schema|apply_rename_mapping|solution_pack|solution_unpack|workspace_remove)$/, /^(check_generation_drift|get_regeneration_diff|record_generation)$/],
  },
};

export const PROFILE_NAMES = ["full", ...Object.keys(PROFILES)];

const bare = (name: string) => name.replace(/^designer__/, "");

/** `flow,table` や `full` を、プロファイル名の並びにする。知らない名前は unknown に分ける。`full` が含まれる・空なら、絞らない (names は空) */
export function parseProfiles(raw: string | null | undefined): { names: string[]; unknown: string[] } {
  const all = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = all.filter((n) => !PROFILE_NAMES.includes(n));
  const known = all.filter((n) => PROFILE_NAMES.includes(n));
  return { names: known.includes("full") ? [] : [...new Set(known)], unknown };
}

/** 接続の URL (`?profile=`) か環境変数 (HARMONY_MCP_PROFILE) から。URL が優先 */
export function profilesFromRequest(url: string | undefined, env: NodeJS.ProcessEnv = process.env): { names: string[]; unknown: string[] } {
  let fromUrl: string | null = null;
  try { fromUrl = new URL(url ?? "/", "http://localhost").searchParams.get("profile"); } catch { /* URL が読めなければ、環境変数 */ }
  return parseProfiles(fromUrl?.trim() ? fromUrl : env.HARMONY_MCP_PROFILE);
}

/** その tool が、選んだプロファイル (の和) に入っているか。プロファイルが空なら、すべて */
export function isInProfile(toolName: string, names: readonly string[]): boolean {
  if (names.length === 0) return true;
  const n = bare(toolName);
  return names.some((p) => {
    const prof = PROFILES[p];
    if (!prof) return false;
    if (prof.allReadOnly && isReadOnlyTool(toolName)) return true;
    return [...BASE, ...(prof.noMarkerWrites ? [] : MARKER_WRITES), ...prof.patterns].some((re) => re.test(n));
  });
}

/**
 * 呼び出しの引数まで見て断る理由 (なければ null)。read / review だけの接続は、ワークスペースの新規作成 (workspace_open の init: true) を断る
 * (workspace_open は読み取りの tool だが、init: true はフォルダと harmony.json を作る)。
 */
export function profileRefusal(toolName: string, args: Record<string, unknown> | undefined, names: readonly string[]): string | null {
  if (names.length === 0 || !names.every((n) => READ_LIKE.has(n))) return null;
  if (toolName === "designer__workspace_open" && args?.init === true) return `この接続のプロファイル (${names.join(", ")}) は読み取りだけのため、ワークスペースの新規作成 (init: true) はできません`;
  return null;
}

export function filterToolsByProfile<T extends { name: string }>(tools: readonly T[], names: readonly string[]): T[] {
  return tools.filter((t) => isInProfile(t.name, names));
}
