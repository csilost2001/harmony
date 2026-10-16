import { describe, it, expect } from "vitest";
import { combineSelection, matchRowIds, type ConditionOp } from "./selectByCondition";

interface Row { id: string; name: string; kind: string | null; n: number }
const rows: Row[] = [
  { id: "r1", name: "注文一覧", kind: "一覧", n: 1 },
  { id: "r2", name: "ｶｰﾄ", kind: "入力", n: 2 },
  { id: "r3", name: "在庫一覧", kind: "一覧", n: 3 },
  { id: "r4", name: "ダッシュボード", kind: null, n: 4 },
];
const ids = (op: ConditionOp, value = "", selected: string[] = [], acc: (r: Row) => string | number | null = (r) => r.name) =>
  matchRowIds(rows, (r) => r.id, acc, op, value, new Set(selected));

describe("matchRowIds", () => {
  it("含む: 全角・半角・かな / カナの違いを無視する", () => {
    expect(ids("contains", "一覧")).toEqual(["r1", "r3"]);
    expect(ids("contains", "カート")).toEqual(["r2"]);
    expect(ids("contains", "")).toEqual([]); // 空の条件は、何にも合わない
  });
  it("同じ: 値全体が合うものだけ", () => {
    expect(ids("equals", "一覧", [], (r) => r.kind)).toEqual(["r1", "r3"]);
    expect(ids("equals", "注文", [])).toEqual([]);
  });
  it("空 / 空でない (数値は文字にして見る)", () => {
    expect(ids("empty", "", [], (r) => r.kind)).toEqual(["r4"]);
    expect(ids("notEmpty", "", [], (r) => r.kind)).toEqual(["r1", "r2", "r3"]);
    expect(ids("notEmpty", "", [], (r) => r.n)).toEqual(["r1", "r2", "r3", "r4"]);
  });
  it("いま選んでいる行と同じ値の行 (選択が空なら、何も選ばない)", () => {
    expect(ids("sameAsSelected", "", ["r1"], (r) => r.kind)).toEqual(["r1", "r3"]);
    expect(ids("sameAsSelected", "", [], (r) => r.kind)).toEqual([]);
  });
});

describe("combineSelection", () => {
  it("置き換える・加える・外す", () => {
    const cur = new Set(["r1", "r2"]);
    expect([...combineSelection(cur, ["r3"], "replace")]).toEqual(["r3"]);
    expect([...combineSelection(cur, ["r2", "r3"], "add")].sort()).toEqual(["r1", "r2", "r3"]);
    expect([...combineSelection(cur, ["r2", "r9"], "remove")]).toEqual(["r1"]);
    expect([...cur].sort()).toEqual(["r1", "r2"]); // 元は変えない
  });
});
