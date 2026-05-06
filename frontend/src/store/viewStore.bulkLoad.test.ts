import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectId, Timestamp, View, ViewId } from "../types/v3";
import { setFlowStorageBackend } from "./flowStore";
import type { ViewStorageBackend } from "./viewStore";
import { loadViewValidationMap, setViewStorageBackend } from "./viewStore";

const TS = "2026-04-29T00:00:00.000Z" as Timestamp;
const VIEW_ID_1 = "11111111-1111-4111-8111-111111111111" as ViewId;
const VIEW_ID_2 = "22222222-2222-4222-8222-222222222222" as ViewId;
const ORPHAN_VIEW_ID = "33333333-3333-4333-8333-333333333333" as ViewId;

function view(id: ViewId, name: string): View {
  return {
    id,
    name,
    physicalName: name.toLowerCase(),
    selectStatement: "select 1",
    outputColumns: [],
    dependencies: [],
    createdAt: TS,
    updatedAt: TS,
  } as View;
}

function project(viewIds: ViewId[]): Project {
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
      views: viewIds.map((id, index) => ({
        id,
        no: index + 1,
        name: `view-${index + 1}`,
        physicalName: `view_${index + 1}`,
        updatedAt: TS,
      })),
    },
  };
}

function setProject(viewIds: ViewId[]): void {
  setFlowStorageBackend({
    loadProject: vi.fn().mockResolvedValue(project(viewIds)),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteScreenData: vi.fn().mockResolvedValue(undefined),
  });
}

describe("loadViewValidationMap bulk load (#587)", () => {
  beforeEach(() => {
    localStorage.clear();
    setFlowStorageBackend(null);
    setViewStorageBackend(null);
  });

  it("backend が listAllViews を提供する場合は 1 回だけ呼び出す", async () => {
    setProject([VIEW_ID_1, VIEW_ID_2]);
    const listAllViews = vi.fn().mockResolvedValue([
      view(VIEW_ID_1, "view_1"),
      view(VIEW_ID_2, "view_2"),
    ]);
    const loadView = vi.fn();
    setViewStorageBackend({
      loadView,
      listAllViews,
      saveView: vi.fn().mockResolvedValue(undefined),
      deleteView: vi.fn().mockResolvedValue(undefined),
    });

    const validationMap = await loadViewValidationMap();

    expect(listAllViews).toHaveBeenCalledTimes(1);
    expect(loadView).not.toHaveBeenCalled();
    expect(validationMap.size).toBe(2);
  });

  it("backend が listAllViews を提供しない場合は id ごとの loadView にフォールバックする", async () => {
    setProject([VIEW_ID_1, VIEW_ID_2]);
    const loadView = vi.fn(async (id: ViewId) => view(id, id === VIEW_ID_1 ? "view_1" : "view_2"));
    setViewStorageBackend({
      loadView: loadView as ViewStorageBackend["loadView"],
      saveView: vi.fn().mockResolvedValue(undefined),
      deleteView: vi.fn().mockResolvedValue(undefined),
    });

    const validationMap = await loadViewValidationMap();

    expect(loadView).toHaveBeenCalledTimes(2);
    expect(loadView).toHaveBeenCalledWith(VIEW_ID_1);
    expect(loadView).toHaveBeenCalledWith(VIEW_ID_2);
    expect(validationMap.size).toBe(2);
  });

  it("bulk 結果に project.json entry のない orphan が含まれていても validationMap から除外する", async () => {
    setProject([VIEW_ID_1]);
    setViewStorageBackend({
      loadView: vi.fn(),
      listAllViews: vi.fn().mockResolvedValue([
        view(VIEW_ID_1, "view_1"),
        view(ORPHAN_VIEW_ID, "orphan"),
      ]),
      saveView: vi.fn().mockResolvedValue(undefined),
      deleteView: vi.fn().mockResolvedValue(undefined),
    });

    const validationMap = await loadViewValidationMap();

    expect(validationMap.has(VIEW_ID_1)).toBe(true);
    expect(validationMap.has(ORPHAN_VIEW_ID)).toBe(false);
    expect(validationMap.size).toBe(1);
  });
});
