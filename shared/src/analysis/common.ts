/**
 * 設計の分析 (影響分析・対応表・未使用・用語・命名規約ほか) の共通部品。
 * 入力は設計書と同じ `DesignDocInput`。純粋関数だけで、書き込まない。
 */
import type { FlowStep } from "../flowStructure.js";
import { stepChildLists } from "../flowWords.js";

/** 処理フローのステップを、入れ子 (steps / subSteps / 分岐の道 / コミット後・ロールバック時 / 承認・却下・期限切れ / 検証の OK・NG / 失敗系の副作用) ごとたどる */
export function forEachStep(steps: readonly FlowStep[] | undefined, visit: (s: FlowStep) => void): void {
  for (const s of steps ?? []) {
    visit(s);
    for (const g of stepChildLists(s)) forEachStep(g.steps, visit);
  }
}

/** 値を JSON の文字列にする (循環などで失敗したら空) */
export function jsonText(v: unknown): string {
  try { return JSON.stringify(v) ?? ""; } catch { return ""; }
}

/** 文字列の中の `@conv.<category>.<key>` の key を集める */
export function convRefs(text: string, category: "msg" | "regex" | "limit" | "permission" | "role"): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(`@conv\\.${category}\\.([A-Za-z0-9_.\\-]*[A-Za-z0-9_])`, "g");
  for (const m of text.matchAll(re)) out.add(m[1]);
  return out;
}

/** 文字列の中の `generic-definitions/<kind>/<name>` を、`<kind>/<name>` で集める */
export function genericDefinitionRefs(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/generic-definitions\/([a-z][a-z0-9-]*)\/([A-Za-z][A-Za-z0-9_]*)/g)) out.add(`${m[1]}/${m[2]}`);
  return out;
}

/** 比較用の正規化 (全角半角・大文字小文字・空白・区切り記号をそろえる) */
export function normalizeTerm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s_\-・･.]/g, "");
}

/** 物理名の比較用 (snake_case / camelCase / kebab-case を同じ形にする) */
export function normalizeIdentifier(s: string): string {
  return s.replace(/[_\-\s]/g, "").toLowerCase();
}

export const nodeKey = (kind: string, id: string): string => `${kind}:${id}`;

/** 画面項目の `binding` の列参照 */
export function bindingColumnRef(item: { binding?: { kind?: string; ref?: { tableId?: string; columnId?: string } } }): { tableId: string; columnId?: string } | null {
  const b = item.binding;
  if (b?.kind !== "tableColumn" || !b.ref?.tableId) return null;
  return { tableId: b.ref.tableId, ...(b.ref.columnId ? { columnId: b.ref.columnId } : {}) };
}

/** CSV の 1 セル。Excel で開いたとき、= + - @ で始まる文字列が式として解釈されないよう、先頭に ' を付ける (数値はそのまま) */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** CSV (Excel で開ける。BOM は呼び出し側で付ける) */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type CrudLetter = "C" | "R" | "U" | "D";

/** DB アクセスの操作名 (SELECT / INSERT / UPSERT / 在庫減算など) から、CRUD の文字を決める */
export function opLetters(op: string): CrudLetter[] {
  const o = op.toUpperCase();
  if (o.includes("UPSERT") || o.includes("MERGE")) return ["C", "U"];
  if (o.startsWith("SELECT")) return ["R"];
  if (o === "INSERT" || o.includes("INSERT")) return ["C"];
  if (o === "UPDATE" || o.includes("UPDATE") || o.includes("DECREMENT") || o.includes("INCREMENT")) return ["U"];
  if (o === "DELETE" || o.includes("DELETE") || o.includes("CLEAR")) return ["D"];
  return ["R"];
}

/** 行の終わりとして扱われる文字 (改行・垂直タブ・改ページ・NEL・U+2028・U+2029) */
const LINE_BREAKS = new RegExp(`[\\r\\n${String.fromCharCode(0x0b, 0x0c, 0x85, 0x2028, 0x2029)}]+`, "g");

/**
 * 設計の文字列を、コメントの 1 行にする。出力 (SQL の `--`・JS の `//`) へ、設計の表示名・物理名を入れるとき、
 * 改行で、コメントの外へ抜けて、次の行が実行されるのを防ぐ。
 */
export function oneLine(s: unknown): string {
  return String(s ?? "").replace(LINE_BREAKS, " ");
}

/** この環境のローカル日付 (YYYY-MM-DD) */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
