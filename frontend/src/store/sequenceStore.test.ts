import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type { SequenceEntry, SequenceId, Timestamp } from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import type { SequenceStorageBackend } from "./sequenceStore";
import { commitSequences, deleteSequence, setSequenceStorageBackend } from "./sequenceStore";

const TS = "2026-04-29T00:00:00.000Z" as Timestamp;

function sequenceEntry(id: string, no: number): SequenceEntry {
  return {
    id: id as SequenceId,
    no,
    name: `sequence ${id}`,
    physicalName: `sequence_${id}`,
    updatedAt: TS,
  };
}

function projectWithSequences(sequences: SequenceEntry[]): FlowProject {
  return {
    version: 1,
    name: "test",
    screens: [],
    groups: [],
    edges: [],
    sequences,
    updatedAt: TS,
  };
}

describe("sequenceStore delete/commit batching", () => {
  beforeEach(() => {
    setSequenceStorageBackend(null);
    setFlowStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("deleteSequence does not save project.json", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(projectWithSequences([sequenceEntry("a", 1)])),
      saveProject,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const sequenceBackend: SequenceStorageBackend = {
      loadSequence: vi.fn().mockResolvedValue(null),
      saveSequence: vi.fn().mockResolvedValue(undefined),
      deleteSequence: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setSequenceStorageBackend(sequenceBackend);

    await deleteSequence("a");

    expect(sequenceBackend.deleteSequence).toHaveBeenCalledWith("a");
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("commitSequences saves project.json once regardless of deletedIds count", async () => {
    const project = projectWithSequences([sequenceEntry("a", 1), sequenceEntry("b", 2), sequenceEntry("c", 3)]);
    const loadProject = vi.fn().mockResolvedValue(project);
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const deleteSequence = vi.fn().mockResolvedValue(undefined);

    await commitSequences({
      itemsInOrder: [sequenceEntry("c", 1), sequenceEntry("a", 2)],
      deletedIds: ["b", "missing"],
    }, { loadProject, saveProject, deleteSequence });

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject).toHaveBeenCalledWith(project);
    expect(project.sequences?.map((s) => s.id)).toEqual(["c", "a"]);
    expect(project.sequences?.map((s) => s.no)).toEqual([1, 2]);
    expect(deleteSequence).toHaveBeenCalledTimes(2);
    expect(deleteSequence).toHaveBeenNthCalledWith(1, "b");
    expect(deleteSequence).toHaveBeenNthCalledWith(2, "missing");
  });
});
