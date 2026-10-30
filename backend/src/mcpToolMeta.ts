/**
 * MCP の tool の周辺情報: 注釈 (読み取り専用・破壊的・冪等)・短い説明 (brief)・エラーの「直し方」。
 *
 * - 注釈: 権限の確認 (「読むだけの tool は聞かずに許可」など) を、AI の実行環境が自動でできるようにする。MCP の `annotations`
 * - brief: tool の説明は毎回 AI の文脈に載る。`?detail=brief` で、説明を最初の 1 文にし、引数の説明を省く (詳細は designer__get_tool_guide)
 * - 直し方: エラーの文に「次に何をすればよいか」を添える (id の形・一覧の tool・保存前の検証)
 * 仕様: docs/spec/server-security.md / docs/spec/mcp-design-access.md
 */
import { isReadOnlyTool } from "./security/mcpAccess.js";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  /** 外部 (GitHub など) へ問い合わせる tool は true */
  openWorldHint: boolean;
}

const bare = (name: string) => name.replace(/^designer__/, "");

/** 新しい設計・工程・マーカーを足すだけの書き込み (既存のものを消さない・書き換えない) */
const ADDITIVE = /^(add_(marker|review_findings|screen|table|process_flow|page_layout|action|step|step_note|edge)|record_generation|report_confusion|solution_pack|resolve_marker|editSession__(create|attach_as_view|set_role))$/;
/** 同じ引数で 2 回呼んでも、結果が変わらない書き込み */
const IDEMPOTENT = /^(save_[a-z_]+|update_[a-z_]+|set_[a-z_]+|delete_[a-z_]+|remove_[a-z_]+|restore_version|repair_registry|persist_uuids|resolve_marker|move_step|import_[a-z_]+|workspace_remove|editSession__(save|update|discard|detach|set_role))$/;
/**
 * 「設計のデータは変えない」ので読み取りの許可リストに入っているが、画面の表示・作業の状態は変える tool。
 * 注釈の readOnlyHint は「何も変えない」の意味なので、true にしない (「読むだけは確認なしで許可」の環境で、init: true の新規作成や force: true の破棄が通らないように)
 */
const UI_STATE_TOOLS = new Set(["designer__open_tab", "designer__close_tab", "designer__switch_tab", "designer__navigate_screen", "designer__workspace_open", "designer__workspace_close"]);

export function toolAnnotations(name: string): ToolAnnotations {
  if (name === "designer__check_harmony_update") return { readOnlyHint: true, openWorldHint: true };
  if (isReadOnlyTool(name) && !UI_STATE_TOOLS.has(name)) return { readOnlyHint: true, openWorldHint: false };
  const n = bare(name);
  if (UI_STATE_TOOLS.has(name)) {
    // 表示の切り替えは足すだけ・繰り返せる。タブを閉じる (force で未保存を捨てる) は破棄になり得る
    return { readOnlyHint: false, destructiveHint: name === "designer__close_tab" || name === "designer__workspace_close", idempotentHint: name !== "designer__close_tab", openWorldHint: false };
  }
  return { readOnlyHint: false, destructiveHint: !ADDITIVE.test(n), idempotentHint: IDEMPOTENT.test(n), openWorldHint: false };
}

interface ToolLike { name: string; description?: string; inputSchema?: unknown; [k: string]: unknown }

/** 説明の最初の 1 文 (。で区切る。括弧 ( ) （ ） の中の。は区切りにしない)。長ければ切る */
export function firstSentence(desc: string, max = 110): string {
  let depth = 0, end = -1;
  for (let i = 0; i < desc.length; i++) {
    const ch = desc[i];
    if (ch === "(" || ch === "（") depth++;
    else if ((ch === ")" || ch === "）") && depth > 0) depth--;
    else if (ch === "。" && depth === 0) { end = i; break; }
  }
  const s = (end >= 0 ? desc.slice(0, end + 1) : desc).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** brief でも説明を残す引数の名前: 保存するかどうか (apply) と、使い方が説明にしか書かれていない編集の並び (edits) */
const KEEP_DESCRIPTION = new Set(["apply", "edits"]);

/** 引数の説明 (description) を省いた inputSchema。型・必須・列挙は残す */
function stripParamDescriptions(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripParamDescriptions);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "description" && typeof v === "string") continue;
    out[k] = k === "properties" && v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, KEEP_DESCRIPTION.has(pk) && pv && typeof pv === "object" ? pv : stripParamDescriptions(pv)]))
      : stripParamDescriptions(v);
  }
  return out;
}

