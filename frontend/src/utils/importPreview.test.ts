import { describe, it, expect } from "vitest";
import { compareTableDefinition } from "./importPreview";

const col = (physicalName: string, extra: Record<string, unknown> = {}) => ({ id: `c-${physicalName}`, physicalName, name: physicalName, dataType: "VARCHAR", ...extra });

describe("compareTableDefinition", () => {
  it("同じ定義 (id・表示名・更新日の違いは見ない) なら、変更なし", () => {
    const a = { columns: [col("id", { dataType: "BIGINT", primaryKey: true }), col("name", { length: 20 })], indexes: [{ physicalName: "idx_name" }] };
    const b = { columns: [{ ...col("id", { dataType: "BIGINT", primaryKey: true }), id: "x1", name: "ID" }, col("name", { length: 20, notNull: false })], indexes: [{ physicalName: "idx_name" }] };
    const r = compareTableDefinition(a, b);
    expect(r.same).toBe(true);
    expect(r.lines).toEqual([]);
  });
  it("カラムの追加・削除・型や桁の変更を、人の言葉で出す", () => {
    const a = { columns: [col("id", { dataType: "BIGINT" }), col("name", { length: 20 }), col("old")] };
    const b = { columns: [col("id", { dataType: "BIGINT" }), col("name", { length: 40 }), col("memo")] };
    const r = compareTableDefinition(a, b);
    expect(r.same).toBe(false);
    const text = r.lines.join("\n");
    expect(text).toContain("memo");
    expect(text).toContain("old");
    expect(text).toContain("20 → 40");
  });
  it("インデックスの増減も差になる。列が無い定義でも落ちない", () => {
    expect(compareTableDefinition({ columns: [] }, { columns: [], indexes: [{ physicalName: "idx_a" }] }).same).toBe(false);
    expect(compareTableDefinition({}, {}).same).toBe(true);
  });
});
