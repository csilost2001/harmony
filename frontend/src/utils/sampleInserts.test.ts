import { describe, it, expect } from "vitest";
import type { Column, Table } from "../types/v3";
import { generateSampleInserts } from "./sampleInserts";

const col = (physicalName: string, name: string, dataType: string, extra: Record<string, unknown> = {}) => ({ id: physicalName, physicalName, name, dataType, ...extra }) as unknown as Column;
const tbl = (physicalName: string, columns: Column[]) => ({ physicalName, columns }) as unknown as Pick<Table, "physicalName" | "columns">;
const table = tbl("orders", [
    col("id", "ID", "BIGINT", { primaryKey: true, autoIncrement: true }),
    col("order_no", "注文番号", "VARCHAR", { length: 12, unique: true }),
    col("customer_name", "氏名", "VARCHAR", { length: 30 }),
    col("amount", "金額", "DECIMAL", { length: 10, scale: 2 }),
    col("ordered_on", "注文日", "DATE"),
    col("shipped_at", "出荷日時", "TIMESTAMP"),
    col("is_paid", "支払済み", "BOOLEAN"),
    col("note", "備考", "TEXT"),
]);

describe("generateSampleInserts (続編 第 8 弾 #153)", () => {
  const sql = generateSampleInserts(table, 3);
  const lines = sql.split("\n");
  it("行数ぶんの INSERT を作る。自動採番の列は含めない", () => {
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("INSERT INTO orders (order_no, customer_name, amount, ordered_on, shipped_at, is_paid, note) VALUES");
    expect(sql).not.toContain("(id,");
  });
  it("型に合った値: 数値は引用符なし・文字と日付は引用符あり・真偽は TRUE / FALSE", () => {
    expect(lines[0]).toMatch(/'山田 太郎'/);
    expect(lines[0]).toMatch(/12,800|12800/);
    expect(lines[0]).toContain("'2026-10-16'");
    expect(lines[0]).toContain("'2026-10-16 10:30:00'");
    expect(lines[0]).toContain("TRUE");
    expect(lines[1]).toContain("FALSE");
  });
  it("ユニーク・主キーの列は、行ごとに違う値で、桁数に収まる", () => {
    const orderNos = lines.map((l) => /VALUES \('([^']*)'/.exec(l)![1]);
    expect(new Set(orderNos).size).toBe(3);
    for (const v of orderNos) expect(v.length).toBeLessThanOrEqual(12);
  });
  it("桁数のある文字の列は、桁数を超えない", () => {
    for (const l of lines) { const name = /'([^']*)', [\d.,]+, '20/.exec(l)?.[1] ?? ""; expect(name.length).toBeLessThanOrEqual(30); }
  });
  it("引用符は 2 重にする / 空・0 行は空文字", () => {
    const t = tbl("t", [col("memo", "名前", "VARCHAR", { length: 3 })]);
    expect(generateSampleInserts(t, 1)).toContain("VALUES ('");
    expect(generateSampleInserts(tbl("t", []), 3)).toBe("");
    expect(generateSampleInserts(table, 0)).toBe("");
  });
  it("行数の上限は 50", () => { expect(generateSampleInserts(table, 999).split("\n")).toHaveLength(50); });
});
