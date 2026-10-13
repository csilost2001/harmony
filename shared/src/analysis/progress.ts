/**
 * 完成度 (成熟度) とレビュー進捗。画面・処理フロー・テーブル・業務フロー・帳票の、下書き / 暫定 / 確定 の件数と、確定までの残りを出す。
 * 成熟度を決めていないものは、下書きとして数える。推移は、日ごとの記録 (ProgressSnapshot) を並べて見る。
 */
import type { DesignDocInput, DocIssueRef } from "../designDocument.js";

export type Maturity = "draft" | "provisional" | "committed";
export const MATURITY_ORDER: Maturity[] = ["draft", "provisional", "committed"];
export const MATURITY_LABELS: Record<Maturity, string> = { draft: "下書き", provisional: "暫定 (レビュー中)", committed: "確定" };

export type ProgressKind = "screen" | "processFlow" | "table" | "businessFlow" | "report";
export const PROGRESS_KIND_LABELS: Record<ProgressKind, string> = { screen: "画面", processFlow: "処理フロー", table: "テーブル", businessFlow: "業務フロー", report: "帳票" };

export interface MaturityCounts { draft: number; provisional: number; committed: number; total: number }
export interface ProgressRemaining { kind: ProgressKind; id: string; name: string; maturity: Maturity; ref: DocIssueRef }
export interface ProgressSummary {
  byKind: Array<{ kind: ProgressKind; label: string; counts: MaturityCounts }>;
  overall: MaturityCounts;
  /** 確定していないもの (下書き・暫定) */
  remaining: ProgressRemaining[];
  /** 確定の割合 (%。0 件なら 0) */
  committedPct: number;
}

const emptyCounts = (): MaturityCounts => ({ draft: 0, provisional: 0, committed: 0, total: 0 });
const norm = (m: unknown): Maturity => (m === "provisional" || m === "committed" ? m : "draft");

export function summarizeProgress(input: DesignDocInput): ProgressSummary {
  const groups: Array<{ kind: ProgressKind; items: Array<{ id: string; name: string; maturity?: unknown }> }> = [
    { kind: "screen", items: input.screens.filter((s) => s.purpose !== "gadget").map((s) => ({ id: s.id, name: s.name ?? s.id, maturity: s.maturity })) },
    { kind: "processFlow", items: input.flows.map((f) => ({ id: f.meta.id, name: f.meta.name ?? f.meta.id, maturity: f.meta.maturity })) },
    { kind: "table", items: input.tables.map((t) => ({ id: t.id, name: t.name ?? t.id, maturity: t.maturity })) },
    { kind: "businessFlow", items: (input.businessFlows ?? []).map((b) => ({ id: b.id, name: b.name, maturity: b.maturity })) },
    { kind: "report", items: (input.reports ?? []).map((r) => ({ id: r.id, name: r.name, maturity: r.maturity })) },
  ];
  const overall = emptyCounts();
  const remaining: ProgressRemaining[] = [];
  const byKind = groups.map(({ kind, items }) => {
    const counts = emptyCounts();
    for (const it of items) {
      const m = norm(it.maturity);
      counts[m]++; counts.total++; overall[m]++; overall.total++;
      if (m !== "committed") remaining.push({ kind, id: it.id, name: it.name, maturity: m, ref: { kind, id: it.id } });
    }
    return { kind, label: PROGRESS_KIND_LABELS[kind], counts };
  });
  return { byKind, overall, remaining, committedPct: overall.total ? Math.round((overall.committed / overall.total) * 1000) / 10 : 0 };
}

/** 1 日分の記録 (推移のグラフ用) */
export interface ProgressSnapshot { date: string; byKind: Record<ProgressKind, MaturityCounts> }

export function snapshotOf(summary: ProgressSummary, date: string): ProgressSnapshot {
  return { date, byKind: Object.fromEntries(summary.byKind.map((k) => [k.kind, k.counts])) as Record<ProgressKind, MaturityCounts> };
}

/** 記録から、全体の推移 (日付順) を作る */
export function overallTrend(snapshots: readonly ProgressSnapshot[]): Array<{ date: string } & MaturityCounts> {
  return [...snapshots].sort((a, b) => a.date.localeCompare(b.date)).map((s) => {
    const o = emptyCounts();
    for (const c of Object.values(s.byKind)) { o.draft += c.draft; o.provisional += c.provisional; o.committed += c.committed; o.total += c.total; }
    return { date: s.date, ...o };
  });
}
