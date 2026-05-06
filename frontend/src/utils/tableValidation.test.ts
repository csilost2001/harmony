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
});
