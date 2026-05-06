/**
 * screenItemViewerValidator テスト (#762)
 *
 * 3 観点それぞれの positive (検出) + negative (non-検出) 計 6 ケース:
 * 1. UNKNOWN_VIEWER_VIEW_DEFINITION
 * 2. MISSING_VIEWER_VIEW_DEFINITION
 * 3. VIEWER_FLOW_VARIABLE_NOT_DECLARED
 */

import { describe, it, expect } from "vitest";
import { checkScreenItemViewer } from "./screenItemViewerValidator.js";
import type { Screen } from "../types/v3/screen.js";
import type { ProcessFlow } from "../types/v3/process-flow.js";
import type { ViewDefinition } from "../types/v3/view-definition.js";

// ─── フィクスチャ ─────────────────────────────────────────────────────────

const SCREEN_ID = "11111111-1111-4111-8111-111111111111";
const VD_ID = "22222222-2222-4222-8222-222222222222";
const FLOW_ID = "33333333-3333-4333-8333-333333333333";

function makeScreen(items: object[]): Screen {
  return {
    id: SCREEN_ID,
    name: "テスト画面",
    kind: "search",
    path: "/test",
    maturity: "draft",
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    items,
  } as unknown as Screen;
}

function makeFlow(outputNames: string[]): ProcessFlow {
  return {
    meta: {
      id: FLOW_ID,
      name: "テストフロー",
      kind: "screen",
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z",
    },
    actions: [
      {
        id: "act-001",
        name: "テスト",
        trigger: "submit",
        inputs: [],
        outputs: outputNames.map((name) => ({ name, label: name, type: "string" })),
        steps: [],
      },
    ],
  } as unknown as ProcessFlow;
}

function makeVD(): ViewDefinition {
  return {
    id: VD_ID,
    name: "テスト VD",
    kind: "list",
    sourceTableId: "44444444-4444-4444-8444-444444444444",
    columns: [],
    maturity: "draft",
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
  } as unknown as ViewDefinition;
}

// ─── 観点 1: UNKNOWN_VIEWER_VIEW_DEFINITION ─────────────────────────────────

describe("screenItemViewerValidator — UNKNOWN_VIEWER_VIEW_DEFINITION", () => {
  it("positive: viewDefinitionId が存在しない VD を参照 → error 検出", () => {
    const screen = makeScreen([
      {
        id: "rows",
        label: "一覧",
        type: { kind: "array", itemType: "json" },
        direction: "viewer",
        viewDefinitionId: "99999999-9999-4999-8999-999999999999", // 存在しない
      },
    ]);
    const issues = checkScreenItemViewer([screen], [], []);
    const found = issues.find((i) => i.code === "UNKNOWN_VIEWER_VIEW_DEFINITION");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("error");
  });

  it("negative: viewDefinitionId が実在する VD を参照 → 検出なし", () => {
    const screen = makeScreen([
      {
        id: "rows",
        label: "一覧",
        type: { kind: "array", itemType: "json" },
        direction: "viewer",
        viewDefinitionId: VD_ID,
      },
    ]);
    const vd = makeVD();
    const issues = checkScreenItemViewer([screen], [], [vd]);
    const found = issues.find((i) => i.code === "UNKNOWN_VIEWER_VIEW_DEFINITION");
    expect(found).toBeUndefined();
  });
});

// ─── 観点 2: MISSING_VIEWER_VIEW_DEFINITION ─────────────────────────────────

describe("screenItemViewerValidator — MISSING_VIEWER_VIEW_DEFINITION", () => {
  it("positive: direction=viewer で viewDefinitionId 欠落 → error 検出", () => {
    const screen = makeScreen([
      {
        id: "rows",
        label: "一覧",
        type: { kind: "array", itemType: "json" },
        direction: "viewer",
        // viewDefinitionId 省略
      },
    ]);
    const issues = checkScreenItemViewer([screen], [], []);
    const found = issues.find((i) => i.code === "MISSING_VIEWER_VIEW_DEFINITION");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("error");
  });

  it("negative: direction=input は viewDefinitionId なくても検出なし", () => {
    const screen = makeScreen([
      {
        id: "keyword",
        label: "キーワード",
        type: "string",
        direction: "input",
      },
    ]);
    const issues = checkScreenItemViewer([screen], [], []);
    const found = issues.find((i) => i.code === "MISSING_VIEWER_VIEW_DEFINITION");
    expect(found).toBeUndefined();
  });
});

// ─── 観点 3: VIEWER_FLOW_VARIABLE_NOT_DECLARED ──────────────────────────────

describe("screenItemViewerValidator — VIEWER_FLOW_VARIABLE_NOT_DECLARED", () => {
  it("positive: variableName='rows' が ProcessFlow 出力に宣言なし → warning 検出", () => {
    const screen = makeScreen([
      {
        id: "propertyRows",
        label: "物件一覧",
        type: { kind: "array", itemType: "json" },
        direction: "viewer",
        viewDefinitionId: VD_ID,
        valueFrom: {
          kind: "flowVariable",
          processFlowId: FLOW_ID,
          variableName: "rows",
        },
      },
    ]);
    const flow = makeFlow(["items", "totalCount"]); // "rows" は宣言されていない
    const vd = makeVD();
    const issues = checkScreenItemViewer([screen], [flow], [vd]);
    const found = issues.find((i) => i.code === "VIEWER_FLOW_VARIABLE_NOT_DECLARED");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("warning");
  });

  it("negative: variableName='rows' が ProcessFlow 出力に宣言あり → 検出なし", () => {
    const screen = makeScreen([
      {
        id: "propertyRows",
        label: "物件一覧",
        type: { kind: "array", itemType: "json" },
        direction: "viewer",
        viewDefinitionId: VD_ID,
        valueFrom: {
          kind: "flowVariable",
          processFlowId: FLOW_ID,
          variableName: "rows",
        },
      },
    ]);
    const flow = makeFlow(["rows", "totalCount"]); // "rows" が宣言されている
    const vd = makeVD();
    const issues = checkScreenItemViewer([screen], [flow], [vd]);
    const found = issues.find((i) => i.code === "VIEWER_FLOW_VARIABLE_NOT_DECLARED");
    expect(found).toBeUndefined();
  });
});
