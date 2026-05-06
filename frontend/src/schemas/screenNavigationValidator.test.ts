/**
 * 画面遷移整合検査 (#650, Phase 4 子 2) テスト
 *
 * checkScreenNavigation(flows, screens, screenTransitions) の 7 観点 + 正常系 + edge cases
 */

import { describe, it, expect } from "vitest";
import { checkScreenNavigation } from "./screenNavigationValidator";
import type { ProcessFlow } from "../types/v3";
import type { Screen } from "../types/v3/screen";
import type { ScreenTransitionEntry } from "../types/v3/project";

// ─── テストヘルパー ────────────────────────────────────────────────────────

function makeScreen(overrides: Partial<Screen> & { id: string }): Screen {
  return {
    id: overrides.id,
    name: overrides.name ?? `screen-${overrides.id}`,
    kind: overrides.kind ?? "list",
    path: overrides.path ?? `/screens/${overrides.id}`,
    auth: overrides.auth ?? "required",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    maturity: "committed",
    items: overrides.items ?? [],
    ...overrides,
  } as unknown as Screen;
}

function makeFlowWithStep(
  flowId: string,
  sourceScreenId: string | null,
  targetScreenId: string,
  stepId = "step-nav-01",
): ProcessFlow {
  return {
    meta: {
      id: flowId,
      name: `flow-${flowId}`,
      kind: "screen",
      screenId: sourceScreenId ?? undefined,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    } as ProcessFlow["meta"],
    actions: [
      {
        id: "act-1",
        name: "action",
        trigger: "submit",
        steps: [
          {
            id: stepId,
            kind: "screenTransition",
            description: "遷移",
            targetScreenId,
          },
        ],
      },
    ],
  } as ProcessFlow;
}

function makeEdge(id: string, src: string, tgt: string): ScreenTransitionEntry {
  return {
    id,
    sourceScreenId: src as ScreenTransitionEntry["sourceScreenId"],
    targetScreenId: tgt as ScreenTransitionEntry["targetScreenId"],
    trigger: "click",
  };
}

// ─── 観点 1: UNKNOWN_TARGET_SCREEN ────────────────────────────────────────

describe("UNKNOWN_TARGET_SCREEN", () => {
  it("存在しない targetScreenId を検出する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-NOT-EXIST");
    const screens = [makeScreen({ id: "screen-A", path: "/a" })];
    const issues = checkScreenNavigation([flow], screens, []);
    const found = issues.filter((i) => i.code === "UNKNOWN_TARGET_SCREEN");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("存在する targetScreenId は検出しない", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-B");
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const issues = checkScreenNavigation([flow], screens, [makeEdge("e1", "screen-A", "screen-B")]);
    const found = issues.filter((i) => i.code === "UNKNOWN_TARGET_SCREEN");
    expect(found).toHaveLength(0);
  });
});

// ─── 観点 2: MISSING_FLOW_EDGE ────────────────────────────────────────────

describe("MISSING_FLOW_EDGE", () => {
  it("step にあって edge がない遷移を warning で検出する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-B");
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const issues = checkScreenNavigation([flow], screens, []); // edge なし
    const found = issues.filter((i) => i.code === "MISSING_FLOW_EDGE");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("warning");
  });

  it("対応する edge があれば検出しない", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-B");
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const edges = [makeEdge("e1", "screen-A", "screen-B")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "MISSING_FLOW_EDGE");
    expect(found).toHaveLength(0);
  });
});

// ─── 観点 3: MISSING_FLOW_TRANSITION (kind="flow-driven" のみ、#744) ─────

