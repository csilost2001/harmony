import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type { TableEntry, TableId, Timestamp } from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import type { TableStorageBackend } from "./tableStore";
import { commitTables, deleteTable, setTableStorageBackend } from "./tableStore";

const TS = "2026-04-29T00:00:00.000Z" as Timestamp;

function tableEntry(id: string, no: number): TableEntry {
  return {
    id: id as TableId,
    no,
    name: `table ${id}`,
    physicalName: `table_${id}`,
    columnCount: 0,
    updatedAt: TS,
  };
}

function projectWithTables(tables: TableEntry[]): FlowProject {
  return {
    version: 1,
    name: "test",
    screens: [],
    groups: [],
    edges: [],
    tables,
    updatedAt: TS,
  };
}

describe("tableStore delete/commit batching", () => {
  beforeEach(() => {
    setTableStorageBackend(null);
    setFlowStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("deleteTable does not save project.json", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(projectWithTables([tableEntry("a", 1)])),
      saveProject,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const tableBackend: TableStorageBackend = {
      loadTable: vi.fn().mockResolvedValue(null),
      saveTable: vi.fn().mockResolvedValue(undefined),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setTableStorageBackend(tableBackend);

    await deleteTable("a");

    expect(tableBackend.deleteTable).toHaveBeenCalledWith("a");
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("commitTables saves project.json once regardless of deletedIds count", async () => {
    const project = projectWithTables([tableEntry("a", 1), tableEntry("b", 2), tableEntry("c", 3)]);
    const loadProject = vi.fn().mockResolvedValue(project);
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const deleteTable = vi.fn().mockResolvedValue(undefined);

    await commitTables({
      itemsInOrder: [tableEntry("c", 1), tableEntry("a", 2)],
      deletedIds: ["b", "missing"],
    }, { loadProject, saveProject, deleteTable });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(project);
    expect(project.tables?.map((t) => t.id)).toEqual(["c", "a"]);
    expect(project.tables?.map((t) => t.no)).toEqual([1, 2]);
    expect(deleteTable).toHaveBeenCalledTimes(2);
    expect(deleteTable).toHaveBeenNthCalledWith(1, "b");
    expect(deleteTable).toHaveBeenNthCalledWith(2, "missing");
  });
});
