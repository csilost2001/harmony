import { describe, it, expect } from "vitest";
import { suggestForeignKeys, singularForms } from "./fkSuggestion";
import type { Table } from "../types/v3";

const col = (id: string, physicalName: string, dataType = "BIGINT", extra: Record<string, unknown> = {}) =>
  ({ id, physicalName, name: physicalName, dataType, ...extra }) as never;
const tbl = (id: string, physicalName: string, columns: unknown[], constraints: unknown[] = []) =>
  ({ id, physicalName, name: physicalName, columns, constraints }) as unknown as Table;

const customers = tbl("customers", "customers", [col("c1", "customer_id", "BIGINT", { primaryKey: true }), col("c2", "name", "VARCHAR")]);
const categories = tbl("categories", "categories", [col("k1", "id", "BIGINT", { primaryKey: true })]);
const orders = tbl("orders", "orders", [
  col("o1", "order_id", "BIGINT", { primaryKey: true }),
  col("o2", "customer_id"),
  col("o3", "category_id"),
  col("o4", "note", "TEXT"),
]);

describe("suggestForeignKeys", () => {
  it("同じ名前の主キー (確度 高) と、<単数形>_id → id (確度 中) を候補にする。高が先", () => {
    const r = suggestForeignKeys(orders, [orders, customers, categories]);
    expect(r.map((x) => [x.column.physicalName, x.refTable.id, x.confidence])).toEqual([
      ["customer_id", "customers", "high"],
      ["category_id", "categories", "medium"],
    ]);
    expect(r[0].reason).toContain("customers.customer_id");
  });

  it("主キー自身・既に外部キーの列・自分自身は候補にしない", () => {
    const withFk = { ...orders, constraints: [{ id: "f", kind: "foreignKey", columnIds: ["o2"], referencedTableId: "customers", referencedColumnIds: ["c1"] }] } as unknown as Table;
    expect(suggestForeignKeys(withFk, [withFk, customers, categories]).map((x) => x.column.physicalName)).toEqual(["category_id"]);
    expect(suggestForeignKeys(customers, [customers]).length).toBe(0);
  });

  it("型の系統が違えば候補にしない / 複合主キーのテーブルは参照先にしない", () => {
    const strCust = { ...orders, columns: [col("o2", "customer_id", "VARCHAR")] } as unknown as Table;
    expect(suggestForeignKeys(strCust, [strCust, customers]).length).toBe(0);
    const composite = tbl("items", "items", [col("i1", "order_id", "BIGINT", { primaryKey: true }), col("i2", "line_no", "INTEGER", { primaryKey: true })]);
    expect(suggestForeignKeys(tbl("x", "x", [col("x1", "order_id")]), [composite]).length).toBe(0);
  });

  it("単数形の候補", () => {
    expect(singularForms("customers")).toContain("customer");
    expect(singularForms("categories")).toContain("category");
    expect(singularForms("boxes")).toContain("box");
    expect(singularForms("m_products")).toContain("product");
  });
});