describe("MISSING_FLOW_TRANSITION", () => {
  it("kind='flow-driven' で step が無い遷移を error で検出する", () => {
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const edges = [{ ...makeEdge("e1", "screen-A", "screen-B"), kind: "flow-driven" as const }];
    const issues = checkScreenNavigation([], screens, edges);
    const found = issues.filter((i) => i.code === "MISSING_FLOW_TRANSITION");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("kind='flow-driven' で対応する step があれば検出しない", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-B");
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const edges = [{ ...makeEdge("e1", "screen-A", "screen-B"), kind: "flow-driven" as const }];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "MISSING_FLOW_TRANSITION");
    expect(found).toHaveLength(0);
  });

  it("kind='navigation' は step が無くても検出しない (純 UI 遷移)", () => {
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const edges = [{ ...makeEdge("e1", "screen-A", "screen-B"), kind: "navigation" as const }];
    const issues = checkScreenNavigation([], screens, edges);
    const found = issues.filter((i) => i.code === "MISSING_FLOW_TRANSITION");
    expect(found).toHaveLength(0);
  });

  it("kind 省略時は 'navigation' とみなして検出しない (default)", () => {
    const screens = [makeScreen({ id: "screen-A", path: "/a" }), makeScreen({ id: "screen-B", path: "/b" })];
    const edges = [makeEdge("e1", "screen-A", "screen-B")]; // kind 省略
    const issues = checkScreenNavigation([], screens, edges);
    const found = issues.filter((i) => i.code === "MISSING_FLOW_TRANSITION");
    expect(found).toHaveLength(0);
  });
});

// ─── 観点 4: DUPLICATE_SCREEN_PATH ───────────────────────────────────────

describe("DUPLICATE_SCREEN_PATH", () => {
  it("同じ path を持つ画面が複数ある場合 error で検出する", () => {
    const screens = [
      makeScreen({ id: "screen-A", path: "/duplicate/path" }),
      makeScreen({ id: "screen-B", path: "/duplicate/path" }),
    ];
    const issues = checkScreenNavigation([], screens, []);
    const found = issues.filter((i) => i.code === "DUPLICATE_SCREEN_PATH");
    expect(found.length).toBeGreaterThanOrEqual(2); // 両方に報告
    expect(found[0].severity).toBe("error");
  });

  it("path が全て異なる場合は検出しない", () => {
    const screens = [
      makeScreen({ id: "screen-A", path: "/path-a" }),
      makeScreen({ id: "screen-B", path: "/path-b" }),
    ];
    const issues = checkScreenNavigation([], screens, []);
    const found = issues.filter((i) => i.code === "DUPLICATE_SCREEN_PATH");
    expect(found).toHaveLength(0);
  });

  it("path が undefined の画面は DUPLICATE_SCREEN_PATH に含めない", () => {
    const screenA = makeScreen({ id: "screen-A" });
    const screenB = makeScreen({ id: "screen-B" });
    // path を undefined に
    (screenA as Record<string, unknown>).path = undefined;
    (screenB as Record<string, unknown>).path = undefined;
    const issues = checkScreenNavigation([], [screenA, screenB], []);
    const found = issues.filter((i) => i.code === "DUPLICATE_SCREEN_PATH");
    expect(found).toHaveLength(0);
  });
});

// ─── 観点 5: PATH_PARAM_MISMATCH ─────────────────────────────────────────

describe("PATH_PARAM_MISMATCH", () => {
  it("target が :param を要求するが source に同パラメータがない場合 warning で検出する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-list", "screen-detail");
    const screens = [
      makeScreen({ id: "screen-list", path: "/items" }),
      makeScreen({ id: "screen-detail", path: "/items/:itemId" }),
    ];
    const edges = [makeEdge("e1", "screen-list", "screen-detail")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "PATH_PARAM_MISMATCH");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("itemId");
  });

  it("source も同じ :param を持つ場合は検出しない", () => {
    const flow = makeFlowWithStep("flow-1", "screen-detail", "screen-edit");
    const screens = [
      makeScreen({ id: "screen-detail", path: "/items/:itemId" }),
      makeScreen({ id: "screen-edit", path: "/items/:itemId/edit" }),
    ];
    const edges = [makeEdge("e1", "screen-detail", "screen-edit")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "PATH_PARAM_MISMATCH");
    expect(found).toHaveLength(0);
  });
});

// ─── 観点 6: AUTH_TRANSITION_VIOLATION ───────────────────────────────────

