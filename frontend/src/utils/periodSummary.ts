/**
 * 期間のまとめ (週次サマリー) (UI 改善提案 続編 第 9 弾 #177)。画面に依存しない純関数。
 * 期間内に「変更した設計」「承認の動き」「解決したマーカー・レビューコメント」と、いま残っている「要確認」を、文章と表にする。
 * 設計を新しく作ったのか、既存を変えたのかは、変更の記録からは分からないので、分けない (「変更」にまとめる)。
 */
import type { CommentThread, DocIssue } from "@harmony/shared";
import { designTimeline, entryDesign, HISTORY_KIND_LABELS, type HistoryKind } from "./designHistory";
import type { AuditEntry, ApprovalRow } from "./opsApi";
import type { MarkerItem } from "./markerOverview";

export interface PeriodInput {
  /** 期間の始まり・終わり (日付。両端を含む) */
  from: string;
  to: string;
  /** 変更の記録 (どの順でもよい) */
  audit: readonly AuditEntry[];
  approvals: readonly ApprovalRow[];
  threads: readonly CommentThread[];
  /** マーカー (解決済みも含む) */
  markers: readonly MarkerItem[];
  /** いまの要確認 (抑制済みは除いたもの) */
  issues: readonly DocIssue[];
  /** 設計の名前を引く (`<種類>:<id>` → 名前)。無ければ id */
  names?: ReadonlyMap<string, string>;
}

export interface ChangedDesign { kind: HistoryKind; id: string; name: string; saves: number; deletes: number; lastAt: string; actors: string[] }
export interface PeriodSummary {
  changed: ChangedDesign[];
  approvalEvents: Array<{ kind: string; id: string; name: string; state: string; by: string; at: string }>;
  resolvedMarkers: Array<{ name: string; body: string; at: string }>;
  resolvedThreads: number;
  openIssues: { error: number; warning: number };
  actors: string[];
  text: string;
}

const STATE_LABELS: Record<string, string> = { draft: "下書きに戻した", review: "承認を依頼した", approved: "承認した", rejected: "差し戻した" };
/** 日付の文字 (ISO の時刻つき) を、ローカルの日付の範囲に当てはめる */
const inRange = (iso: string | undefined, from: string, to: string): boolean => {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  const local = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return local >= from && local <= to;
};

export function summarizePeriod(p: PeriodInput): PeriodSummary {
  const nameOf = (kind: string, id: string) => p.names?.get(`${kind}:${id}`) ?? id;
  const entries = p.audit.filter((e) => inRange(e.at, p.from, p.to));

  // 変更した設計
  const keys = new Map<string, { kind: HistoryKind; id: string }>();
  for (const e of entries) { const d = entryDesign(e); if (d) keys.set(`${d.kind}:${d.id}`, d); }
  const changed: ChangedDesign[] = [];
  for (const { kind, id } of keys.values()) {
    const t = designTimeline(entries, kind, id);
    if (t.length === 0) continue;
    const deletes = t.filter((e) => e.action.includes("削除")).length;
    changed.push({ kind, id, name: nameOf(kind, id), saves: t.length - deletes, deletes, lastAt: t.map((e) => e.at).sort().at(-1)!, actors: [...new Set(t.map((e) => e.actor))] });
  }
  changed.sort((a, b) => b.lastAt.localeCompare(a.lastAt));

  const approvalEvents = p.approvals.flatMap((r) => r.history.filter((h) => inRange(h.at, p.from, p.to)).map((h) => ({ kind: r.kind, id: r.id, name: r.name, state: h.state, by: h.by, at: h.at })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const resolvedMarkers = p.markers.filter((m) => inRange(m.marker.resolvedAt, p.from, p.to)).map((m) => ({ name: m.entityName || m.entityId, body: m.marker.body.replace(/\s+/g, " ").slice(0, 60), at: m.marker.resolvedAt! }));
  const resolvedThreads = p.threads.filter((t) => t.status === "resolved" && inRange(t.resolvedAt, p.from, p.to)).length;
  const live = p.issues.filter((i) => i.severity !== "info");
  const openIssues = { error: live.filter((i) => i.severity === "error").length, warning: live.filter((i) => i.severity === "warning").length };
  const actors = [...new Set(entries.map((e) => e.actor))].sort();

  const lines: string[] = [`# 設計のまとめ (${p.from} 〜 ${p.to})`, ""];
  lines.push(`## 変更した設計 (${changed.length} 件)`);
  if (changed.length === 0) lines.push("- 変更はありませんでした");
  for (const c of changed.slice(0, 40)) {
    const what = [c.saves ? `保存 ${c.saves} 回` : "", c.deletes ? `削除 ${c.deletes} 回` : ""].filter(Boolean).join("・");
    lines.push(`- ${HISTORY_KIND_LABELS[c.kind]}「${c.name}」: ${what} (${c.actors.join("、")})`);
  }
  if (changed.length > 40) lines.push(`- ほか ${changed.length - 40} 件`);
  lines.push("", `## 承認の動き (${approvalEvents.length} 件)`);
  if (approvalEvents.length === 0) lines.push("- 動きはありませんでした");
  for (const a of approvalEvents.slice(0, 30)) lines.push(`- 「${a.name}」を${a.by}が${STATE_LABELS[a.state] ?? a.state}`);
  lines.push("", `## 解決したもの`, `- マーカー: ${resolvedMarkers.length} 件`, `- レビューコメント: ${resolvedThreads} 件`);
  for (const m of resolvedMarkers.slice(0, 20)) lines.push(`  - ${m.name}: ${m.body}`);
  lines.push("", "## いま残っている要確認", `- エラー ${openIssues.error} 件・警告 ${openIssues.warning} 件`, "");
  return { changed, approvalEvents, resolvedMarkers, resolvedThreads, openIssues, actors, text: lines.join("\n") };
}

/** 期間の既定: 今日を含む直近 7 日 */
export function defaultPeriod(now: Date = new Date(), days = 7): { from: string; to: string } {
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const start = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { from: f(start), to: f(now) };
}
