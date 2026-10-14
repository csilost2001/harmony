import { describe, it, expect } from "vitest";
import { conflictingPhysicalNames, planColumnPaste } from "./columnClipboard";
import type { Column } from "../types/v3";

const col = (id: string, physicalName: string, extra: Partial<Column> = {}): Column => ({ id, no: 1, physicalName, name: physicalName, dataType: "VARCHAR", ...extra }) as unknown as Column;

describe("planColumnPaste", () => {
  const existing = [col("col-01", "id", { primaryKey: true, autoIncrement: true }), col("col-02", "name")];

  it("貼るカラムには、既存と重ならない新しい ID を付ける", () => {
    const plan = planColumnPaste(existing, [col("col-01", "memo"), col("col-02", "note")], false);
    expect(plan.columns.map((c) => c.id)).toEqual(["col-03", "col-04"]);
  });

  it("ID の空き番号を飛ばして付ける (途中が欠けていても重ならない)", () => {
    const gap = [col("col-01", "a"), col("col-03", "c")];
    const plan = planColumnPaste(gap, [col("x", "d"), col("y", "e")], false);
    expect(plan.columns.map((c) => c.id)).toEqual(["col-04", "col-05"]);
  });

  it("物理名が重なれば _copy を付け、付け替えを返す。貼る中で重なるものも別名にする", () => {
    const plan = planColumnPaste(existing, [col("a", "name"), col("b", "name")], false);
    expect(plan.columns.map((c) => c.physicalName)).toEqual(["name_copy", "name_copy_copy"]);
    expect(plan.renamed).toEqual([{ from: "name", to: "name_copy" }, { from: "name", to: "name_copy_copy" }]);
  });

  it("別のテーブルへ貼るとき、貼り先に主キーがあれば、貼るカラムの主キー・自動採番の印を外す", () => {
    const plan = planColumnPaste(existing, [col("a", "order_id", { primaryKey: true, autoIncrement: true, notNull: true })], true);
    expect(plan.columns[0].primaryKey).toBeUndefined();
    expect(plan.columns[0].autoIncrement).toBeUndefined();
    expect(plan.columns[0].notNull).toBe(true);
    expect(plan.droppedKeys).toBe(1);
  });

  it("貼り先に主キーが無ければ主キーは残る。同じテーブルの中でも外さない", () => {
    expect(planColumnPaste([col("col-01", "x")], [col("a", "order_id", { primaryKey: true })], true).columns[0].primaryKey).toBe(true);
    expect(planColumnPaste(existing, [col("a", "order_id", { primaryKey: true })], false).columns[0].primaryKey).toBe(true);
  });

  it("元のカラムは書き換えない", () => {
    const src = col("a", "name", { primaryKey: true });
    planColumnPaste(existing, [src], true);
    expect(src.physicalName).toBe("name");
    expect(src.primaryKey).toBe(true);
  });
});

describe("conflictingPhysicalNames", () => {
  it("重なる物理名を 1 度ずつ返す", () => {
    const ex = [col("1", "id"), col("2", "name")];
    expect(conflictingPhysicalNames(ex, [col("a", "name"), col("b", "name"), col("c", "z")])).toEqual(["name"]);
    expect(conflictingPhysicalNames(ex, [col("c", "z")])).toEqual([]);
  });
});
