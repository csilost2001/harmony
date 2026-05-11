import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type { Table, TableEntry, TableId, Timestamp } from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import { setScreenFlowPositionsStorageBackend } from "./screenFlowPositionsStore";
import type { TableStorageBackend } from "./tableStore";
import { commitTables, deleteTable, onTableChange, saveTable, setTableStorageBackend } from "./tableStore";

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

  it("deleteTable does not save harmony.json", async () => {
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

  it("commitTables saves harmony.json once regardless of deletedIds count", async () => {
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

describe("tableStore onTableChange subscription (#1001)", () => {
  beforeEach(() => {
    setTableStorageBackend(null);
    setFlowStorageBackend(null);
    setScreenFlowPositionsStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  function setupBackends() {
    // saveTable は syncTableMeta → flowStore.loadProject → screenFlowPositionsStore.loadScreenFlowPositions
    // までチェーンするので、3 backend すべて mock する必要がある
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(projectWithTables([])),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const tableBackend: TableStorageBackend = {
      loadTable: vi.fn().mockResolvedValue(null),
      saveTable: vi.fn().mockResolvedValue(undefined),
      deleteTable: vi.fn().mockResolvedValue(undefined),
    };
    const screenFlowPositionsBackend = {
      loadScreenFlowPositions: vi.fn().mockResolvedValue(null),
      saveScreenFlowPositions: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setTableStorageBackend(tableBackend);
    setScreenFlowPositionsStorageBackend(screenFlowPositionsBackend);
    return { flowBackend, tableBackend, screenFlowPositionsBackend };
  }

  // schema 上 id は UUID v4 必須 (^[0-9a-f]{8}-[0-9a-f]{4}-4...)
  const TABLE_UUID_1 = "11111111-aaaa-4bbb-8ccc-111111111111";
  const TABLE_UUID_2 = "22222222-aaaa-4bbb-8ccc-222222222222";

  function makeTable(id: string, label: string): Table {
    return {
      $schema: "../../schemas/v3/table.v3.schema.json",
      id: id as TableId,
      name: `table ${label}`,
      physicalName: `table_${label}` as Table["physicalName"],
      columns: [],
      createdAt: TS,
      updatedAt: TS,
    };
  }

  it("saveTable は listener を { tableId } で呼び出す", async () => {
    setupBackends();
    const listener = vi.fn();
    const unsub = onTableChange(listener);

    await saveTable(makeTable(TABLE_UUID_1, "t1"));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ tableId: TABLE_UUID_1 });

    unsub();
  });

  it("deleteTable は listener を { tableId, deleted: true } で呼び出す", async () => {
    setupBackends();
    const listener = vi.fn();
    const unsub = onTableChange(listener);

    await deleteTable(TABLE_UUID_1);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ tableId: TABLE_UUID_1, deleted: true });

    unsub();
  });

  it("unsubscribe 後は listener が呼ばれない", async () => {
    setupBackends();
    const listener = vi.fn();
    const unsub = onTableChange(listener);

    unsub();
    await saveTable(makeTable(TABLE_UUID_2, "t2"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("listener が throw しても他 listener は実行される", async () => {
    setupBackends();
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn().mockImplementation(() => { throw new Error("oops"); });
    const ok = vi.fn();
    const unsubA = onTableChange(failing);
    const unsubB = onTableChange(ok);

    await saveTable(makeTable(TABLE_UUID_1, "t1"));

    expect(failing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(consoleErrSpy).toHaveBeenCalled();

    unsubA();
    unsubB();
    consoleErrSpy.mockRestore();
  });
});
