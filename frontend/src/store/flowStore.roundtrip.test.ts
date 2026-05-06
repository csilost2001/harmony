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
  saveTechStack,
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

describe("decomposeFlowProject screen id mismatch (negative paths) (#836)", () => {
  const OTHER_SCREEN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as ScreenId;
  const NEW_SCREEN_ID = "11111111-2222-4333-8444-555555555555" as ScreenId;

  /** existingRaw に OTHER_SCREEN_ID 画面を追加した Project を返す */
  function mkRichProjectWith2Screens(): Project {
    const base = mkRichProject();
    return {
      ...base,
      entities: {
        ...base.entities,
        screens: [
          ...(base.entities?.screens ?? []),
          {
            id: OTHER_SCREEN_ID,
            no: 2,
            name: "追加既存画面",
            kind: "list",
            path: "/other",
            hasDesign: false,
            updatedAt: TS,
            maturity: "committed",
          } as (typeof base.entities.screens)[number],
        ],
      },
    };
  }

  it("existingRaw にあるが FlowProject にない orphan screen は drop される (FlowProject が正本)", () => {
    // existing: SCREEN_ID + OTHER_SCREEN_ID の 2 画面
    const existing = mkRichProjectWith2Screens();
    // FlowProject は SCREEN_ID のみ (OTHER_SCREEN_ID は除外)
    const flow = composeFlowProject(mkRichProject(), mkLayout());

    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    // OTHER_SCREEN_ID (existingRaw 側だけにある orphan) は drop される
    const orphan = decomposed.entities?.screens?.find((s) => s.id === OTHER_SCREEN_ID);
    expect(orphan).toBeUndefined();
    // SCREEN_ID は保持される
    const kept = decomposed.entities?.screens?.find((s) => s.id === SCREEN_ID);
    expect(kept).toBeDefined();
  });

  it("FlowProject にあるが existingRaw にない new screen は追加される (existing フィールドなし)", () => {
    const existing = mkRichProject(); // SCREEN_ID のみ
    // FlowProject に NEW_SCREEN_ID を追加した Project を合成する
    const existingWithNew: Project = {
      ...existing,
      entities: {
        ...existing.entities,
        screens: [
          ...(existing.entities?.screens ?? []),
          {
            id: NEW_SCREEN_ID,
            no: 2,
            name: "追加画面",
            kind: "form",
            path: "/extra",
            hasDesign: false,
            updatedAt: TS,
          },
        ],
      },
    };
    const flow = composeFlowProject(existingWithNew, {
      positions: {
        [SCREEN_ID]: { x: 100, y: 150, width: 200, height: 100 },
        [NEW_SCREEN_ID]: { x: 300, y: 150, width: 200, height: 100 },
      },
      transitions: {},
      updatedAt: TS,
    });

    // existingRaw には NEW_SCREEN_ID がない (SCREEN_ID だけの existing を渡す)
    const { project: decomposed } = decomposeFlowProject(flow, mkLayout(), existing);

    // NEW_SCREEN_ID は FlowProject にあるので追加される
    const added = decomposed.entities?.screens?.find((s) => s.id === NEW_SCREEN_ID);
    expect(added).toBeDefined();
    expect(added?.name).toBe("追加画面");
    // existing に該当 id がないので maturity 等の追加フィールドは引き継がれない
    expect((added as { maturity?: string } | undefined)?.maturity).toBeUndefined();
    // 既存の SCREEN_ID も保持される
    const original = decomposed.entities?.screens?.find((s) => s.id === SCREEN_ID);
    expect(original).toBeDefined();
  });

  it("共通 id の screen は existing の追加フィールド (maturity) が merge され FlowProject の name が優先される", () => {
    const existing = mkRichProject();
    const flow = composeFlowProject(existing, mkLayout());
    // FlowProject の同 id 画面名を変更する
    const flowModified: typeof flow = {
      ...flow,
      screens: flow.screens.map((s) =>
        s.id === SCREEN_ID ? { ...s, name: "変更後の名前" } : s
      ),
    };

    const { project: decomposed } = decomposeFlowProject(flowModified, mkLayout(), existing);

    const merged = decomposed.entities?.screens?.find((s) => s.id === SCREEN_ID);
    expect(merged).toBeDefined();
    // FlowProject の新しい name が反映される
    expect(merged?.name).toBe("変更後の名前");
    // existing の追加フィールド (maturity) も保持される
    expect((merged as { maturity?: string } | undefined)?.maturity).toBe("draft");
  });
});

describe("saveTechStack AJV validation (#835 Should-fix 2)", () => {
  it("不正な techStack を渡すと assertValidProject が例外を投げ saveProject は呼ばれない", async () => {
    const richProject = mkRichProject();
    setFlowDraftMode(false);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(richProject),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    // editorKind に enum 違反値を渡す → assertValidProject が throw する
    const invalidTechStack = {
      designer: { editorKind: "INVALID_EDITOR" as unknown as "grapesjs", cssFramework: "tailwind" as const },
    };
    await expect(saveTechStack(invalidTechStack)).rejects.toThrow(/schema validation failed/);
    // validation で中断されるため saveProject は呼ばれない
    expect(backend.saveProject).not.toHaveBeenCalled();
  });

  it("正常な techStack では saveProject が呼ばれる", async () => {
    const richProject = mkRichProject();
    setFlowDraftMode(false);
    const backend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(richProject),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(backend);

    await expect(saveTechStack({ designer: { editorKind: "puck", cssFramework: "tailwind" } })).resolves.not.toThrow();
    expect(backend.saveProject).toHaveBeenCalledOnce();
  });
});
