/**
 * プロジェクト独自の検査ルール。コードではなく宣言 (対象の種類・項目の場所・条件) で書く。
 * 例: 「テーブルには説明が必須」「処理フローの成熟度が確定なら、各アクションに SLA が要る」。
 * 実行できるのは、宣言された比較だけ (任意のコードは実行しない)。
 */
import type { DesignDocInput, DocIssue, DocIssueRef } from "../designDocument.js";
import { RULE_TARGET_LABELS, type CustomRule, type RuleCheck, type RuleTarget } from "./settings.js";

const MAX_VALUE_LENGTH = 1000;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function describeCheck(c: RuleCheck): string {
  switch (c.type) {
    case "required": return "が必要です";
    case "forbidden": return "は書かないでください";
    case "pattern": return `が形式 /${c.pattern}/ に合っていません`;
    case "oneOf": return `は ${c.values.join(" / ")} のどれかにしてください`;
    case "range": return `は ${c.min ?? ""}〜${c.max ?? ""} の範囲にしてください`;
  }
}

/** 値が条件を満たすか。`undefined` (その項目が無い) の扱いは、条件ごとに決める */
function satisfies(v: unknown, c: RuleCheck): boolean {
  switch (c.type) {
    case "required": return !isEmpty(v);
    case "forbidden": return isEmpty(v);
    case "pattern": {
      if (isEmpty(v)) return true; // 空は「必要」の条件で見る
      return new RegExp(c.pattern, c.flags).test(String(v).slice(0, MAX_VALUE_LENGTH));
    }
    case "oneOf": return isEmpty(v) || c.values.includes(String(v));
    case "range": {
      if (isEmpty(v)) return true;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return false;
      return (c.min === undefined || n >= c.min) && (c.max === undefined || n <= c.max);
    }
  }
}

interface Subject { target: RuleTarget; value: unknown; label: string; section: string; ref: DocIssueRef }

function subjects(input: DesignDocInput): Subject[] {
  const out: Subject[] = [];
  for (const s of input.screens) {
    out.push({ target: "screen", value: s, label: s.name ?? s.id, section: `画面 ${s.name ?? s.id}`, ref: { kind: "screen", id: s.id } });
    for (const it of s.items ?? []) out.push({ target: "screenItem", value: it, label: `${s.name ?? s.id} / ${it.label ?? it.id}`, section: `画面 ${s.name ?? s.id}`, ref: { kind: "screen", id: s.id } });
  }
  for (const f of input.flows) {
    out.push({ target: "processFlow", value: f, label: f.meta.name ?? f.meta.id, section: `処理フロー ${f.meta.name ?? f.meta.id}`, ref: { kind: "processFlow", id: f.meta.id } });
    for (const a of f.actions) out.push({ target: "action", value: a, label: `${f.meta.name ?? f.meta.id} / ${a.name ?? a.id ?? ""}`, section: `処理フロー ${f.meta.name ?? f.meta.id}`, ref: { kind: "processFlow", id: f.meta.id } });
  }
  for (const t of input.tables) {
    out.push({ target: "table", value: t, label: t.name ?? t.id, section: `テーブル ${t.name ?? t.id}`, ref: { kind: "table", id: t.id } });
    for (const c of t.columns ?? []) out.push({ target: "column", value: c, label: `${t.name ?? t.id} / ${c.name ?? c.physicalName}`, section: `テーブル ${t.name ?? t.id}`, ref: { kind: "table", id: t.id } });
  }
  for (const b of input.businessFlows ?? []) out.push({ target: "businessFlow", value: b, label: b.name, section: `業務フロー ${b.name}`, ref: { kind: "businessFlow", id: b.id } });
  for (const r of input.reports ?? []) out.push({ target: "report", value: r, label: r.name, section: `帳票 ${r.name}`, ref: { kind: "report", id: r.id } });
  return out;
}

export function customRuleIssues(input: DesignDocInput): DocIssue[] {
  const rules = (input.checkSettings?.rules ?? []).filter((r) => r.enabled !== false);
  if (!rules.length) return [];
  const all = subjects(input);
  const issues: DocIssue[] = [];
  for (const rule of rules) evaluateRule(rule, all, issues);
  return issues;
}

function evaluateRule(rule: CustomRule, all: readonly Subject[], issues: DocIssue[]): void {
  for (const sub of all) {
    if (sub.target !== rule.target) continue;
    if (rule.when) {
      const w = getPath(sub.value, rule.when.path);
      if (rule.when.notEmpty && isEmpty(w)) continue;
      if (rule.when.equals !== undefined && w !== rule.when.equals) continue;
    }
    let ok: boolean;
    try { ok = satisfies(getPath(sub.value, rule.path), rule.check); } catch { ok = true; }
    if (ok) continue;
    issues.push({
      severity: rule.severity, section: sub.section, ref: sub.ref,
      message: rule.message ? `${rule.message} (${sub.label})` : `ルール「${rule.name}」: ${RULE_TARGET_LABELS[rule.target]}「${sub.label}」の ${rule.path} ${describeCheck(rule.check)}`,
    });
  }
}