describe("AUTH_TRANSITION_VIOLATION", () => {
  it("auth=none → auth=required の直接遷移を error で検出する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-public", "screen-private");
    const screens = [
      makeScreen({ id: "screen-public", path: "/public", auth: "none" }),
      makeScreen({ id: "screen-private", path: "/private", auth: "required" }),
    ];
    const edges = [makeEdge("e1", "screen-public", "screen-private")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "AUTH_TRANSITION_VIOLATION");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("(g) kind=login への遷移は例外として除外する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-public", "screen-login");
    const screens = [
      makeScreen({ id: "screen-public", path: "/public", auth: "none" }),
      makeScreen({ id: "screen-login", path: "/login", auth: "required", kind: "login" }),
    ];
    const edges = [makeEdge("e1", "screen-public", "screen-login")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "AUTH_TRANSITION_VIOLATION");
    expect(found).toHaveLength(0);
  });

  it("(g) kind=error への遷移は例外として除外する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-public", "screen-error");
    const screens = [
      makeScreen({ id: "screen-public", path: "/public", auth: "none" }),
      makeScreen({ id: "screen-error", path: "/error", auth: "required", kind: "error" }),
    ];
    const edges = [makeEdge("e1", "screen-public", "screen-error")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "AUTH_TRANSITION_VIOLATION");
    expect(found).toHaveLength(0);
  });

  it("auth=required → auth=required は正常", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-B");
    const screens = [
      makeScreen({ id: "screen-A", path: "/a", auth: "required" }),
      makeScreen({ id: "screen-B", path: "/b", auth: "required" }),
    ];
    const edges = [makeEdge("e1", "screen-A", "screen-B")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "AUTH_TRANSITION_VIOLATION");
    expect(found).toHaveLength(0);
  });
});

// ─── 観点 7: DEAD_END_SCREEN ──────────────────────────────────────────────

describe("DEAD_END_SCREEN", () => {
  it("遷移先にはなるが source にならない画面 (kind=list) を warning で検出する", () => {
    // screen-A → screen-B. screen-B は target だが source にならず、kind!=complete/error
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-B");
    const screens = [
      makeScreen({ id: "screen-A", path: "/a", kind: "list" }),
      makeScreen({ id: "screen-B", path: "/b", kind: "detail" }),
    ];
    const edges = [makeEdge("e1", "screen-A", "screen-B")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "DEAD_END_SCREEN");
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((i) => i.path.includes("screen-B"))).toBe(true);
    expect(found[0].severity).toBe("warning");
  });

  it("kind=complete の画面は DEAD_END_SCREEN から除外する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-complete");
    const screens = [
      makeScreen({ id: "screen-A", path: "/a", kind: "list" }),
      makeScreen({ id: "screen-complete", path: "/complete", kind: "complete" }),
    ];
    const edges = [makeEdge("e1", "screen-A", "screen-complete")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "DEAD_END_SCREEN");
    expect(found).toHaveLength(0);
  });

  it("kind=error の画面は DEAD_END_SCREEN から除外する", () => {
    const flow = makeFlowWithStep("flow-1", "screen-A", "screen-err");
    const screens = [
      makeScreen({ id: "screen-A", path: "/a", kind: "list" }),
      makeScreen({ id: "screen-err", path: "/error", kind: "error" }),
    ];
    const edges = [makeEdge("e1", "screen-A", "screen-err")];
    const issues = checkScreenNavigation([flow], screens, edges);
    const found = issues.filter((i) => i.code === "DEAD_END_SCREEN");
    expect(found).toHaveLength(0);
  });

  it("source にもなる画面は DEAD_END_SCREEN にならない", () => {
    // A → B → C の連鎖: B は target だが source でもある
    const flowAB = makeFlowWithStep("flow-AB", "screen-A", "screen-B", "step-1");
    const flowBC = makeFlowWithStep("flow-BC", "screen-B", "screen-C", "step-2");
    const screens = [
      makeScreen({ id: "screen-A", path: "/a" }),
      makeScreen({ id: "screen-B", path: "/b" }),
      makeScreen({ id: "screen-C", path: "/c", kind: "complete" }),
    ];
    const edges = [makeEdge("e1", "screen-A", "screen-B"), makeEdge("e2", "screen-B", "screen-C")];
    const issues = checkScreenNavigation([flowAB, flowBC], screens, edges);
    const found = issues.filter((i) => i.code === "DEAD_END_SCREEN" && i.path.includes("screen-B"));
    expect(found).toHaveLength(0);
  });
});

