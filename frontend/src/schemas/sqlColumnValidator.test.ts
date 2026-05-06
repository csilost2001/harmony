import { describe, it, expect } from "vitest";
import { validateSql, checkSqlColumns } from "./sqlColumnValidator";
import type { TableDefinition } from "./sqlColumnValidator";
import type { ProcessFlow } from "../types/action";

function makeSpec(name: string, cols: string[]): Map<string, { name: string; columns: Set<string> }> {
  return new Map([[name.toLowerCase(), { name: name.toLowerCase(), columns: new Set(cols.map((c) => c.toLowerCase())) }]]);
}

describe("validateSql — 単体 SQL 検査", () => {
  it("SELECT: 存在する列は OK", () => {
    const defs = makeSpec("customers", ["id", "name", "email", "is_deleted"]);
    const issues = validateSql("SELECT id, name FROM customers WHERE id = @x AND is_deleted = false", defs, "t");
    expect(issues.filter((i) => i.code === "UNKNOWN_COLUMN")).toHaveLength(0);
  });

  it("SELECT: 存在しない列を検出", () => {
    const defs = makeSpec("customers", ["id", "name"]);
    const issues = validateSql("SELECT id, nonexistent_col FROM customers", defs, "t");
    expect(issues.some((i) => i.code === "UNKNOWN_COLUMN" && i.value.includes("nonexistent_col"))).toBe(true);
  });

  it("INSERT: 列リストが存在列内か検査", () => {
    const defs = makeSpec("orders", ["id", "customer_id", "total"]);
    const ok = validateSql(
      "INSERT INTO orders (customer_id, total) VALUES (@a, @b)", defs, "t",
    );
    expect(ok.filter((i) => i.code === "UNKNOWN_COLUMN")).toHaveLength(0);

    const ng = validateSql(
      "INSERT INTO orders (customer_id, fake_col) VALUES (@a, @b)", defs, "t",
    );
    expect(ng.some((i) => i.value.includes("fake_col"))).toBe(true);
  });

  it("UPDATE: SET 側の列検査", () => {
    const defs = makeSpec("inventory", ["item_id", "stock", "reserved", "updated_at"]);
    const issues = validateSql(
      "UPDATE inventory SET stock = stock - @x, fake_col = @y WHERE item_id = @z", defs, "t",
    );
    expect(issues.some((i) => i.value.includes("fake_col"))).toBe(true);
  });

  it("alias 解決: c.id は customers.id を参照", () => {
    const defs = makeSpec("customers", ["id", "name"]);
    const issues = validateSql(
      "SELECT c.id, c.name FROM customers c WHERE c.id = @x", defs, "t",
    );
    expect(issues.filter((i) => i.code === "UNKNOWN_COLUMN")).toHaveLength(0);
  });

  it("SQL パース失敗は SQL_PARSE_ERROR", () => {
    const defs = makeSpec("t", ["x"]);
    const issues = validateSql("SELEKT * BROKEN", defs, "path");
    expect(issues.some((i) => i.code === "SQL_PARSE_ERROR")).toBe(true);
  });

  it("@ 参照は ? に置換されてパースされる", () => {
    const defs = makeSpec("customers", ["id", "email"]);
    const issues = validateSql(
      "SELECT id, email FROM customers WHERE id = @customerId AND deleted = @isDeleted", defs, "t",
    );
    expect(issues.filter((i) => i.code !== "UNKNOWN_COLUMN")).toHaveLength(0);
    expect(issues.some((i) => i.value.includes("deleted"))).toBe(true);
  });

  it("カタログ未知テーブルの列は issue 化しない (外部参照スキップ)", () => {
    const defs = makeSpec("customers", ["id"]);
    // "external_table" は defs に無い → 列検査対象外
    const issues = validateSql(
      "SELECT x, y FROM external_table WHERE z = @x", defs, "t",
    );
    expect(issues.filter((i) => i.code === "UNKNOWN_COLUMN")).toHaveLength(0);
  });
});

