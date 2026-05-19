/**
 * PrimaryKeyConstraint schema tests (#1185 提案 C)
 *
 * 新設 PrimaryKeyConstraint を Constraint.oneOf に追加したことを検証。
 * - kind="primaryKey" + columnIds で表現
 * - composite PK (2 列以上) も valid
 * - columnIds の重複は uniqueItems で拒否
 * - Column.primaryKey との重複は runtime validator で検出 (本テストは schema レベル)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildHarmonyAjv } from "../utils/buildHarmonyAjv";
import type Ajv2020 from "ajv/dist/2020";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateTable: ReturnType<InstanceType<typeof Ajv2020>["compile"]>;

beforeAll(() => {
  const ajv = buildHarmonyAjv();
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateTable = ajv.compile(loadJson(join(v3Dir, "table.v3.schema.json")) as object);
});

const TABLE_BASE = {
  $schema: "../../../schemas/v3/table.v3.schema.json",
  id: "11111111-1111-4111-8111-111111111111",
  name: "fixture table",
  physicalName: "fixtures",
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
  columns: [
    { id: "col-01", no: 1, physicalName: "order_id", name: "OrderID", dataType: "VARCHAR" },
    { id: "col-02", no: 2, physicalName: "line_no", name: "LineNo", dataType: "INTEGER" },
  ],
  indexes: [],
};

function makeTable(constraints: Record<string, unknown>[]) {
  return { ...TABLE_BASE, constraints };
}

describe("PrimaryKeyConstraint schema (#1185 提案 C)", () => {
  it("pass: 単一カラム PK", () => {
    const ok = validateTable(makeTable([{
      id: "pk-01",
      kind: "primaryKey",
      columnIds: ["col-01"],
    }]));
    expect(ok, JSON.stringify(validateTable.errors)).toBe(true);
  });

  it("pass: 複合 PK (composite)", () => {
    const ok = validateTable(makeTable([{
      id: "pk-02",
      kind: "primaryKey",
      columnIds: ["col-01", "col-02"],
    }]));
    expect(ok, JSON.stringify(validateTable.errors)).toBe(true);
  });

  it("pass: physicalName 指定あり", () => {
    const ok = validateTable(makeTable([{
      id: "pk-03",
      kind: "primaryKey",
      physicalName: "pk_order_items",
      columnIds: ["col-01", "col-02"],
    }]));
    expect(ok, JSON.stringify(validateTable.errors)).toBe(true);
  });

  it("fail: columnIds 空", () => {
    const ok = validateTable(makeTable([{
      id: "pk-04",
      kind: "primaryKey",
      columnIds: [],
    }]));
    expect(ok).toBe(false);
  });

  it("fail: columnIds 欠落", () => {
    const ok = validateTable(makeTable([{
      id: "pk-05",
      kind: "primaryKey",
    }]));
    expect(ok).toBe(false);
  });

  it("fail: columnIds 重複 (uniqueItems)", () => {
    const ok = validateTable(makeTable([{
      id: "pk-06",
      kind: "primaryKey",
      columnIds: ["col-01", "col-01"],
    }]));
    expect(ok).toBe(false);
    expect(JSON.stringify(validateTable.errors)).toContain("uniqueItems");
  });

  it("pass: 既存 unique / check / foreignKey 制約と共存", () => {
    const ok = validateTable(makeTable([
      { id: "pk-07", kind: "primaryKey", columnIds: ["col-01"] },
      { id: "uq-01", kind: "unique", columnIds: ["col-02"] },
      { id: "ck-01", kind: "check", expression: "line_no > 0" },
    ]));
    expect(ok, JSON.stringify(validateTable.errors)).toBe(true);
  });
});