// ─── 正常系: 完全整合 ─────────────────────────────────────────────────────

describe("正常系 (issue なし)", () => {
  it("2 画面の正常な遷移 (step + edge 整合) で issue なし", () => {
    const flow = makeFlowWithStep("flow-1", "screen-list", "screen-complete");
    const screens = [
      makeScreen({ id: "screen-list", path: "/items", kind: "list" }),
      makeScreen({ id: "screen-complete", path: "/complete", kind: "complete" }),
    ];
    const edges = [makeEdge("e1", "screen-list", "screen-complete")];
    const issues = checkScreenNavigation([flow], screens, edges);
    // complete は dead-end 除外, 全整合
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("フローが空で画面と edge もない場合は issue なし", () => {
    const issues = checkScreenNavigation([], [], []);
    expect(issues).toHaveLength(0);
  });

  it("source 不明フロー (screenId なし) の step は source 依存観点をスキップする", () => {
    // screenId がない flow からの ScreenTransitionStep は MISSING_FLOW_EDGE / AUTH_TRANSITION_VIOLATION / PATH_PARAM_MISMATCH をスキップ
    const flow: ProcessFlow = {
      meta: {
        id: "flow-no-screen",
        name: "no-screen-flow",
        kind: "common",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      } as ProcessFlow["meta"],
      actions: [
        {
          id: "act-1",
          name: "act",
          trigger: "submit",
          steps: [
            {
              id: "step-nav",
              kind: "screenTransition",
              description: "遷移",
              targetScreenId: "screen-B",
            },
          ],
        },
      ],
    } as ProcessFlow;
    const screens = [makeScreen({ id: "screen-B", path: "/b" })];
    const issues = checkScreenNavigation([flow], screens, []);
    // source 不明なので MISSING_FLOW_EDGE / AUTH_TRANSITION_VIOLATION はスキップ (観点 1, 4 のみ評価)
    const errorIssues = issues.filter((i) => i.severity === "error");
    expect(errorIssues.filter((i) => i.code === "UNKNOWN_TARGET_SCREEN")).toHaveLength(0); // target は存在する
    expect(errorIssues.filter((i) => i.code === "AUTH_TRANSITION_VIOLATION")).toHaveLength(0);
  });
});

// ─── edge case: 複数フロー・複数 step ────────────────────────────────────

describe("複数フロー・複数 step の edge case", () => {
  it("branch 内の screenTransition step も walk できる", () => {
    const flow: ProcessFlow = {
      meta: {
        id: "flow-branch",
        name: "branch-flow",
        kind: "screen",
        screenId: "screen-A",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      } as ProcessFlow["meta"],
      actions: [
        {
          id: "act-1",
          name: "act",
          trigger: "submit",
          steps: [
            {
              id: "branch-1",
              kind: "branch",
              description: "分岐",
              branches: [
                {
                  id: "br-a",
                  code: "A",
                  label: "A",
                  condition: { kind: "expression", expression: "true" },
                  steps: [
                    {
                      id: "step-nav",
                      kind: "screenTransition",
                      description: "遷移",
                      targetScreenId: "screen-NOT-EXIST",
                    },
                  ],
                },
              ],
              elseBranch: { id: "br-else", code: "B", label: "B", steps: [] },
            },
          ],
        },
      ],
    } as ProcessFlow;

    const screens = [makeScreen({ id: "screen-A", path: "/a" })];
    const issues = checkScreenNavigation([flow], screens, []);
    const found = issues.filter((i) => i.code === "UNKNOWN_TARGET_SCREEN");
    expect(found.length).toBeGreaterThan(0);
  });
});
