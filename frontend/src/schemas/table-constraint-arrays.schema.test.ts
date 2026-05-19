/**
 * Table constraint array schema tests (#1185 追加#1)
 *
 * UniqueConstraint / ForeignKeyConstraint の column 配列が uniqueItems で重複拒否することを検証。
 * 件数一致 (#1185 追加#2) は AJV 単体では表現困難なため runtime validator (tableValidation.test.ts) で検証。
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
    { id: "col-01", no: 1, physicalName: "id", name: "ID", dataType: "VARCHAR", primaryKey: true },
    { id: "col-02", no: 2, physicalName: "ref_a", name: "RefA", dataType: "VARCHAR" },
    { id: "col-03", no: 3, physicalName: "ref_b", name: "RefB", dataType: "VARCHAR" },
  ],
  indexes: [],
};

function makeTable(constraints: Record<string, unknown>[]) {
  return { ...TABLE_BASE, constraints };
}

describe("UniqueConstraint.columnIds uniqueItems (#1185 追加#1)", () => {
  it("pass: 重複なし", () => {
    const ok = validateTable(makeTable([{
      id: "uq-01",
      kind: "unique",
      columnIds: ["col-02", "col-03"],
    }]));
    expect(ok, JSON.stringify(validateTable.errors)).toBe(true);
  });

  it("fail: 重複 column id", () => {
    const ok = validateTable(makeTable([{
      id: "uq-02",
      kind: "unique",
      columnIds: ["col-02", "col-02"],
    }]));
    expect(ok).toBe(false);
    expect(JSON.stringify(validateTable.errors)).toContain("uniqueItems");
  });
});

describe("ForeignKeyConstraint.columnIds + referencedColumnIds uniqueItems (#1185 追加#1)", () => {
  it("pass: 両方とも重複なし", () => {
    const ok = validateTable(makeTable([{
      id: "fk-01",
      kind: "foreignKey",
      columnIds: ["col-02", "col-03"],
      referencedTableId: "22222222-2222-4222-8222-222222222222",
      referencedColumnIds: ["other_id_1", "other_id_2"],
    }]));
    expect(ok, JSON.stringify(validateTable.errors)).toBe(true);
  });

  it("fail: columnIds 重複", () => {
    const ok = validateTable(makeTable([{
      id: "fk-02",
      kind: "foreignKey",
      columnIds: ["col-02", "col-02"],
      referencedTableId: "22222222-2222-4222-8222-222222222222",
      referencedColumnIds: ["other_id_1", "other_id_2"],
    }]));
    expect(ok).toBe(false);
    expect(JSON.stringify(validateTable.errors)).toContain("uniqueItems");
  });

  it("fail: referencedColumnIds 重複", () => {
    const ok = validateTable(makeTable([{
      id: "fk-03",
      kind: "foreignKey",
      columnIds: ["col-02", "col-03"],
      referencedTableId: "22222222-2222-4222-8222-222222222222",
      referencedColumnIds: ["other_id_1", "other_id_1"],
    }]));
    expect(ok).toBe(false);
    expect(JSON.stringify(validateTable.errors)).toContain("uniqueItems");
  });
});
