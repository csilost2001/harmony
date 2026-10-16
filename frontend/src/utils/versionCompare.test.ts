import { describe, it, expect } from "vitest";
import { changeRow, commitMessageText, compareSnapshots, countsText, reviewRequestText } from "./versionCompare";

const before = { id: "orders", name: "注文", columns: [{ id: "c1", physicalName: "id", name: "ID" }, { id: "c2", physicalName: "amount", name: "金額", length: 10 }] };
const after = { id: "orders", name: "注文", columns: [{ id: "c1", physicalName: "id", name: "ID" }, { id: "c2", physicalName: "amount", name: "金額", length: 12 }, { id: "c3", physicalName: "memo", name: "メモ" }] };

describe("compareSnapshots", () => {
  it("追加・変更を数え、人の言葉の要約を出す", () => {
    const r = compareSnapshots(before, after);
    expect(r.counts).toMatchObject({ added: 1, changed: 1, removed: 0 });
    expect(r.summary.join("\n")).toContain("メモ");
    expect(r.summary.join("\n")).toContain("長さ");
  });
  it("updatedAt の差は無視し、同じ内容なら空", () => {
    const r = compareSnapshots({ ...before, updatedAt: "a" }, { ...before, updatedAt: "b" });
    expect(r.changes).toEqual([]);
    expect(r.summary).toEqual([]);
    expect(countsText(r.counts)).toBe("差はありません");
  });
});

describe("changeRow", () => {
  it("場所・前・後を文字にする", () => {
    const rows = compareSnapshots(before, after).changes.map(changeRow);
    const len = rows.find((r) => r.where.includes("長さ"))!;
    expect(len).toMatchObject({ kind: "changed", before: "10", after: "12" });
    expect(rows.find((r) => r.kind === "added")!.before).toBe("");
  });
});

describe("commitMessageText / reviewRequestText", () => {
  it("1 行目は 72 文字まで。箇条書きが続く", () => {
    const t = commitMessageText("テーブル「注文」", compareSnapshots(before, after));
    const [title, blank, ...body] = t.split("\n");
    expect(title.length).toBeLessThanOrEqual(72);
    expect(title).toContain("テーブル「注文」を更新");
    expect(blank).toBe("");
    expect(body.some((l) => l.startsWith("- "))).toBe(true);
  });
  it("差が無ければ空", () => {
    expect(commitMessageText("x", compareSnapshots(before, before))).toBe("");
    expect(reviewRequestText("x", compareSnapshots(before, before), "a", "b")).toBe("");
  });
  it("レビュー依頼の本文は、概要・変更点・確認の欄がある", () => {
    const t = reviewRequestText("テーブル「注文」", compareSnapshots(before, after), "保存前の版", "いまの内容");
    expect(t).toContain("## 変更の概要");
    expect(t).toContain("追加 1 件");
    expect(t).toContain("## 確認してほしい点");
  });
});
