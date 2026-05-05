import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowStorageBackend } from "./flowStore";
import {
  composeFlowProject,
  decomposeFlowProject,
  loadProject,
  persistProject,
  saveProject,
  addScreen,
  setFlowDraftMode,
  setFlowStorageBackend,
} from "./flowStore";
import type { FlowProject } from "../types/flow";
import type {
  LocalId,
  Position,
  ProcessFlowId,
  Project,
  ProjectId,
  ScreenGroupId,
  ScreenId,
  ScreenLayout,
  Timestamp,
} from "../types/v3";

const TS = "2026-04-28T00:00:00.000Z" as Timestamp;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SCREEN_ID = "22222222-2222-4222-8222-222222222222" as ScreenId;
const SCREEN_ID_2 = "33333333-3333-4333-8333-333333333333" as ScreenId;
const GROUP_ID = "44444444-4444-4444-8444-444444444444" as ScreenGroupId;
const EDGE_ID = "edge-01" as LocalId;
const FLOW_ID = "55555555-5555-4555-8555-555555555555" as ProcessFlowId;

function mkEmptyProject(): FlowProject {
  return {
    version: 1,
    name: "テスト",
    screens: [],
    groups: [],
    edges: [],
    updatedAt: TS,
  };
}

function mkPersistedProject(): Project {
  return {
    $schema: "../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
    meta: {
      id: PROJECT_ID,
      name: "実プロジェクト",
      createdAt: TS,
      updatedAt: TS,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    entities: {
      screens: [
        {
          id: SCREEN_ID,
          no: 1,
          name: "画面1",
          kind: "list",
          path: "/screens",
          hasDesign: false,
          groupId: GROUP_ID,
          updatedAt: TS,
        },
        {
          id: SCREEN_ID_2,
          no: 2,
          name: "画面2",
          kind: "detail",
          path: "/screens/:id",
          hasDesign: true,
          updatedAt: TS,
        },
      ],
      screenGroups: [{ id: GROUP_ID, name: "グループ", color: "#0d6efd" }],
      screenTransitions: [
        {
          id: EDGE_ID,
          sourceScreenId: SCREEN_ID,
          targetScreenId: SCREEN_ID_2,
          label: "詳細へ",
          trigger: "click",
        },
      ],
      processFlows: [
        {
          id: FLOW_ID,
          no: 1,
          name: "処理",
          screenId: SCREEN_ID,
          actionCount: 1,
          notesCount: 0,
          updatedAt: TS,
          maturity: "draft",
        },
      ],
    },
  };
}

function mkLayout(): ScreenLayout {
  return {
    $schema: "../schemas/v3/screen-layout.v3.schema.json",
    positions: {
      [SCREEN_ID]: { x: 10, y: 20, width: 200, height: 100 } satisfies Position,
      [SCREEN_ID_2]: { x: 260, y: 20, width: 200, height: 100 } satisfies Position,
      [GROUP_ID]: { x: 0, y: 0, width: 500, height: 300, color: "#0d6efd" } satisfies Position,
    },
    transitions: {
      [EDGE_ID]: { sourceHandle: "right", targetHandle: "left" },
    },
    updatedAt: TS,
  };
}

function mkNonEmptyProject(): FlowProject {
  return composeFlowProject(mkPersistedProject(), mkLayout());
}

describe("flowStore データ消失ガード (2026-04-22)", () => {
  beforeEach(() => {
    setFlowStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("loadProject: backend が null を返しても空 project を backend に書き込まない", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(null),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    const result = await loadProject();

    expect(result.screens).toHaveLength(0);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("loadProject: backend null + localStorage 空でも backend には書き込まない", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(null),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    const result = await loadProject();

    expect(result.screens).toHaveLength(0);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("loadProject: localStorage に有効データがあれば backend に v3 Project として移行する", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(null),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);
    localStorage.setItem("v3-project", JSON.stringify(mkPersistedProject()));

    const result = await loadProject();

    expect(result.screens).toHaveLength(2);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0]).toMatchObject({ schemaVersion: "v3" });
  });

  it("loadProject: 旧 localStorage key flow-project を v3-project に rename する", async () => {
    localStorage.setItem("flow-project", JSON.stringify({
      version: 1,
      name: "legacy",
      screens: [],
      groups: [],
      edges: [],
      updatedAt: TS,
    }));

    const result = await loadProject();

    expect(result.name).toBe("legacy");
    expect(localStorage.getItem("flow-project")).toBeNull();
    expect(JSON.parse(localStorage.getItem("v3-project") ?? "{}")).toMatchObject({ schemaVersion: "v3" });
  });

  it("saveProject: 空 project で非空 backend を上書きしない (data-loss guard)", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(mkPersistedProject()),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    await saveProject(mkEmptyProject());

    expect(saveMock).not.toHaveBeenCalled();
  });

  it("saveProject: 空 project でも backend が空なら保存する (初回)", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(null),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    await saveProject(mkEmptyProject());

    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("saveProject: 非空 project はガードの影響を受けない", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(mkPersistedProject()),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    await saveProject(mkNonEmptyProject());

    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("persistProject: 同じ data-loss guard が適用される", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(mkPersistedProject()),
      saveProject: saveMock,
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    await persistProject(mkEmptyProject());

    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("addScreen opts (#825)", () => {
  beforeEach(() => {
    setFlowStorageBackend(null);
    setFlowDraftMode(false);
    localStorage.clear();
  });

  it("opts 省略時は path='' position=自動配置で画面が追加される", async () => {
    const project = mkEmptyProject();
    const screen = await addScreen(project, "テスト画面", "list");
    expect(screen.name).toBe("テスト画面");
    expect(screen.kind).toBe("list");
    expect(screen.path).toBe("");
    expect(screen.position).toEqual({ x: 100, y: 150 });
  });

  it("opts.path / opts.position を指定するとその値が使われる", async () => {
    const project = mkEmptyProject();
    const screen = await addScreen(project, "パス付き画面", "form", {
      path: "/test",
      position: { x: 200, y: 300 },
    });
    expect(screen.path).toBe("/test");
    expect(screen.position).toEqual({ x: 200, y: 300 });
  });

  it("opts.editorKind / opts.cssFramework は ScreenNode に含まれないが addScreen が正常完了する", async () => {
    const project = mkEmptyProject();
    const screen = await addScreen(project, "Puck 画面", "other", {
      editorKind: "puck",
      cssFramework: "tailwind",
    });
    // addScreen は FlowProject メタのみ管理。editorKind/cssFramework は addScreen 内では無視される
    // (呼び出し側が saveScreenEntity で screen.design に書き込む)
    expect(screen.id).toBeTruthy();
    expect(project.screens).toHaveLength(1);
  });
});

describe("flowStore v3 compose/decompose", () => {
  it("Project entities と ScreenLayout を FlowProject に合成し、保存 shape に戻せる", () => {
    const project = mkPersistedProject();
    const layout = mkLayout();

    const flow = composeFlowProject(project, layout);

    expect(flow.screens[0]).toMatchObject({
      id: SCREEN_ID,
      position: { x: 10, y: 20 },
      size: { width: 200, height: 100 },
      groupId: GROUP_ID,
    });
    expect(flow.edges[0]).toMatchObject({
      id: EDGE_ID,
      source: SCREEN_ID,
      target: SCREEN_ID_2,
      sourceHandle: "right",
      targetHandle: "left",
    });

    const decomposed = decomposeFlowProject(flow, layout);

    expect(decomposed.project).toMatchObject({
      $schema: "../schemas/v3/project.v3.schema.json",
      schemaVersion: "v3",
      entities: {
        screens: project.entities?.screens,
        screenGroups: project.entities?.screenGroups,
        screenTransitions: project.entities?.screenTransitions,
        processFlows: project.entities?.processFlows,
      },
    });
    expect(decomposed.layout.positions[SCREEN_ID]).toMatchObject({ x: 10, y: 20, width: 200, height: 100 });
    expect(decomposed.layout.transitions?.[EDGE_ID]).toEqual({ sourceHandle: "right", targetHandle: "left" });
  });
});
