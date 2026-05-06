import { describe, it, expect } from "vitest";
import { mcpTableToSpecEntry } from "./specExport.js";

function makeRawTable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    name: "orders",
    logicalName: "注文",
    description: "注文テーブル",
    columns: [
      { id: "c1", name: "id", logicalName: "ID", dataType: "INTEGER", notNull: true, primaryKey: true, unique: false, autoIncrement: true },
      { id: "c2", name: "customer_id", logicalName: "顧客ID", dataType: "INTEGER", notNull: true, primaryKey: false, unique: false },
    ],
    indexes: [],
    ...overrides,
  };
}

describe("mcpTableToSpecEntry", () => {
  it("基本フィールドが出力される", () => {
    const result = mcpTableToSpecEntry(makeRawTable());
    expect(result.name).toBe("orders");
    expect(result.logicalName).toBe("注文");
    expect((result.columns as unknown[]).length).toBe(2);
  });

  it("constraints/defaults/triggers が undefined のとき出力に含まれない", () => {
    const result = mcpTableToSpecEntry(makeRawTable());
    expect(result.constraints).toBeUndefined();
    expect(result.defaults).toBeUndefined();
    expect(result.triggers).toBeUndefined();
  });

  it("空配列のとき出力に含まれない", () => {
    const result = mcpTableToSpecEntry(makeRawTable({ constraints: [], defaults: [], triggers: [] }));
    expect(result.constraints).toBeUndefined();
    expect(result.defaults).toBeUndefined();
    expect(result.triggers).toBeUndefined();
  });

  it("UNIQUE 制約が出力に含まれる", () => {
    const constraints = [{ id: "uq1", kind: "unique", columns: ["customer_id"], description: "一意制約" }];
    const result = mcpTableToSpecEntry(makeRawTable({ constraints }));
    expect(result.constraints).toEqual(constraints);
  });

  it("CHECK 制約が出力に含まれる", () => {
    const constraints = [{ id: "ck1", kind: "check", expression: "amount > 0" }];
    const result = mcpTableToSpecEntry(makeRawTable({ constraints }));
    expect(result.constraints).toEqual(constraints);
  });

  it("FOREIGN KEY 制約が出力に含まれる", () => {
    const constraints = [{
      id: "fk1", kind: "foreignKey",
      columns: ["customer_id"], referencedTable: "customers", referencedColumns: ["id"],
      onDelete: "CASCADE",
    }];
    const result = mcpTableToSpecEntry(makeRawTable({ constraints }));
    expect((result.constraints as typeof constraints)[0]).toMatchObject({ kind: "foreignKey", onDelete: "CASCADE" });
  });

  it("DEFAULT 定義が出力に含まれる", () => {
    const defaults = [
      { column: "created_at", kind: "function", value: "NOW()" },
      { column: "status", kind: "literal", value: "'active'" },
    ];
    const result = mcpTableToSpecEntry(makeRawTable({ defaults }));
    expect(result.defaults).toEqual(defaults);
  });

  it("トリガー定義が出力に含まれる", () => {
    const triggers = [{
      id: "tr1", timing: "BEFORE", events: ["INSERT", "UPDATE"],
      body: "SET NEW.updated_at = NOW();",
    }];
    const result = mcpTableToSpecEntry(makeRawTable({ triggers }));
    expect(result.triggers).toEqual(triggers);
  });

  it("constraints / defaults / triggers が混在しても全て出力される", () => {
    const raw = makeRawTable({
      constraints: [{ id: "uq1", kind: "unique", columns: ["customer_id"] }],
      defaults: [{ column: "status", kind: "literal", value: "'active'" }],
      triggers: [{ id: "tr1", timing: "AFTER", events: ["INSERT"], body: "..." }],
    });
    const result = mcpTableToSpecEntry(raw);
    expect((result.constraints as unknown[]).length).toBe(1);
    expect((result.defaults as unknown[]).length).toBe(1);
    expect((result.triggers as unknown[]).length).toBe(1);
  });

  it("foreignKey 列が reference に変換される", () => {
    const raw = makeRawTable({
      columns: [{
        id: "c1", name: "customer_id", logicalName: "顧客ID", dataType: "INTEGER",
        notNull: true, primaryKey: false, unique: false,
        foreignKey: { tableId: "customers", columnName: "id" },
      }],
    });
    const result = mcpTableToSpecEntry(raw);
    const col = (result.columns as Array<Record<string, unknown>>)[0];
    expect(col.reference).toMatchObject({ table: "customers", column: "id", type: "physical" });
  });
});
