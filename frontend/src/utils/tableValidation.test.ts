import { describe, expect, it } from "vitest";
import type { Column, DisplayName, LocalId, PhysicalName, Table, TableId, Timestamp } from "../types/v3";
import { validateTable } from "./tableValidation";

const ts = "2026-04-29T00:00:00.000Z" as Timestamp;

function column(overrides: Partial<Column> = {}): Column {
  return {
    id: "col-01" as LocalId,
    no: 1,
    physicalName: "customer_id" as PhysicalName,
    name: "顧客ID" as DisplayName,
    dataType: "VARCHAR",
    primaryKey: true,
    ...overrides,
  };
}

function table(overrides: Partial<Table> = {}): Table {
  return {
    id: "11111111-1111-4111-8111-111111111111" as TableId,
    name: "顧客マスタ" as DisplayName,
    physicalName: "customers" as PhysicalName,
    columns: [column()],
    indexes: [],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("validateTable", () => {
  it("columns empty -> warning", () => {
    const errors = validateTable(table({ columns: [] }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "table.columns.empty",
      message: "カラムが未定義です",
    }));
  });

  it("primary key empty -> warning", () => {
    const errors = validateTable(table({ columns: [column({ primaryKey: false })] }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "table.primaryKey.empty",
      message: "主キーが未指定です",
    }));
  });

  it("physicalName empty -> error", () => {
    const errors = validateTable(table({ physicalName: "  " as PhysicalName }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "table.physicalName.empty",
      message: "物理名が必須です",
    }));
  });

  it("physicalName duplicate within same namespace -> error", () => {
    const target = table();
    const duplicate = table({
      id: "22222222-2222-4222-8222-222222222222" as TableId,
      name: "別テーブル" as DisplayName,
    });

    const errors = validateTable(target, [target, duplicate]);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "table.physicalName.duplicate",
      message: '同じ名前空間に物理名 "customers" のテーブルが既に存在します',
    }));
  });

  it("physicalName same value in different namespace -> no error", () => {
    const ns1 = { ...table(), namespace: "sales" } as Table & { namespace: string };
    const ns2 = {
      ...table({ id: "22222222-2222-4222-8222-222222222222" as TableId }),
      namespace: "marketing",
    } as Table & { namespace: string };

    const errors = validateTable(ns1, [ns1, ns2]);

    expect(errors.find((e) => e.code === "table.physicalName.duplicate")).toBeUndefined();
  });

  it("columns empty does not double-fire primaryKey.empty", () => {
    const errors = validateTable(table({ columns: [] }), []);

    expect(errors.filter((e) => e.code === "table.primaryKey.empty")).toHaveLength(0);
    expect(errors.filter((e) => e.code === "table.columns.empty")).toHaveLength(1);
  });

  it("displayName empty -> warning", () => {
    const errors = validateTable(table({ name: "  " as DisplayName }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "table.displayName.empty",
      message: "表示名が未定義です",
    }));
  });

  it("valid table -> no errors", () => {
    const target = table();

    expect(validateTable(target, [target])).toEqual([]);
  });

  // #1185 追加#2: FK columnIds と referencedColumnIds の件数一致検証
  describe("FK column count mismatch (#1185 追加#2)", () => {
    const fkColumn = (id: string, name: string, primaryKey = false): Column => column({
      id: id as LocalId,
      physicalName: name as PhysicalName,
      name: name as DisplayName,
      primaryKey,
    });

    it("件数一致 -> no error", () => {
      const t = table({
        columns: [fkColumn("col-01", "id", true), fkColumn("col-02", "ref_a"), fkColumn("col-03", "ref_b")],
        constraints: [{
          id: "fk-01",
          kind: "foreignKey",
          columnIds: ["col-02", "col-03"],
          referencedTableId: "22222222-2222-4222-8222-222222222222",
          referencedColumnIds: ["other_id_1", "other_id_2"],
        }],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors.find((e) => e.code === "table.foreignKey.columnCountMismatch")).toBeUndefined();
    });

    it("件数不一致 (1 vs 2) -> error", () => {
      const t = table({
        columns: [fkColumn("col-01", "id", true), fkColumn("col-02", "ref_a")],
        constraints: [{
          id: "fk-02",
          kind: "foreignKey",
          columnIds: ["col-02"],
          referencedTableId: "22222222-2222-4222-8222-222222222222",
          referencedColumnIds: ["other_id_1", "other_id_2"],
        }],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "table.foreignKey.columnCountMismatch",
        path: "constraints[0].referencedColumnIds",
      }));
    });

    it("件数不一致 (2 vs 1) -> error", () => {
      const t = table({
        columns: [fkColumn("col-01", "id", true), fkColumn("col-02", "ref_a"), fkColumn("col-03", "ref_b")],
        constraints: [{
          id: "fk-03",
          kind: "foreignKey",
          columnIds: ["col-02", "col-03"],
          referencedTableId: "22222222-2222-4222-8222-222222222222",
          referencedColumnIds: ["other_id_1"],
        }],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "table.foreignKey.columnCountMismatch",
      }));
    });

    it("FK 以外の制約は対象外", () => {
      const t = table({
        columns: [fkColumn("col-01", "id", true), fkColumn("col-02", "ref_a")],
        constraints: [{
          id: "uq-01",
          kind: "unique",
          columnIds: ["col-02"],
        }],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors.find((e) => e.code === "table.foreignKey.columnCountMismatch")).toBeUndefined();
    });
  });

  // #1185 提案 C: PrimaryKeyConstraint と Column.primaryKey の重複検証
  describe("PrimaryKey mutual exclusion (#1185 提案 C)", () => {
    const pkCol = (id: string, name: string, primaryKey: boolean): Column => column({
      id: id as LocalId,
      physicalName: name as PhysicalName,
      name: name as DisplayName,
      primaryKey,
    });

    it("PK 未指定 (どちらもなし) -> warning", () => {
      const t = table({
        columns: [pkCol("col-01", "id", false)],
      });
      const errors = validateTable(t, [t]);
      expect(errors).toContainEqual(expect.objectContaining({
        code: "table.primaryKey.empty",
      }));
    });

    it("Column.primaryKey のみ -> OK (single-column PK 表現)", () => {
      const t = table({
        columns: [pkCol("col-01", "id", true)],
      });
      const errors = validateTable(t, [t]);
      expect(errors.find((e) => e.code === "table.primaryKey.empty")).toBeUndefined();
      expect(errors.find((e) => e.code === "table.primaryKey.duplicated")).toBeUndefined();
    });

    it("PrimaryKeyConstraint のみ -> OK (composite PK 表現可)", () => {
      const t = table({
        columns: [pkCol("col-01", "order_id", false), pkCol("col-02", "line_no", false)],
        constraints: [{
          id: "pk-01",
          kind: "primaryKey",
          columnIds: ["col-01", "col-02"],
        }],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors.find((e) => e.code === "table.primaryKey.empty")).toBeUndefined();
      expect(errors.find((e) => e.code === "table.primaryKey.duplicated")).toBeUndefined();
    });

    it("Column.primaryKey + PrimaryKeyConstraint 併用 -> error (duplicated)", () => {
      const t = table({
        columns: [pkCol("col-01", "id", true)],
        constraints: [{
          id: "pk-01",
          kind: "primaryKey",
          columnIds: ["col-01"],
        }],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "table.primaryKey.duplicated",
      }));
    });

    it("PrimaryKeyConstraint 複数 -> error (multipleConstraints)", () => {
      const t = table({
        columns: [pkCol("col-01", "id_a", false), pkCol("col-02", "id_b", false)],
        constraints: [
          { id: "pk-01", kind: "primaryKey", columnIds: ["col-01"] },
          { id: "pk-02", kind: "primaryKey", columnIds: ["col-02"] },
        ],
      } as Partial<Table>);
      const errors = validateTable(t, [t]);
      expect(errors).toContainEqual(expect.objectContaining({
        severity: "error",
        code: "table.primaryKey.multipleConstraints",
      }));
    });
  });
});
