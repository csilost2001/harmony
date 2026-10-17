import { describe, it, expect } from "vitest";
import type { CommentThread } from "@harmony/shared";
import type { ApprovalRow } from "./opsApi";
import { summarizeReview } from "./reviewProgress";

const row = (id: string, status: ApprovalRow["status"], at?: string): ApprovalRow => ({ kind: "table", id, name: id, state: status === "stale" || status === "none" ? "approved" : status, status, history: at ? [{ state: "review", by: "花子", at }] : [], nextStates: [] }) as ApprovalRow;
const thread = (id: string, tid: string, status: "open" | "resolved"): CommentThread => ({ id, target: { kind: "table", id: tid }, status, messages: [{ id: "m", by: "a", at: "2026-10-01T00:00:00Z", text: "x" }] });
const now = new Date("2026-10-17T00:00:00Z");

describe("summarizeReview", () => {
  it("状態ごとに数え、承認の記録が無い設計は未申請に数える", () => {
    const r = summarizeReview([row("a", "review"), row("b", "approved"), row("c", "rejected")], [], now, { totalDesigns: 10 });
    expect(r.byStatus).toMatchObject({ review: 1, approved: 1, rejected: 1, none: 7 });
  });
  it("承認待ち・差し戻しのまま日数がたったものを、古い順に出す", () => {
    const r = summarizeReview([row("new", "review", "2026-10-16T00:00:00Z"), row("old", "review", "2026-10-10T00:00:00Z"), row("rej", "rejected", "2026-10-12T00:00:00Z"), row("ok", "approved", "2026-09-01T00:00:00Z")], [], now);
    expect(r.stalled.map((s) => [s.id, s.days])).toEqual([["old", 7], ["rej", 5]]);
  });
  it("日数の基準を変えられる。履歴が無ければ数えない", () => {
    expect(summarizeReview([row("a", "review", "2026-10-16T00:00:00Z")], [], now, { stalledDays: 1 }).stalled).toHaveLength(1);
    expect(summarizeReview([row("a", "review")], [], now).stalled).toEqual([]);
  });
  it("未解決のコメントがある設計の数と、総数", () => {
    const r = summarizeReview([], [thread("1", "a", "open"), thread("2", "a", "open"), thread("3", "b", "resolved"), thread("4", "c", "open")], now);
    expect(r).toMatchObject({ withOpenThreads: 2, openThreads: 3 });
  });
});
