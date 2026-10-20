import { describe, expect, it } from "vitest";
import type { DesignDocInput } from "../designDocument.js";
import { deriveSqlCatalog, findDuplicateSql, normalizeSql, sqlCatalogToCsv } from "./sqlCatalog.js";

const Q = "SELECT id, name, email FROM customers WHERE id = @inputs.customerId AND status = 'active'";
const mk = (steps: unknown[]): DesignDocInput => ({
  screens: [], tables: [{ id: "customer", name: "顧客", physicalName: "customers" }],
  flows: [
    { meta: { id: "f1", name: "注文" }, actions: [{ id: "a1", name: "確定", steps: [
      { id: "s1", kind: "dbAccess", description: "取得", tableId: "customer", operation: "SELECT", sql: Q, outputBinding: { name: "c" } },
      { id: "s2", kind: "branch", description: "", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "@c == null" }, steps: [
        { id: "s3", kind: "dbAccess", description: "再取得", tableId: "customer", operation: "SELECT", sql: Q.replace("@inputs.customerId", "@var.other").toLowerCase() },
      ] }] },
      ...steps,
    ] }] },
    { meta: { id: "f2", name: "照会" }, actions: [{ id: "a2", name: "表示", steps: [{ id: "s9", kind: "dbAccess", description: "", operation: "SELECT", sql: Q }] }] },
  ],
}) as unknown as DesignDocInput;

describe("SQL の一覧と重複", () => {
  it("入れ子の中も含めて、SQL つきの DB アクセス工程を集める", () => {
    const e = deriveSqlCatalog(mk([{ id: "s5", kind: "dbAccess", description: "SQL なし", tableId: "customer" }]));
    expect(e.map((x) => x.stepId)).toEqual(["s1", "s3", "s9"]);
    expect(e[0]).toMatchObject({ flow: { id: "f1", name: "注文" }, table: { id: "customer", name: "顧客" }, operation: "SELECT", binding: "c" });
  });
  it("変数・空白・大文字小文字・文字列の違いを除いて、同じ SQL をまとめる", () => {
    expect(normalizeSql("SELECT  a FROM t WHERE x = @inputs.y AND z = 'k'")).toBe(normalizeSql("select a from t where x = :y and z = 'other'"));
    const d = findDuplicateSql(deriveSqlCatalog(mk([])));
    expect(d).toHaveLength(1);
    expect(d[0].entries.map((x) => x.stepId)).toEqual(["s1", "s3", "s9"]);
    expect(d[0].crossFlow).toBe(true);
  });
  it("短い SQL は、重複とは数えない", () => {
    const d = findDuplicateSql(deriveSqlCatalog(mk([{ id: "t1", kind: "dbAccess", sql: "SELECT 1" }, { id: "t2", kind: "dbAccess", sql: "SELECT 1" }])));
    expect(d).toHaveLength(1);
  });
  it("CSV: 同じ SQL の件数が付く。= で始まる値は式にならない", () => {
    const csv = sqlCatalogToCsv(deriveSqlCatalog(mk([])));
    expect(csv.split("\r\n")[0]).toContain("同じ SQL の件数");
    expect(csv).toContain(",3,");
  });
});
