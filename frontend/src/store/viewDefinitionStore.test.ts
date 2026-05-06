import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type {
  DisplayName,
  TableId,
  Timestamp,
  ViewDefinitionEntry,
  ViewDefinitionId,
} from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import type { ViewDefinitionStorageBackend as StoreViewDefinitionStorageBackend } from "./viewDefinitionStore";
import {
  commitViewDefinitions,
  createViewDefinition,
  deleteViewDefinition,
  setViewDefinitionStorageBackend,
} from "./viewDefinitionStore";

const TS = "2026-04-29T00:00:00.000Z" as Timestamp;

function emptyProject(): FlowProject {
  return {
    version: 1,
    name: "test",
    screens: [],
    groups: [],
    edges: [],
    updatedAt: TS,
  };
}

function viewDefinitionEntry(id: string, no: number): ViewDefinitionEntry {
  return {
    id: id as unknown as ViewDefinitionId,
    no,
    name: `vd ${id}`,
    kind: "list",
    sourceTableId: "tbl-1" as any,
    columnCount: 0,
    updatedAt: TS,
  };
}

function projectWithViewDefinitions(viewDefinitions: ViewDefinitionEntry[]): FlowProject {
  return {
    version: 1,
    name: "test",
    screens: [],
    groups: [],
    edges: [],
    viewDefinitions,
    updatedAt: TS,
  } as unknown as FlowProject;
}

describe("viewDefinitionStore", () => {
  beforeEach(() => {
    setViewDefinitionStorageBackend(null);
    setFlowStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("deleteViewDefinition does not save project.json", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(emptyProject()),
      saveProject,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const viewBackend: StoreViewDefinitionStorageBackend = {
      loadViewDefinition: vi.fn().mockResolvedValue(null),
      saveViewDefinition: vi.fn().mockResolvedValue(undefined),
      deleteViewDefinition: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setViewDefinitionStorageBackend(viewBackend);

    await deleteViewDefinition("a");

    expect(viewBackend.deleteViewDefinition).toHaveBeenCalledWith("a");
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("createViewDefinition initializes required fields", async () => {
    const project = emptyProject();
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(project),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);

    const vd = await createViewDefinition(
      "受注一覧" as DisplayName,
      "list",
      "table-orders" as TableId,
    );

    expect(vd.id).toBeTruthy();
    expect(vd.kind).toBe("list");
    expect(vd.sourceTableId).toBe("table-orders");
    expect(vd.columns).toEqual([]);
  });

  it("commitViewDefinitions saves project.json once regardless of deletedIds count", async () => {
    const project = projectWithViewDefinitions([
      viewDefinitionEntry("a", 1),
      viewDefinitionEntry("b", 2),
      viewDefinitionEntry("c", 3),
    ]);
    const loadProject = vi.fn().mockResolvedValue(project);
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const deleteViewDefinition = vi.fn().mockResolvedValue(undefined);

    await commitViewDefinitions({
      itemsInOrder: [viewDefinitionEntry("c", 1), viewDefinitionEntry("a", 2)],
      deletedIds: ["b", "missing"],
    }, { loadProject, saveProject, deleteViewDefinition });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(project);
    expect(project.viewDefinitions?.map((vd) => vd.id)).toEqual(["c", "a"]);
    expect(project.viewDefinitions?.map((vd) => vd.no)).toEqual([1, 2]);
    expect(deleteViewDefinition).toHaveBeenCalledTimes(2);
    expect(deleteViewDefinition).toHaveBeenNthCalledWith(1, "b");
    expect(deleteViewDefinition).toHaveBeenNthCalledWith(2, "missing");
  });
});
