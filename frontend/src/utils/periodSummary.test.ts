import { describe, it, expect } from "vitest";
import type { CommentThread, DocIssue } from "@harmony/shared";
import type { AuditEntry, ApprovalRow } from "./opsApi";
import type { MarkerItem } from "./markerOverview";
import { defaultPeriod, summarizePeriod } from "./periodSummary";

const at = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00`).toISOString();
const e = (when: string, actor: string, action: string, target: string): AuditEntry => ({ at: when, actor, action, target });
const audit: AuditEntry[] = [
  e(at("2026-10-16"), "花子", "編集内容を保存した", "table orders"),
  e(at("2026-10-15"), "太郎", "テーブルを保存した", "orders"),
  e(at("2026-10-15", 9), "太郎", "画面を削除した", "old-screen"),
  e(at("2026-09-01"), "次郎", "テーブルを保存した", "orders"),
  e(at("2026-10-16", 8), "花子", "プロジェクトの設定・一覧を保存した", ""),
];
const approvals = [{ kind: "table", id: "orders", name: "注文", state: "approved", status: "approved", history: [{ state: "review", by: "太郎", at: at("2026-10-15") }, { state: "approved", by: "花子", at: at("2026-10-16") }, { state: "review", by: "太郎", at: at("2026-09-01") }], nextStates: [] }] as unknown as ApprovalRow[];
const threads = [{ id: "t1", target: { kind: "table", id: "orders" }, status: "resolved", resolvedAt: at("2026-10-16"), messages: [] }, { id: "t2", target: { kind: "table", id: "orders" }, status: "resolved", resolvedAt: at("2026-08-01"), messages: [] }] as unknown as CommentThread[];
const markers = [{ entityType: "table", entityId: "orders", entityName: "注文", marker: { id: "m", kind: "todo", body: "桁数を確認", resolvedAt: at("2026-10-16"), createdAt: "x", author: "human" } }] as unknown as MarkerItem[];
const issues: DocIssue[] = [{ severity: "error", section: "a", message: "x" }, { severity: "warning", section: "a", message: "y" }, { severity: "info", section: "a", message: "z" }];

describe("summarizePeriod", () => {
  const r = summarizePeriod({ from: "2026-10-10", to: "2026-10-17", audit, approvals, threads, markers, issues, names: new Map([["table:orders", "注文"]]) });
  it("期間内に変更した設計を、新しい順に出す (保存と削除を分ける)", () => {
    expect(r.changed.map((c) => [c.name, c.saves, c.deletes])).toEqual([["注文", 2, 0], ["old-screen", 0, 1]]);
    expect(r.changed[0].actors.sort()).toEqual(["太郎", "花子"]);
  });
  it("承認の動き・解決したマーカーとコメントは、期間内だけ", () => {
    expect(r.approvalEvents.map((a) => a.state)).toEqual(["approved", "review"]);
    expect(r.resolvedMarkers).toHaveLength(1);
    expect(r.resolvedThreads).toBe(1);
  });
  it("要確認は、情報を除いて数える", () => {
    expect(r.openIssues).toEqual({ error: 1, warning: 1 });
  });
  it("文章にする", () => {
    expect(r.text).toContain("# 設計のまとめ (2026-10-10 〜 2026-10-17)");
    expect(r.text).toContain("テーブル「注文」: 保存 2 回 (花子、太郎)");
    expect(r.text).toContain("「注文」を花子が承認した");
    expect(r.text).toContain("マーカー: 1 件");
  });
  it("何も無い期間でも、文章になる", () => {
    const x = summarizePeriod({ from: "2020-01-01", to: "2020-01-07", audit, approvals, threads, markers, issues: [] });
    expect(x.text).toContain("変更はありませんでした");
    expect(x.text).toContain("動きはありませんでした");
  });
});

describe("defaultPeriod", () => {
  it("今日を含む直近 7 日", () => {
    expect(defaultPeriod(new Date("2026-10-17T12:00:00"))).toEqual({ from: "2026-10-11", to: "2026-10-17" });
  });
});
