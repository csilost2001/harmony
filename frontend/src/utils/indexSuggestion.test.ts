import { describe, it, expect } from "vitest";
import type { Table } from "../types/v3";
import { suggestIndexes, whereColumns } from "./indexSuggestion";

const col = (physicalName: string, extra: Record<string, unknown> = {}) => ({ id: `c-${physicalName}`, physicalName, name: physicalName, dataType: "BIGINT", ...extra });
const table = {
  id: "inventory", physicalName: "inventory",
  columns: [col("id", { primaryKey: true }), col("product_id"), col("store_id"), col("quantity_available"), col("updated_at")],
  indexes: [],
  constraints: [{ id: "fk1", kind: "foreignKey", columnIds: ["c-product_id"], referencedTableId: "product", referencedColumnIds: ["c-id"] }],
} as unknown as Table;

describe("whereColumns (続編 第 8 弾 #154)", () => {
  it("WHERE の列を、等号 / IN と範囲に分けて出てきた順に拾う", () => {
    const r = whereColumns("UPDATE inventory SET quantity_available = quantity_available - 1 WHERE product_id = @a AND store_id = @b AND quantity_available >= @c", table);
    expect(r.eq).toEqual(["product_id", "store_id"]);
    expect(r.range).toEqual(["quantity_available"]);
  });
  it("SET の列・別のテーブルの別名の列は数えない", () => {
    const r = whereColumns("SELECT i.id FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.store_id = @s AND p.product_id = 1", table);
    expect(r.eq).toEqual(["store_id"]);
  });
  it("WHERE が無ければ空 / GROUP BY 以降は読まない", () => {
    expect(whereColumns("SELECT * FROM inventory", table)).toEqual({ eq: [], range: [] });
    expect(whereColumns("SELECT * FROM inventory WHERE store_id = 1 ORDER BY updated_at", table).range).toEqual([]);
  });
});

describe("suggestIndexes", () => {
  const flows = [
    { meta: { id: "f1", name: "在庫減算" }, actions: [{ steps: [{ id: "s1", kind: "dbAccess", tableId: "inventory", operation: "UPDATE", description: "在庫を減らす", sql: "UPDATE inventory SET quantity_available = quantity_available - 1 WHERE product_id = @a AND store_id = @b" }, { id: "s2", kind: "dbAccess", tableId: "other", operation: "SELECT", sql: "SELECT * FROM other WHERE product_id = 1" }] }] },
    { meta: { id: "f2" }, actions: [{ steps: [{ id: "s3", kind: "dbAccess", tableId: "inventory", operation: "SELECT", sql: "SELECT * FROM inventory WHERE product_id = @a AND store_id = @b" }, { id: "s4", kind: "dbAccess", tableId: "inventory", operation: "INSERT", sql: "INSERT INTO inventory (product_id) VALUES (1)" }] }] },
  ];
  it("検索条件の列の組と、外部キーの列を提案し、根拠の処理フローを添える。同じ組は 1 つにまとめる", () => {
    const r = suggestIndexes(table, flows);
    const key = (s: { columns: string[] }) => s.columns.join(",");
    expect(r.map(key)).toContain("product_id,store_id");
    const main = r.find((s) => key(s) === "product_id,store_id")!;
    expect(main.sources).toHaveLength(2);
    expect(main.sources[0]).toContain("在庫減算");
    expect(r.find((s) => key(s) === "product_id")?.sources).toEqual(["外部キー"]);
    expect(r.some((s) => s.sources.some((x) => x.includes("INSERT")))).toBe(false);
  });
  it("すでに索引・主キーが先頭から覆っている組は、提案しない", () => {
    const covered = { ...table, indexes: [{ id: "i1", physicalName: "idx_inv", columns: [{ columnId: "c-store_id" }, { columnId: "c-product_id" }] }] } as unknown as Table;
    const r = suggestIndexes(covered, flows);
    expect(r.map((s) => s.columns.join(","))).not.toContain("product_id,store_id");
    expect(r.map((s) => s.columns.join(","))).toContain("product_id"); // 外部キーの単独の列は、複合索引の 2 列目では覆われない
    const pk = suggestIndexes({ ...table, constraints: [] } as unknown as Table, [{ meta: { id: "f" }, actions: [{ steps: [{ id: "x", kind: "dbAccess", tableId: "inventory", operation: "SELECT", sql: "SELECT * FROM inventory WHERE id = 1" }] }] }]);
    expect(pk).toEqual([]);
  });
  it("主キーが 1 列なら、その列を含む組は勧めない (主キーの索引で足りる)", () => {
    const r = suggestIndexes({ ...table, constraints: [] } as unknown as Table, [{ meta: { id: "f" }, actions: [{ steps: [{ id: "x", kind: "dbAccess", tableId: "inventory", operation: "SELECT", sql: "SELECT * FROM inventory WHERE id = 1 AND store_id = 2" }] }] }]);
    expect(r.map((s) => s.columns.join(","))).not.toContain("id,store_id");
  });
});
