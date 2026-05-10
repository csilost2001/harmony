import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowProject } from "../types/flow";
import type {
  DisplayName,
  Project,
  TableId,
  Timestamp,
  ViewDefinitionEntry,
  ViewDefinitionId,
} from "../types/v3";
import type { FlowStorageBackend } from "./flowStore";
import { setFlowDraftMode, setFlowStorageBackend } from "./flowStore";
import { setScreenLayoutStorageBackend } from "./screenLayoutStore";
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

// #1004: commitViewDefinitions が entities.viewDefinitions を使うようになったため
// rawProject 形式のヘルパーを追加
function rawProjectWithViewDefinitions(viewDefinitions: ViewDefinitionEntry[]): Project {
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
    entities: { viewDefinitions },
  };
}

describe("viewDefinitionStore", () => {
  beforeEach(() => {
    setViewDefinitionStorageBackend(null);
    setFlowStorageBackend(null);
    setScreenLayoutStorageBackend({
      loadScreenLayout: vi.fn().mockResolvedValue(null),
      saveScreenLayout: vi.fn().mockResolvedValue(undefined),
    });
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("deleteViewDefinition does not save harmony.json", async () => {
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
    const viewBackend: StoreViewDefinitionStorageBackend = {
      loadViewDefinition: vi.fn().mockResolvedValue(null),
      saveViewDefinition: vi.fn().mockResolvedValue(undefined),
      deleteViewDefinition: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
    setViewDefinitionStorageBackend(viewBackend);

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

  it("commitViewDefinitions saves harmony.json once regardless of deletedIds count", async () => {
    // #1004: commitViewDefinitions が entities.viewDefinitions を使うようになったため
    // loadRawProject / saveRawProject を deps 経由で渡す
    const rawProject = rawProjectWithViewDefinitions([
      viewDefinitionEntry("a", 1),
      viewDefinitionEntry("b", 2),
      viewDefinitionEntry("c", 3),
    ]);
    const loadProject = vi.fn().mockResolvedValue({
      version: 1, name: "test", screens: [], groups: [], edges: [], updatedAt: TS,
    });
    const saveProject = vi.fn().mockResolvedValue(undefined);
    const deleteViewDefinition = vi.fn().mockResolvedValue(undefined);
    const loadRawProject = vi.fn().mockResolvedValue(rawProject);
    const saveRawProject = vi.fn().mockResolvedValue(undefined);

    await commitViewDefinitions({
      itemsInOrder: [viewDefinitionEntry("c", 1), viewDefinitionEntry("a", 2)],
      deletedIds: ["b", "missing"],
    }, { loadProject, saveProject, deleteViewDefinition, loadRawProject, saveRawProject });

    // saveRawProject が 1 回だけ呼ばれる
    expect(saveRawProject).toHaveBeenCalledTimes(1);
    // saveProject は呼ばれない (entities.viewDefinitions 直書きに変更)
    expect(saveProject).not.toHaveBeenCalled();
    // 保存された rawProject の entities.viewDefinitions が正しく更新されている
    const saved = rawProject.entities?.viewDefinitions;
    expect(saved?.map((vd) => vd.id)).toEqual(["c", "a"]);
    expect(saved?.map((vd) => vd.no)).toEqual([1, 2]);
    expect(deleteViewDefinition).toHaveBeenCalledTimes(2);
    expect(deleteViewDefinition).toHaveBeenNthCalledWith(1, "b");
    expect(deleteViewDefinition).toHaveBeenNthCalledWith(2, "missing");
  });
});
