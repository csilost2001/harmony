/**
 * 画面項目イベント ↔ 処理フロー連携 validator テスト (#619)
 */
import { describe, it, expect } from "vitest";
import { checkScreenItemFlowConsistency } from "./screenItemFlowValidator";

const FLOW_ID_A = "11111111-1111-4111-8111-111111111111";
const FLOW_ID_B = "11111111-1111-4111-8111-222222222222";
const SCREEN_ID = "22222222-2222-4222-8222-222222222222";

function makeFlow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: {
      id: FLOW_ID_A,
      name: "test-flow",
      kind: "screen",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      ...((overrides.meta as Record<string, unknown>) ?? {}),
    },
    actions: [
      {
        id: "act1",
        name: "submit",
        trigger: "click",
        steps: [],
        inputs: [{ name: "userId", type: "string", required: true }],
      },
    ],
    ...overrides,
  };
}

function makeScreen(items: unknown[]): Record<string, unknown> {
  return {
    id: SCREEN_ID,
    name: "test-screen",
    kind: "form",
    path: "/test",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    items,
  };
}

describe("checkScreenItemFlowConsistency — UNKNOWN_HANDLER_FLOW", () => {
  it("存在しない handlerFlowId を検出する", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          { id: "click", handlerFlowId: "00000000-0000-4000-8000-000000000000" },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "UNKNOWN_HANDLER_FLOW");
    expect(errs).toHaveLength(1);
  });

  it("正しい handlerFlowId は検出しない", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          {
            id: "click",
            handlerFlowId: FLOW_ID_A,
            argumentMapping: { userId: "@session.userId" },
          },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    expect(issues).toHaveLength(0);
  });
});

describe("checkScreenItemFlowConsistency — MISSING_REQUIRED_ARGUMENT", () => {
  it("required input が argumentMapping に無いと検出する", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          { id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: {} },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "MISSING_REQUIRED_ARGUMENT");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("userId");
  });

  it("optional input が argumentMapping に無くても検出しない", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act1",
          name: "submit",
          trigger: "click",
          steps: [],
          inputs: [{ name: "userId", type: "string", required: false }],
        },
      ],
    });
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [{ id: "click", handlerFlowId: FLOW_ID_A }],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "MISSING_REQUIRED_ARGUMENT");
    expect(errs).toHaveLength(0);
  });
});

describe("checkScreenItemFlowConsistency — EXTRA_ARGUMENT", () => {
  it("argumentMapping のキーが inputs に無いと検出する", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          {
            id: "click",
            handlerFlowId: FLOW_ID_A,
            argumentMapping: {
              userId: "@session.userId",
              extraField: "@self.x",
            },
          },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "EXTRA_ARGUMENT");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("extraField");
  });
});

describe("checkScreenItemFlowConsistency — PRIMARY_INVOKER_MISMATCH", () => {
  it("primaryInvoker.screenId が見つからないと検出する", () => {
    const flow = makeFlow({
      meta: {
        id: FLOW_ID_A,
        name: "f",
        kind: "screen",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: "99999999-9999-4999-8999-999999999999",
          itemId: "submitBtn",
          eventId: "click",
        },
      },
    });
    const screen = makeScreen([]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "PRIMARY_INVOKER_MISMATCH");
    expect(errs).toHaveLength(1);
  });

  it("双方向整合: 該イベントの handlerFlowId と本 flow ID が一致しないと検出する", () => {
    const flow = makeFlow({
      meta: {
        id: FLOW_ID_A,
        name: "f",
        kind: "screen",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
          itemId: "submitBtn",
          eventId: "click",
        },
      },
    });
    const otherFlow = { ...flow, meta: { ...flow.meta as object, id: FLOW_ID_B } };
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          // 該イベントは別フロー (B) を呼んでいる
          { id: "click", handlerFlowId: FLOW_ID_B, argumentMapping: { userId: "@session.userId" } },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow, otherFlow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "PRIMARY_INVOKER_MISMATCH");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("双方向");
  });

  it("primaryInvoker と画面項目側 handlerFlowId が一致すれば検出しない", () => {
    const flow = makeFlow({
      meta: {
        id: FLOW_ID_A,
        name: "f",
        kind: "screen",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
          itemId: "submitBtn",
          eventId: "click",
        },
      },
    });
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          { id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@session.userId" } },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "PRIMARY_INVOKER_MISMATCH");
    expect(errs).toHaveLength(0);
  });
});

describe("checkScreenItemFlowConsistency — INCONSISTENT_ARGUMENT_CONTRACT", () => {
  it("1 flow × 多イベントで argKey 集合が異なると warning", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act1",
          name: "submit",
          trigger: "click",
          steps: [],
          inputs: [
            { name: "userId", type: "string", required: false },
            { name: "amount", type: "number", required: false },
          ],
        },
      ],
    });
    const screen = makeScreen([
      {
        id: "btn1",
        label: "送信1",
        type: "string",
        events: [
          { id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@s.u" } },
        ],
      },
      {
        id: "btn2",
        label: "送信2",
        type: "string",
        events: [
          { id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@s.u", amount: "@s.a" } },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const warns = issues.filter((i) => i.code === "INCONSISTENT_ARGUMENT_CONTRACT");
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(warns[0].severity).toBe("warning");
  });

  it("1 flow × 多イベントで argKey 集合が同じなら warning なし", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      {
        id: "btn1",
        label: "1",
        type: "string",
        events: [{ id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@s.u" } }],
      },
      {
        id: "btn2",
        label: "2",
        type: "string",
        events: [{ id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@s.u" } }],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const warns = issues.filter((i) => i.code === "INCONSISTENT_ARGUMENT_CONTRACT");
    expect(warns).toHaveLength(0);
  });
});

describe("checkScreenItemFlowConsistency — DUPLICATE_EVENT_ID", () => {
  it("画面項目内で event.id が重複すると検出する", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      {
        id: "submitBtn",
        label: "送信",
        type: "string",
        events: [
          { id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@s.u" } },
          { id: "click", handlerFlowId: FLOW_ID_A, argumentMapping: { userId: "@s.u" } },
        ],
      },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    const errs = issues.filter((i) => i.code === "DUPLICATE_EVENT_ID");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("'click'");
  });
});

describe("checkScreenItemFlowConsistency — empty inputs", () => {
  it("events が無い ScreenItem は検出ゼロ (後方互換)", () => {
    const flow = makeFlow();
    const screen = makeScreen([
      { id: "submitBtn", label: "送信", type: "string" },
    ]);
    const issues = checkScreenItemFlowConsistency([flow] as never, [screen] as never);
    expect(issues).toHaveLength(0);
  });

  it("空 flows / 空 screens で検出ゼロ", () => {
    expect(checkScreenItemFlowConsistency([], [])).toEqual([]);
  });
});
