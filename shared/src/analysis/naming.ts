/**
 * 命名規約の検査。規約カタログの正規表現 (`@conv.regex.namingTable` など決まったキー) に、物理名・ID が合っているかを見る。
 * 接頭辞の規約も、正規表現 (例: `^m_`) で書く。キーが無いときは、DB 規約の `namingConvention` (snake_case など) を、テーブル・カラムの物理名の既定の規約にする。
 */
import type { DesignDocInput, DocIssue } from "../designDocument.js";
import { checkRegexSafety } from "./settings.js";

export const NAMING_KEYS = {
  namingTable: "テーブルの物理名",
  namingColumn: "カラムの物理名",
  namingScreen: "画面の ID",
  namingProcessFlow: "処理フローの ID",
  namingScreenItem: "画面項目の ID",
} as const;
export type NamingKey = keyof typeof NAMING_KEYS;

/** DB 規約の `namingConvention` (自由な文字列。例: "snake_case" / "lowerCamelCase") から、正規表現を決める。読み取れなければ null */
export function conventionPattern(name: string | undefined): { label: string; pattern: string } | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/[\s_-]/g, "");
  if (/pascal|uppercamel/.test(n)) return { label: "PascalCase", pattern: "^[A-Z][a-zA-Z0-9]*$" };
  if (/camel/.test(n)) return { label: "camelCase", pattern: "^[a-z][a-zA-Z0-9]*$" };
  if (/uppersnake|screamingsnake|uppercase/.test(n)) return { label: "UPPER_SNAKE_CASE", pattern: "^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$" };
  if (/snake/.test(n)) return { label: "snake_case", pattern: "^[a-z][a-z0-9]*(_[a-z0-9]+)*$" };
  if (/kebab/.test(n)) return { label: "kebab-case", pattern: "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" };
  return null;
}

interface Rule { source: string; pattern: RegExp; description: string; example?: string }

export function namingIssues(input: DesignDocInput): DocIssue[] {
  const issues: DocIssue[] = [];
  const rules = new Map<NamingKey, Rule>();
  for (const key of Object.keys(NAMING_KEYS) as NamingKey[]) {
    const e = input.regex?.[key] as { pattern?: string; flags?: string; description?: string; exampleValid?: string[] } | undefined;
    if (!e?.pattern) continue;
    const bad = checkRegexSafety(e.pattern, e.flags);
    if (bad) { issues.push({ severity: "warning", section: "命名規約", message: `@conv.regex.${key} の正規表現が使えません: ${bad}` }); continue; }
    rules.set(key, { source: `@conv.regex.${key}`, pattern: new RegExp(e.pattern, e.flags), description: e.description ?? NAMING_KEYS[key], example: e.exampleValid?.[0] });
  }
  // 既定の規約 (DB 規約の namingConvention): 明示の規約が無いテーブル・カラムの物理名に適用する
  const dbEntries = Object.values(input.db ?? {});
  const dbDefault = dbEntries.find((d) => d.default) ?? (dbEntries.length === 1 ? dbEntries[0] : undefined);
  const conv = conventionPattern(dbDefault?.namingConvention);
  if (conv) for (const key of ["namingTable", "namingColumn"] as const) {
    if (!rules.has(key)) rules.set(key, { source: `DB 規約 (namingConvention: ${dbDefault?.namingConvention})`, pattern: new RegExp(conv.pattern), description: conv.label });
  }
  if (rules.size === 0) return issues;

  const check = (key: NamingKey, value: unknown, section: string, what: string, ref: NonNullable<DocIssue["ref"]>) => {
    const rule = rules.get(key);
    if (!rule || typeof value !== "string" || value === "" || value.length > 200) return;
    if (!rule.pattern.test(value)) {
      issues.push({ severity: "warning", section, message: `${what}「${value}」が命名規約に合っていません (${rule.source}: ${rule.description}${rule.example ? `。例: ${rule.example}` : ""})`, ref });
    }
  };
  for (const t of input.tables) {
    const sec = `テーブル ${t.name ?? t.id}`;
    check("namingTable", t.physicalName, sec, "物理名", { kind: "table", id: t.id });
    for (const c of t.columns ?? []) check("namingColumn", c.physicalName, sec, "カラムの物理名", { kind: "table", id: t.id });
  }
  for (const s of input.screens) {
    check("namingScreen", s.id, `画面 ${s.name ?? s.id}`, "画面 ID", { kind: "screen", id: s.id });
    for (const it of s.items ?? []) check("namingScreenItem", it.id, `画面 ${s.name ?? s.id}`, "画面項目の ID", { kind: "screen", id: s.id });
  }
  for (const f of input.flows) check("namingProcessFlow", f.meta.id, `処理フロー ${f.meta.name ?? f.meta.id}`, "処理フローの ID", { kind: "processFlow", id: f.meta.id });
  return issues;
}
