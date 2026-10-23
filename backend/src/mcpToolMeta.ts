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
  openWorldHint: false;
}

const bare = (name: string) => name.replace(/^designer__/, "");

/** 既存のものを消さず・書き換えず、足すだけの書き込み */
const ADDITIVE = /^(add_[a-z_]+|record_generation|persist_uuids|solution_pack|editSession__(create|attach_as_view|set_role|update))$/;
/** 同じ引数で 2 回呼んでも、結果が変わらない書き込み */
const IDEMPOTENT = /^(save_[a-z_]+|update_[a-z_]+|set_[a-z_]+|delete_[a-z_]+|remove_[a-z_]+|restore_version|repair_registry|persist_uuids|resolve_marker|move_step|import_[a-z_]+|editSession__(save|update|discard|detach))$/;

export function toolAnnotations(name: string): ToolAnnotations {
  if (isReadOnlyTool(name)) return { readOnlyHint: true, openWorldHint: false };
  const n = bare(name);
  return { readOnlyHint: false, destructiveHint: !ADDITIVE.test(n), idempotentHint: IDEMPOTENT.test(n) && !ADDITIVE.test(n), openWorldHint: false };
}

interface ToolLike { name: string; description?: string; inputSchema?: unknown; [k: string]: unknown }

/** 説明の最初の 1 文 (。で区切る)。長ければ切る */
export function firstSentence(desc: string, max = 110): string {
  const i = desc.indexOf("。");
  const s = (i >= 0 ? desc.slice(0, i + 1) : desc).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 引数の説明 (description) を省いた inputSchema。型・必須・列挙は残す */
function stripParamDescriptions(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripParamDescriptions);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "description" && typeof v === "string") continue;
    out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, stripParamDescriptions(pv)])) : stripParamDescriptions(v);
  }
  return out;
}

export function briefTool<T extends ToolLike>(t: T): T {
  return { ...t, description: firstSentence(t.description ?? ""), inputSchema: stripParamDescriptions(t.inputSchema) };
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
  [/処理フロー|processFlow/, "designer__list_process_flows"], [/画面|screen/i, "designer__list_screens"], [/テーブル|table/i, "designer__list_tables"],
  [/帳票|report/i, "designer__list_reports"], [/業務フロー|businessFlow/, "designer__list_business_flows"], [/ページレイアウト|pageLayout/, "designer__list_page_layouts"],
  [/工程|step|アクション|action/i, "designer__list_steps (工程の id) / designer__get_process_flow (アクションの id)"],
  [/sequence|view|汎用定義|definition|シーケンス|ビュー/i, "designer__list_designs"],
];

/** エラーの文に添える「直し方」。当てはまるものがなければ null */
export function errorHint(message: string): string | null {
  if (/直し方|designer__[a-z_]+ で/.test(message)) return null; // すでに案内がある
  if (/must match.*EntityId|Invalid \w*[Ii]d\b.*kebab|EntityId/.test(message)) return "id は英小文字で始まる kebab-case (例: order-confirm, cart-add)。大文字・日本語・アンダースコア・UUID の形は使えません";
  if (/LocalId|Invalid (stepId|actionId|parentStepId)/.test(message)) return "工程・アクションの id は kebab-case (例: step-03, act-001)。一覧は designer__list_steps";
  if (/読み取り専用/.test(message)) return "この接続は読み取り専用です (HARMONY_MCP_MODE=readonly か、プロファイル read / review)。書き込みが必要なときは、利用者に接続の設定を変えてもらってください";
  if (/が見つかりません|見つかりません|not found/i.test(message)) {
    const hit = LIST_TOOL.find(([re]) => re.test(message));
    return `id を一覧で確かめてください: ${hit ? hit[1] : "該当する designer__list_* / designer__search_design"}`;
  }
  if (/スキーマ|schema/i.test(message)) return "保存前に designer__validate_design で確かめられます。形は Resource harmony://schema/<種類>";
  return null;
}

export function withHint(message: string): string {
  const h = errorHint(message);
  return h ? `${message}\n直し方: ${h}` : message;
}