export function briefTool<T extends ToolLike>(t: T): T {
  const props = (t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  // 保存の既定が予行の tool は、「予行」を説明に残す (apply を付け忘れて、実行したつもりになるのを防ぐ)
  const preview = props && "apply" in props && /予行/.test(t.description ?? "") && !/予行/.test(firstSentence(t.description ?? "")) ? " 既定は予行 (apply: true で保存)。" : "";
  return { ...t, description: firstSentence(t.description ?? "") + preview, inputSchema: stripParamDescriptions(t.inputSchema) };
}

export const DETAIL_MODES = ["full", "brief"] as const;
export type DetailMode = (typeof DETAIL_MODES)[number];

/** 接続の URL (`?detail=`) か環境変数 (HARMONY_MCP_DETAIL) から。URL が優先。知らない値は unknown */
export function detailFromRequest(url: string | undefined, env: NodeJS.ProcessEnv = process.env): { mode: DetailMode; unknown?: string } {
  let fromUrl: string | null = null;
  try { fromUrl = new URL(url ?? "/", "http://localhost").searchParams.get("detail"); } catch { /* 環境変数 */ }
  const raw = (fromUrl?.trim() ? fromUrl : env.HARMONY_MCP_DETAIL ?? "").trim().toLowerCase();
  if (!raw) return { mode: "full" };
  return (DETAIL_MODES as readonly string[]).includes(raw) ? { mode: raw as DetailMode } : { mode: "full", unknown: raw };
}

// ─── エラーの直し方 ─────────────────────────────────────

const LIST_TOOL: Array<[RegExp, string]> = [
  [/処理フロー|processFlowId/, "designer__list_process_flows"], [/画面|screenId/, "designer__list_screens"], [/テーブル|tableId/, "designer__list_tables"],
  [/帳票|reportId/, "designer__list_reports"], [/業務フロー|businessFlowId/, "designer__list_business_flows"], [/ページレイアウト|pageLayoutId/, "designer__list_page_layouts"],
  [/工程|アクション|stepId|actionId/, "designer__list_steps (工程の id) / designer__get_process_flow (アクションの id)"],
  [/シーケンス|ビュー定義|ビュー|汎用定義|sequence|viewDefinition|genericDefinition/, "designer__list_designs"],
];

/** 「見つかりません」でも、設計の id とは関係のないもの (環境・履歴・通知など) には、一覧の案内を付けない */
const NOT_A_DESIGN_ID = /git|harmony\.json|Undo|取り消せる|通知先|スレッド|版 |履歴|ファイル|コマンド/;

/** エラーの文に添える「直し方」。当てはまるものがなければ null */
export function errorHint(message: string): string | null {
  if (/直し方|designer__[a-z_]+ で|designer__[a-z_]+\)/.test(message)) return null; // すでに案内がある
  if (/must match.*EntityId|Invalid \w*[Ii]d\b.*kebab|EntityId/.test(message)) return "id は英小文字で始まる kebab-case (例: order-confirm, cart-add)。大文字・日本語・アンダースコア・UUID の形は使えません";
  if (/LocalId|Invalid (stepId|actionId|parentStepId)/.test(message)) return "工程・アクションの id は kebab-case (例: step-03, act-001)。一覧は designer__list_steps";
  if (/ワークスペース.*見つかりません|ワークスペース.*選択/.test(message)) return "designer__workspace_list で探し、designer__workspace_open で開いてください";
  if (/見つかりません/.test(message) && !NOT_A_DESIGN_ID.test(message)) {
    const hit = LIST_TOOL.find(([re]) => re.test(message));
    return hit ? `id を一覧で確かめてください: ${hit[1]}` : null;
  }
  if (/スキーマ違反|スキーマに合|does not match the schema/i.test(message)) return "保存前に designer__validate_design で確かめられます。形は Resource harmony://schema/<種類>";
  return null;
}

export function withHint(message: string): string {
  const h = errorHint(message);
  return h ? `${message}\n直し方: ${h}` : message;
}
