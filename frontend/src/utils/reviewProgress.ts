/**
 * レビューの進み具合 (UI 改善提案 続編 第 9 弾 #166)。画面に依存しない純関数。
 * 設計ごとの承認の状態と、コメントのスレッドから、状態ごとの件数と「止まっているレビュー」を出す。
 * 止まっている = 承認待ち (review) のまま、最後の操作から一定の日数がたったもの。差し戻しのまま長く動かないものも出す。
 */
import type { ApprovalStatus, CommentThread, OpsEntityKind } from "@harmony/shared";
import type { ApprovalRow } from "./opsApi";

export const DEFAULT_STALLED_DAYS = 3;
const DAY_MS = 86_400_000;

export interface StalledReview { kind: OpsEntityKind; id: string; name: string; status: "review" | "rejected"; since: string; days: number }

export interface ReviewProgress {
  byStatus: Record<ApprovalStatus, number>;
  /** 承認待ち・差し戻しのまま、日数がたったもの (古い順) */
  stalled: StalledReview[];
  /** 未解決のコメントがある設計の数と、未解決のコメントの総数 */
  withOpenThreads: number;
  openThreads: number;
}

const ZERO: Record<ApprovalStatus, number> = { none: 0, draft: 0, review: 0, approved: 0, rejected: 0, stale: 0 };

/** `totalDesigns` を渡すと、承認の記録が無い設計を「未申請」に数える */
export function summarizeReview(rows: readonly ApprovalRow[], threads: readonly CommentThread[], now: Date, opts: { stalledDays?: number; totalDesigns?: number } = {}): ReviewProgress {
  const days = opts.stalledDays ?? DEFAULT_STALLED_DAYS;
  const byStatus = { ...ZERO };
  const stalled: StalledReview[] = [];
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.status !== "review" && r.status !== "rejected") continue;
    const last = r.history.at(-1)?.at;
    if (!last) continue;
    const elapsed = Math.floor((now.getTime() - Date.parse(last)) / DAY_MS);
    if (Number.isFinite(elapsed) && elapsed >= days) stalled.push({ kind: r.kind, id: r.id, name: r.name, status: r.status, since: last, days: elapsed });
  }
  if (opts.totalDesigns !== undefined) byStatus.none = Math.max(0, opts.totalDesigns - rows.length);
  stalled.sort((a, b) => a.since.localeCompare(b.since));
  const open = threads.filter((t) => t.status === "open");
  const targets = new Set(open.map((t) => `${t.target.kind}:${t.target.id}`));
  return { byStatus, stalled, withOpenThreads: targets.size, openThreads: open.length };
}
