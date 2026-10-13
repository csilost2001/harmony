import { describe, it, expect } from "vitest";
import type { DocIssue } from "@harmony/shared";
import { issueBreakdown } from "./issueBreakdown";

const issue = (section: string, severity: DocIssue["severity"], message = "m"): DocIssue => ({ section, severity, message });

describe("要確認の内訳", () => {
  it("主な 5 種類は 0 件でも出し、エラー・警告を数える (情報は数えない)", () => {
    const rows = issueBreakdown([
      issue("画面 カート", "error"), issue("画面 注文", "warning"), issue("処理フロー 注文確定", "warning"), issue("テーブル 顧客", "info"),
    ]);
    expect(rows.map((r) => [r.label, r.error, r.warning])).toEqual([
      ["画面", 1, 1], ["処理フロー", 0, 1], ["テーブル", 0, 0], ["業務フロー", 0, 0], ["帳票", 0, 0],
    ]);
  });
  it("種類が分からないものは「その他」にまとめ、あるときだけ出す", () => {
    const rows = issueBreakdown([issue("設計ファイル business-flows/x.json", "error"), issue("独自部品 x", "warning")]);
    expect(rows.at(-1)).toEqual({ label: "その他", error: 1, warning: 1 });
  });
});
