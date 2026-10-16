import { describe, it, expect } from "vitest";
import { groupOrder, groupSegments, UNSET_GROUP_LABEL } from "./listGroup";

const rows = [
  { n: "a", c: "マスタ" }, { n: "b", c: "ログ" }, { n: "c", c: "マスタ" }, { n: "d", c: "" }, { n: "e", c: "ログ" }, { n: "f", c: "" },
];
const keyOf = (r: { c: string }) => r.c;

describe("一覧のグループ表示 (続編 第 6 弾 #102)", () => {
  it("同じグループをまとめ、グループの順は最初に出た順、中の順は変えない", () => {
    expect(groupOrder(rows, keyOf).map((r) => r.n)).toEqual(["a", "c", "b", "e", "d", "f"]);
  });
  it("見出しを挟む範囲に区切る。空は「(未設定)」", () => {
    const g = groupOrder(rows, keyOf);
    expect(groupSegments(g, keyOf)).toEqual([
      { key: "マスタ", start: 0, count: 2 }, { key: "ログ", start: 2, count: 2 }, { key: UNSET_GROUP_LABEL, start: 4, count: 2 },
    ]);
  });
  it("空の一覧・1 グループだけでも動く", () => {
    expect(groupOrder([], keyOf)).toEqual([]);
    expect(groupSegments([], keyOf)).toEqual([]);
    expect(groupSegments([{ c: "x" }, { c: "x" }], keyOf)).toEqual([{ key: "x", start: 0, count: 2 }]);
  });
});
