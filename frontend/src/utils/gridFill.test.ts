import { describe, it, expect } from "vitest";
import { fillValues } from "./gridFill";

describe("fillValues", () => {
  it("copy は、同じ値を count 個", () => {
    expect(fillValues("abc", 3, "copy")).toEqual(["abc", "abc", "abc"]);
    expect(fillValues("abc", 0, "copy")).toEqual([]);
  });
  it("series は、末尾の数字を 1 つずつ進め、桁をそろえる", () => {
    expect(fillValues("item1", 3, "series")).toEqual(["item2", "item3", "item4"]);
    expect(fillValues("col_08", 3, "series")).toEqual(["col_09", "col_10", "col_11"]);
    expect(fillValues("9", 2, "series")).toEqual(["10", "11"]);
  });
  it("series は、日付を 1 日ずつ進める (区切りと桁を保つ)", () => {
    expect(fillValues("2026-10-30", 3, "series")).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(fillValues("2026/12/31", 1, "series")).toEqual(["2027/01/01"]);
    expect(fillValues("2026/1/9", 2, "series")).toEqual(["2026/1/10", "2026/1/11"]);
  });
  it("series でも、進められない値は同じ値 (存在しない日付も)", () => {
    expect(fillValues("名前", 2, "series")).toEqual(["名前", "名前"]);
    expect(fillValues("", 2, "series")).toEqual(["", ""]);
    expect(fillValues("2026-02-30", 1, "series")).toEqual(["2026-02-31"]); // 日付ではなく、末尾の数字として進める
  });
});
