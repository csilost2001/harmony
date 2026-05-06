/**
 * viewDefinitionLevels — Level 検出 + 切替の単体テスト (#748)
 */

import { describe, it, expect } from "vitest";
import { detectLevel, suggestAlias, migrateToLevel } from "./viewDefinitionLevels";
import type { ViewDefinition } from "../../types/v3/view-definition";

const TBL_A = "aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa";
const TBL_B = "bbbbbbbb-0002-4000-8000-bbbbbbbbbbbb";

function baseVd(partial: Partial<ViewDefinition> = {}): ViewDefinition {
  return {
    id: "vvvvvvvv-0001-4000-8000-vvvvvvvvvvvv",
    name: "test view",
    version: "1.0.0",
    maturity: "draft",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    kind: "list",
    columns: [],
    ...partial,
  } as unknown as ViewDefinition;
}

const tableNameMap: Record<string, string> = {
  [TBL_A]: "orders",
  [TBL_B]: "customers",
};
const tableName = (id: string) => tableNameMap[id];

describe("detectLevel", () => {
  it("sourceTableId だけなら Level 1", () => {
    expect(detectLevel(baseVd({ sourceTableId: TBL_A } as Partial<ViewDefinition>))).toBe(1);
  });

  it("sourceTableId も query も無くても Level 1 (デフォルト)", () => {
    expect(detectLevel(baseVd())).toBe(1);
  });

  it("query.from があれば Level 2", () => {
    const vd = baseVd({ query: { from: { tableId: TBL_A as never, alias: "o" } } } as Partial<ViewDefinition>);
    expect(detectLevel(vd)).toBe(2);
  });

  it("query.sql があれば Level 3", () => {
    const vd = baseVd({ query: { sql: "SELECT 1", parameterRefs: [] } } as Partial<ViewDefinition>);
    expect(detectLevel(vd)).toBe(3);
  });
});

describe("suggestAlias", () => {
  it("テーブル名先頭文字を返す (未使用なら)", () => {
    expect(suggestAlias("orders", new Set())).toBe("o");
    expect(suggestAlias("customers", new Set())).toBe("c");
  });

  it("衝突時は数字 suffix を付ける", () => {
    expect(suggestAlias("orders", new Set(["o"]))).toBe("o2");
    expect(suggestAlias("orders", new Set(["o", "o2"]))).toBe("o3");
  });

  it("非英字始まりは t にフォールバック", () => {
    expect(suggestAlias("123_table", new Set())).toBe("t");
  });

  it("undefined / 空文字は t", () => {
    expect(suggestAlias(undefined, new Set())).toBe("t");
    expect(suggestAlias("", new Set())).toBe("t");
  });
});

describe("migrateToLevel", () => {
  it("Level 1 → Level 2: sourceTableId を query.from に変換、alias 自動推定", () => {
    const vd = baseVd({ sourceTableId: TBL_A } as Partial<ViewDefinition>);
    const next = migrateToLevel(vd, 2, tableName);
    expect(detectLevel(next)).toBe(2);
    expect(next.sourceTableId).toBeUndefined();
    expect((next.query as { from: { tableId: string; alias: string } }).from.tableId).toBe(TBL_A);
    expect((next.query as { from: { tableId: string; alias: string } }).from.alias).toBe("o"); // orders → o
  });

  it("Level 1 → Level 3: query.sql 雛形を生成、sourceTableId 解除", () => {
    const vd = baseVd({ sourceTableId: TBL_A } as Partial<ViewDefinition>);
    const next = migrateToLevel(vd, 3, tableName);
    expect(detectLevel(next)).toBe(3);
    expect(next.sourceTableId).toBeUndefined();
    expect((next.query as { sql: string }).sql).toBe("");
  });

  it("Level 2 → Level 1: query.from.tableId を sourceTableId に変換", () => {
    const vd = baseVd({
      query: { from: { tableId: TBL_A as never, alias: "o" }, joins: [] },
    } as Partial<ViewDefinition>);
    const next = migrateToLevel(vd, 1, tableName);
    expect(detectLevel(next)).toBe(1);
    expect(next.query).toBeUndefined();
    expect(next.sourceTableId).toBe(TBL_A);
  });

  it("Level 3 → Level 1: columns[0].tableColumnRef.tableId を sourceTableId に転用 (フォールバック)", () => {
    const vd = baseVd({
      query: { sql: "SELECT * FROM ...", parameterRefs: [] },
      columns: [
        {
          name: "x" as never,
          type: "string" as never,
          tableColumnRef: { tableId: TBL_B, columnId: "col-1" },
        },
      ],
    } as Partial<ViewDefinition>);
    const next = migrateToLevel(vd, 1, tableName);
    expect(detectLevel(next)).toBe(1);
    expect(next.sourceTableId).toBe(TBL_B);
    expect(next.query).toBeUndefined();
  });

  it("同じ Level への migrate は同オブジェクトを返す (no-op)", () => {
    const vd = baseVd({ sourceTableId: TBL_A } as Partial<ViewDefinition>);
    expect(migrateToLevel(vd, 1, tableName)).toBe(vd);
  });

  it("既存の columns / sortDefaults / filterDefaults は維持", () => {
    const cols = [
      { name: "x" as never, type: "string" as never, tableColumnRef: { tableId: TBL_A, columnId: "c1" } },
    ];
    const vd = baseVd({
      sourceTableId: TBL_A,
      columns: cols,
      sortDefaults: [{ columnName: "x" as never, order: "asc" }],
      filterDefaults: [{ columnName: "x" as never, operator: "eq", value: "v" }],
    } as Partial<ViewDefinition>);
    const next = migrateToLevel(vd, 2, tableName);
    expect(next.columns).toEqual(cols);
    expect(next.sortDefaults).toEqual(vd.sortDefaults);
    expect(next.filterDefaults).toEqual(vd.filterDefaults);
  });
});
