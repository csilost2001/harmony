import { describe, it, expect } from "vitest";
import { collectChanges, describeChange, deepEqual } from "./changeSummary";

const col = (physicalName: string, extra: Record<string, unknown> = {}) => ({ id: physicalName, physicalName, name: physicalName, dataType: "VARCHAR", ...extra });

describe("describeChange", () => {
  it("配列の追加 / 削除を、要素の呼び名つきで言う", () => {
    const a = { columns: [col("id")] };
    const b = { columns: [col("id"), col("amount", { name: "金額" })] };
    expect(describeChange(a, b)).toBe("カラム『amount』の追加");
    expect(describeChange(b, a)).toBe("カラム『amount』の削除");
  });
  it("値の変更は、どの要素のどの項目が、何から何へ変わったかを言う", () => {
    const a = { columns: [col("id"), col("amount", { dataType: "INTEGER" })] };
    const b = { columns: [col("id"), col("amount", { dataType: "BIGINT" })] };
    expect(describeChange(a, b)).toBe("カラム『amount』のデータ型の変更 (INTEGER → BIGINT)");
  });
  it("複数の変更は、最初の 1 つと件数", () => {
    const a = { title: "A", note: "x" };
    const b = { title: "B", note: "y" };
    expect(describeChange(a, b)).toMatch(/ほか 1 か所$/);
  });
  it("真偽値・設定 / 解除", () => {
    expect(describeChange({ items: [{ id: "q", label: "数量" }] }, { items: [{ id: "q", label: "数量", required: true }] })).toBe("項目『数量』の必須の設定");
    expect(describeChange({ items: [{ id: "q", label: "数量", required: true }] }, { items: [{ id: "q", label: "数量" }] })).toBe("項目『数量』の必須の解除");
  });
  it("差が無ければ、内容の変更", () => {
    expect(describeChange({ a: 1 }, { a: 1 })).toBe("内容の変更");
  });
  it("長い値は縮める", () => {
    const d = describeChange({ steps: [{ id: "s", name: "x", sql: "a".repeat(80) }] }, { steps: [{ id: "s", name: "x", sql: "b".repeat(80) }] });
    expect(d.length).toBeLessThan(80);
  });
});

describe("collectChanges / deepEqual", () => {
  it("同じ内容なら、差は無い", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(collectChanges({ a: [1] }, { a: [1] })).toEqual([]);
  });
  it("並べ替えは、変更として拾う (追加・削除にしない)", () => {
    const c = collectChanges({ l: [1, 2, 3] }, { l: [3, 2, 1] });
    expect(c.every((x) => x.kind === "change")).toBe(true);
  });
});
