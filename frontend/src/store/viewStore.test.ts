import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type { Timestamp, ViewEntry, ViewId } from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import type { ViewStorageBackend } from "./viewStore";
import { commitViews, deleteView, setViewStorageBackend } from "./viewStore";

const TS = "2026-04-29T00:00:00.000Z" as Timestamp;

function viewEntry(id: string, no: number): ViewEntry {
  return {
    id: id as ViewId,
    no,
    name: `view ${id}`,
    physicalName: `view_${id}`,
    updatedAt: TS,
  };
}

function projectWithViews(views: ViewEntry[]): FlowProject {
  return {
    version: 1,
    name: "test",
    screens: [],
    groups: [],
    edges: [],
    views,
    updatedAt: TS,
  };
}

describe("viewStore delete/commit batching", () => {
  beforeEach(() => {
    setViewStorageBackend(null);
    setFlowStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("deleteView does not save project.json", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(projectWithViews([viewEntry("a", 1)])),
      saveProject,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const viewBackend: ViewStorageBackend = {
      loadView: vi.fn().mockResolvedValue(null),
      saveView: vi.fn().mockResolvedValue(undefined),
      deleteView: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setViewStorageBackend(viewBackend);

    await deleteView("a");

    expect(viewBackend.deleteView).toHaveBeenCalledWith("a");
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("commitViews saves project.json once regardless of deletedIds count", async () => {
    const project = projectWithViews([viewEntry("a", 1), viewEntry("b", 2), viewEntry("c", 3)]);
    const loadProject = vi.fn().mockResolvedValue(project);
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const deleteView = vi.fn().mockResolvedValue(undefined);

    await commitViews({
      itemsInOrder: [viewEntry("c", 1), viewEntry("a", 2)],
      deletedIds: ["b", "missing"],
    }, { loadProject, saveProject, deleteView });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(project);
    expect(project.views?.map((v) => v.id)).toEqual(["c", "a"]);
    expect(project.views?.map((v) => v.no)).toEqual([1, 2]);
    expect(deleteView).toHaveBeenCalledTimes(2);
    expect(deleteView).toHaveBeenNthCalledWith(1, "b");
    expect(deleteView).toHaveBeenNthCalledWith(2, "missing");
  });
});
