import { describe, it, expect } from "vitest";
import type { ProcessFlow, DbAccessStep, LocalId, Description, TableId } from "../types/v3";
import { migrateProcessFlow } from "../utils/actionMigration";

// #1355 Codex Must-fix: type 注釈で type shape を検証、brand のみ局所 cast。

describe("DbAccessStep の sql フィールド (#170)", () => {
  it("sql に完全な SELECT 文を保持できる", () => {
    const step: DbAccessStep = {
      id: "s1" as LocalId,
      kind: "dbAccess",
      description: "JOIN つき検索" as Description,
      tableId: "orders" as TableId,
      operation: "SELECT",
      sql: "SELECT o.id, o.order_number, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.order_date BETWEEN @from AND @to",
    };
    expect(step.sql).toContain("JOIN customers");
  });

  it("sql に INSERT ... RETURNING を保持できる", () => {
    const step: DbAccessStep = {
      id: "s2" as LocalId,
      kind: "dbAccess",
      description: "注文ヘッダ登録" as Description,
      tableId: "orders" as TableId,
      operation: "INSERT",
      sql: "INSERT INTO orders (customer_id, subtotal, total_amount) VALUES (@customerId, @subtotal, @total) RETURNING id, order_number",
    };
    expect(step.sql).toContain("RETURNING");
  });

  it("sql と fields は併用可能 (sql が優先する運用規約)", () => {
    const step: DbAccessStep = {
      id: "s3" as LocalId,
      kind: "dbAccess",
      description: "" as Description,
      tableId: "customers" as TableId,
      operation: "SELECT",
      sql: "SELECT id FROM customers WHERE email = @email AND is_deleted = false LIMIT 1",
      fields: "id (email で検索)",
    };
    expect(step.sql).toBeTruthy();
    expect(step.fields).toBeTruthy();
  });

  it("sql なしの旧データも引き続き動作 (fields + operation のみ)", () => {
    const step: DbAccessStep = {
      id: "s4" as LocalId,
      kind: "dbAccess",
      description: "" as Description,
      tableId: "customers" as TableId,
      operation: "SELECT",
      fields: "name, email",
    };
    expect(step.sql).toBeUndefined();
    expect(step.fields).toBe("name, email");
  });
});

describe("migrateProcessFlow — dbAccess.sql 透過保持 (#170)", () => {
  it("sql を持つ DbAccessStep を冪等マイグレーションできる", () => {
    const raw: unknown = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "submit",
        steps: [{
          id: "s", type: "dbAccess", description: "",
          tableName: "customers", operation: "INSERT",
          sql: "INSERT INTO customers (name) VALUES (@name) RETURNING id",
        }],
      }],
      createdAt: "", updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const step = once.actions[0].steps[0] as DbAccessStep;
    expect(step.sql).toContain("RETURNING id");
  });

  it("sql なしの旧データは破壊なし", () => {
    const raw: unknown = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "click",
        steps: [{ id: "s", type: "dbAccess", description: "", tableName: "x", operation: "SELECT", fields: "col1, col2" }],
      }],
      createdAt: "", updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    const step = migrated.actions[0].steps[0] as DbAccessStep;
    expect(step.sql).toBeUndefined();
    expect(step.fields).toBe("col1, col2");
  });
});
