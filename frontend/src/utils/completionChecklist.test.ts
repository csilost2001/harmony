import { describe, it, expect } from "vitest";
import type { DocIssue } from "@harmony/shared";
import { checklistSummary, completionChecklist } from "./completionChecklist";

const issue = (severity: DocIssue["severity"], section: string, message = "x"): DocIssue => ({ severity, section, message });
const base = { issues: [], unresolvedMarkers: 0, openThreads: 0, approval: "approved" as const };

describe("completionChecklist", () => {
  it("すべて満たしていれば、完了", () => {
    const s = checklistSummary(completionChecklist(base));
    expect(s).toEqual({ ok: 5, total: 5, done: true, unknown: 0 });
  });
  it("命名規約の指摘は、要確認とは別に数える。情報 (info) は要確認に数えない", () => {
    const items = completionChecklist({ ...base, issues: [issue("warning", "命名規約", "物理名「A」が命名規約に合っていません"), issue("info", "画面", "メモ"), issue("error", "画面", "必須")] });
    expect(items.find((x) => x.id === "naming")).toMatchObject({ status: "ng", detail: "1 件が合っていません" });
    expect(items.find((x) => x.id === "issues")).toMatchObject({ status: "ng", detail: "エラー 1 件・警告 0 件" });
  });
  it("マーカー・コメント・承認の状態", () => {
    const items = completionChecklist({ ...base, unresolvedMarkers: 2, openThreads: 1, approval: "stale" });
    expect(items.find((x) => x.id === "markers")?.detail).toBe("未解決 2 件");
    expect(items.find((x) => x.id === "threads")?.status).toBe("ng");
    expect(items.find((x) => x.id === "approval")?.detail).toContain("承認し直し");
    expect(checklistSummary(items)).toMatchObject({ ok: 2, total: 5, done: false });
  });
  it("成熟度があれば項目を足す (確定だけが ok)", () => {
    expect(completionChecklist({ ...base, maturity: "draft" }).at(-1)).toMatchObject({ id: "maturity", status: "ng", detail: "成熟度: 作成中" });
    expect(completionChecklist({ ...base, maturity: "committed" }).at(-1)?.status).toBe("ok");
  });
  it("判定できない項目 (null) は、数に入れず、完了の判定にも使わない", () => {
    const items = completionChecklist({ ...base, issues: null, openThreads: null, approval: null });
    expect(items.filter((x) => x.status === "unknown").map((x) => x.id)).toEqual(["issues", "naming", "threads", "approval"]);
    expect(checklistSummary(items)).toEqual({ ok: 1, total: 1, done: true, unknown: 4 });
    expect(checklistSummary(completionChecklist({ ...base, issues: null, openThreads: null, approval: null, unresolvedMarkers: 1 })).done).toBe(false);
  });
});
