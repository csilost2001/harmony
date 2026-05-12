/**
 * pageLayoutStore — unit tests (pl-3, #1024)
 * viewDefinitionStore.test.ts を踏襲
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type { Project, Timestamp } from "../types/v3";
import type { PageLayoutEntry } from "../types/v3/project";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import { setScreenFlowPositionsStorageBackend } from "./screenFlowPositionsStore";
import type { PageLayoutStorageBackend } from "./pageLayoutStore";
import {
  commitPageLayouts,
  deletePageLayout,
  setPageLayoutStorageBackend,
} from "./pageLayoutStore";

const TS = "2026-05-12T00:00:00.000Z" as Timestamp;

function emptyFlowProject(): FlowProject {
  return {
    version: 1,
    name: "test",
    screens: [],
    groups: [],
    edges: [],
    updatedAt: TS,
  };
}

function pageLayoutEntry(id: string, no: number): PageLayoutEntry {
  return {
    id: id as PageLayoutEntry["id"],
    no,
    name: `Layout ${id}` as PageLayoutEntry["name"],
    updatedAt: TS,
    regionCount: 3,
    assignmentCount: 0,
    hasProcessFlow: false,
  };
}

function rawProjectWithPageLayouts(pageLayouts: PageLayoutEntry[]): Project {
  const ts = TS as unknown as Project["meta"]["createdAt"];
  return {
    $schema: "../../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: "11111111-2222-4333-8444-555555555555" as unknown as Project["meta"]["id"],
      name: "test",
      maturity: "draft",
      createdAt: ts,
      updatedAt: ts,
      mode: "upstream",
    },
    extensionsApplied: [],
    entities: { pageLayouts },
  };
}

describe("pageLayoutStore", () => {
  beforeEach(() => {
    setPageLayoutStorageBackend(null);
    setFlowStorageBackend(null);
    setScreenFlowPositionsStorageBackend({
      loadScreenFlowPositions: vi.fn().mockResolvedValue(null),
      saveScreenFlowPositions: vi.fn().mockResolvedValue(undefined),
    });
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("deletePageLayout does not touch harmony.json", async () => {
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(emptyFlowProject()),
      saveProject,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const plBackend: PageLayoutStorageBackend = {
      loadPageLayout: vi.fn().mockResolvedValue(null),
      savePageLayout: vi.fn().mockResolvedValue(undefined),
      deletePageLayout: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setPageLayoutStorageBackend(plBackend);

    await deletePageLayout("pl-a");

    expect(plBackend.deletePageLayout).toHaveBeenCalledWith("pl-a");
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("createPageLayout initializes required fields", async () => {
    const project = emptyFlowProject();
    const rawProject: Project = {
      $schema: "../../schemas/v3/harmony.v3.schema.json",
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "22222222-3333-4444-8555-666666666666" as unknown as Project["meta"]["id"],
        name: "test",
        maturity: "draft",
        createdAt: TS as unknown as Project["meta"]["createdAt"],
        updatedAt: TS as unknown as Project["meta"]["createdAt"],
        mode: "upstream",
      },
      extensionsApplied: [],
      entities: {},
    };
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(project),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    const plBackend: PageLayoutStorageBackend = {
      loadPageLayout: vi.fn().mockResolvedValue(null),
      savePageLayout: vi.fn().mockResolvedValue(undefined),
      deletePageLayout: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend({
      ...flowBackend,
      loadProject: vi.fn().mockResolvedValue(project),
      saveProject: vi.fn().mockImplementation(async (data) => {
        Object.assign(rawProject, data);
      }),
    });
    setPageLayoutStorageBackend(plBackend);

    // Override raw project loader for syncPageLayoutMeta
    const flowBackendWithRaw: FlowStorageBackend & {
      loadRawProject?: () => Promise<Project>;
      saveRawProject?: (p: Project) => Promise<void>;
    } = {
      loadProject: vi.fn().mockResolvedValue(project),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackendWithRaw);

    // Use commitPageLayouts with mocked deps to avoid needing full rawProject
    const saveRawProject = vi.fn().mockResolvedValue(undefined);
    const deletePageLayoutFn = vi.fn().mockResolvedValue(undefined);

    const entries: PageLayoutEntry[] = [pageLayoutEntry("a", 1), pageLayoutEntry("b", 2), pageLayoutEntry("c", 3)];
    const rawWithLayouts = rawProjectWithPageLayouts(entries);

    await commitPageLayouts(
      { itemsInOrder: [pageLayoutEntry("c", 1), pageLayoutEntry("a", 2)], deletedIds: ["b"] },
      {
        loadRawProject: vi.fn().mockResolvedValue(rawWithLayouts),
        saveRawProject,
        deletePageLayout: deletePageLayoutFn,
      },
    );

    expect(saveRawProject).toHaveBeenCalledTimes(1);
    expect(deletePageLayoutFn).toHaveBeenCalledTimes(1);
    expect(deletePageLayoutFn).toHaveBeenCalledWith("b");
    const saved = rawWithLayouts.entities?.pageLayouts;
    expect(saved?.map((v) => v.id)).toEqual(["c", "a"]);
    expect(saved?.map((v) => v.no)).toEqual([1, 2]);
  });

  it("commitPageLayouts saves harmony.json once regardless of deletedIds count", async () => {
    const rawProject = rawProjectWithPageLayouts([
      pageLayoutEntry("a", 1),
      pageLayoutEntry("b", 2),
      pageLayoutEntry("c", 3),
    ]);
    const saveRawProject = vi.fn().mockResolvedValue(undefined);
    const deletePageLayoutFn = vi.fn().mockResolvedValue(undefined);

    await commitPageLayouts(
      {
        itemsInOrder: [pageLayoutEntry("c", 1), pageLayoutEntry("a", 2)],
        deletedIds: ["b", "missing"],
      },
      {
        loadRawProject: vi.fn().mockResolvedValue(rawProject),
        saveRawProject,
        deletePageLayout: deletePageLayoutFn,
      },
    );

    expect(saveRawProject).toHaveBeenCalledTimes(1);
    const saved = rawProject.entities?.pageLayouts;
    expect(saved?.map((v) => v.id)).toEqual(["c", "a"]);
    expect(saved?.map((v) => v.no)).toEqual([1, 2]);
    expect(deletePageLayoutFn).toHaveBeenCalledTimes(2);
    expect(deletePageLayoutFn).toHaveBeenNthCalledWith(1, "b");
    expect(deletePageLayoutFn).toHaveBeenNthCalledWith(2, "missing");
  });
});
