import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId, Table, TableId, Timestamp } from "../types/v3";
import { setFlowStorageBackend } from "./flowStore";
import type { TableStorageBackend } from "./tableStore";
import { loadTableValidationMap, setTableStorageBackend } from "./tableStore";

const TS = "2026-04-29T00:00:00.000Z" as Timestamp;
const TABLE_ID_1 = "11111111-1111-4111-8111-111111111111" as TableId;
const TABLE_ID_2 = "22222222-2222-4222-8222-222222222222" as TableId;
const ORPHAN_TABLE_ID = "33333333-3333-4333-8333-333333333333" as TableId;

function table(id: TableId, name: string): Table {
  return {
    id,
    name,
    physicalName: name.toLowerCase(),
    columns: [],
    indexes: [],
    createdAt: TS,
    updatedAt: TS,
  } as Table;
}

function project(tableIds: TableId[]): Project {
  return {
    schemaVersion: "v3",
    meta: {
      id: "00000000-0000-4000-8000-000000000001" as ProjectId,
      name: "test",
      createdAt: TS,
      updatedAt: TS,
      mode: "upstream",
      maturity: "draft",
    },
    entities: {
      tables: tableIds.map((id, index) => ({
        id,
        no: index + 1,
        name: `table-${index + 1}`,
        physicalName: `table_${index + 1}`,
        updatedAt: TS,
      })),
    },
  };
}

function setProject(tableIds: TableId[]): void {
  setFlowStorageBackend({
    loadProject: vi.fn().mockResolvedValue(project(tableIds)),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteScreenData: vi.fn().mockResolvedValue(undefined),
  });
}

describe("loadTableValidationMap bulk load (#587)", () => {
  beforeEach(() => {
    localStorage.clear();
    setFlowStorageBackend(null);
    setTableStorageBackend(null);
  });

  it("backend が listAllTables を提供する場合は 1 回だけ呼び出す", async () => {
    setProject([TABLE_ID_1, TABLE_ID_2]);
    const listAllTables = vi.fn().mockResolvedValue([
      table(TABLE_ID_1, "table_1"),
      table(TABLE_ID_2, "table_2"),
    ]);
    const loadTable = vi.fn();
    setTableStorageBackend({
      loadTable,
      listAllTables,
      saveTable: vi.fn().mockResolvedValue(undefined),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    });

    const validationMap = await loadTableValidationMap();

    expect(listAllTables).toHaveBeenCalledTimes(1);
    expect(loadTable).not.toHaveBeenCalled();
    expect(validationMap.size).toBe(2);
  });

  it("backend が listAllTables を提供しない場合は id ごとの loadTable にフォールバックする", async () => {
    setProject([TABLE_ID_1, TABLE_ID_2]);
    const loadTable = vi.fn(async (id: TableId) => table(id, id === TABLE_ID_1 ? "table_1" : "table_2"));
    setTableStorageBackend({
      loadTable: loadTable as TableStorageBackend["loadTable"],
      saveTable: vi.fn().mockResolvedValue(undefined),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    });

    const validationMap = await loadTableValidationMap();

    expect(loadTable).toHaveBeenCalledTimes(2);
    expect(loadTable).toHaveBeenCalledWith(TABLE_ID_1);
    expect(loadTable).toHaveBeenCalledWith(TABLE_ID_2);
    expect(validationMap.size).toBe(2);
  });

  it("bulk 結果に project.json entry のない orphan が含まれていても validationMap から除外する", async () => {
    setProject([TABLE_ID_1]);
    setTableStorageBackend({
      loadTable: vi.fn(),
      listAllTables: vi.fn().mockResolvedValue([
        table(TABLE_ID_1, "table_1"),
        table(ORPHAN_TABLE_ID, "orphan"),
      ]),
      saveTable: vi.fn().mockResolvedValue(undefined),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    });

    const validationMap = await loadTableValidationMap();

    expect(validationMap.has(TABLE_ID_1)).toBe(true);
    expect(validationMap.has(ORPHAN_TABLE_ID)).toBe(false);
    expect(validationMap.size).toBe(1);
  });
});
