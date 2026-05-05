/**
 * flowStore.roundtrip.test.ts — decomposeFlowProject round-trip preservation (#835)
 *
 * techStack / extensionsApplied / meta.id / meta.description / screen.html 等が
 * saveProject 経路で失われないことを検証する。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlowStorageBackend, LegacyFlowProject } from "./flowStore";
import {
  composeFlowProject,
  decomposeFlowProject,
  legacyToProject,
  setFlowStorageBackend,
  setFlowDraftMode,
  saveProject,
} from "./flowStore";
import type { FlowProject } from "../types/flow";
import type {
  Project,
  ProjectId,
  ScreenId,
  ScreenLayout,
  Timestamp,
} from "../types/v3";

const TS = "2026-05-05T00:00:00.000Z" as Timestamp;
const PROJ_ID = "5352b9ca-92d1-43c1-aed7-02a1fdbea85a" as ProjectId;
const SCREEN_ID = "496e43f8-d243-48a1-b680-32d34d98cc2d" as ScreenId;

/** techStack / extensionsApplied / description / 画面の追加フィールド html を持つリッチな Project */
function mkRichProject(): Project {
  return {
    $schema: "../../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
    meta: {
      id: PROJ_ID,
      name: "英会話学習アプリ (Tailwind 版)",
      description: "テスト用説明文",
      createdAt: TS,
      updatedAt: TS,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [{ namespace: "english-learning", version: ">=1.0.0" }],
    techStack: {
      designer: { editorKind: "puck", cssFramework: "tailwind" },
      backend: { language: "typescript", framework: "nestjs" },
    },
    entities: {
      screens: [
        {
          id: SCREEN_ID,
          no: 1,
          name: "ダッシュボード",
          kind: "dashboard",
          path: "/",
          hasDesign: false,
          updatedAt: TS,
          // 追加フィールド (schema 拡張等で将来追加されうるフィールドのシミュレーション)
          maturity: "draft",
        },
      ],
      screenGroups: [],
      screenTransitions: [],
    },
  };
}

function mkLayout(): ScreenLayout {
  return {
    positions: {
      [SCREEN_ID]: { x: 100, y: 150, width: 200, height: 100 },
    },
    transitions: {},
    updatedAt: TS,
  };
}

describe("decomposeFlowProject round-trip preservation (#835)", () => {
  it("existingRaw を渡すと meta.id が保持される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    expect(decomposed.meta.id).toBe(PROJ_ID);
  });

  it("existingRaw を渡すと techStack が保持される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    expect(decomposed.techStack).toEqual(existing.techStack);
  });

  it("existingRaw を渡すと extensionsApplied が保持される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    expect(decomposed.extensionsApplied).toEqual([
      { namespace: "english-learning", version: ">=1.0.0" },
    ]);
  });

  it("existingRaw を渡すと meta.description が保持される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    expect((decomposed.meta as { description?: string }).description).toBe("テスト用説明文");
  });

  it("existingRaw を渡すと meta.createdAt が保持される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    expect(decomposed.meta.createdAt).toBe(TS);
  });

  it("existingRaw を渡すと同 id 画面の追加フィールド (maturity) が保持される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    const screen = decomposed.entities?.screens?.find((s) => s.id === SCREEN_ID);
    expect((screen as { maturity?: string } | undefined)?.maturity).toBe("draft");
  });

  it("existingRaw なしだと meta.id は generateUUID() で新採番される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    // existingRaw を渡さない
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout());

    // UUID v4 形式であること
    expect(decomposed.meta.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // ハードコード値ではないこと
    expect(decomposed.meta.id).not.toBe("00000000-0000-4000-8000-000000000001");
  });

  it("existingRaw なしだと techStack は undefined になる", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout());

    expect(decomposed.techStack).toBeUndefined();
  });
});

describe("saveProject round-trip preservation (backend mock)", () => {
  let savedProject: Project | null = null;
  let backendProject: Project;

  beforeEach(() => {
    savedProject = null;
    backendProject = mkRichProject();
    setFlowDraftMode(false);

    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockImplementation(() => Promise.resolve(backendProject)),
      saveProject: vi.fn().mockImplementation((p: unknown) => {
        savedProject = p as Project;
        backendProject = p as Project;
        return Promise.resolve();
      }),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);
  });

  it("saveProject 後も techStack が保持される", async () => {
    const flow: FlowProject = composeFlowProject(backendProject, mkLayout());
    await saveProject(flow);

    expect(savedProject).not.toBeNull();
    expect(savedProject!.techStack).toEqual(backendProject.techStack);
  });

  it("saveProject 後も extensionsApplied が保持される", async () => {
    const flow: FlowProject = composeFlowProject(backendProject, mkLayout());
    await saveProject(flow);

    expect(savedProject!.extensionsApplied).toEqual([
      { namespace: "english-learning", version: ">=1.0.0" },
    ]);
  });

  it("saveProject 後も meta.id が保持される", async () => {
    const flow: FlowProject = composeFlowProject(backendProject, mkLayout());
    await saveProject(flow);

    expect(savedProject!.meta.id).toBe(PROJ_ID);
  });
});

describe("legacyToProject UUID 発番 (#835 Should-fix 1)", () => {
  it("ハードコード UUID ではなく generateUUID() で新採番される", () => {
    const legacy: LegacyFlowProject = {
      version: 1,
      name: "レガシープロジェクト",
      screens: [],
      groups: [],
      edges: [],
      updatedAt: "2026-01-01T00:00:00.000Z" as import("../types/v3").Timestamp,
    };
    const project = legacyToProject(legacy);

    // UUID v4 形式であること
    expect(project.meta.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // ハードコード値ではないこと
    expect(project.meta.id).not.toBe("00000000-0000-4000-8000-000000000001");
  });
});
