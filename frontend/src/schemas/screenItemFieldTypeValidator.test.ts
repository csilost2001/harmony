import { describe, expect, it } from "vitest";
import type { ProcessFlow, StructuredField } from "../types/action";
import type { Screen } from "../types/v3/screen";
import type { ScreenItem, ScreenItemEvent } from "../types/v3/screen-item";
import { checkScreenItemFieldTypeConsistency } from "./screenItemFieldTypeValidator";

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_FLOW_ID = "99999999-9999-4999-8999-999999999999";
const SCREEN_ID = "22222222-2222-4222-8222-222222222222";

function makeEvent(argumentMapping?: Record<string, string>, handlerFlowId = FLOW_ID): ScreenItemEvent {
  return {
    id: "change",
    handlerFlowId,
    ...(argumentMapping === undefined ? {} : { argumentMapping }),
  };
}

function makeItem(
  id: string,
  type: unknown,
  overrides: Record<string, unknown> = {},
  events: ScreenItemEvent[] = [makeEvent({ value: `@self.${id}` })],
): ScreenItem {
  return {
    id,
    label: id,
    type,
    events,
    ...overrides,
  } as ScreenItem;
}

function makeScreen(screenId: string, items: ScreenItem[]): Screen {
  return {
    id: screenId,
    name: "test-screen",
    kind: "form",
    path: "/test",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    items,
  };
}

function makeFlow(flowId: string, inputs: StructuredField[]): ProcessFlow {
  return {
    meta: {
      id: flowId,
      name: "test-flow",
      kind: "screen",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    },
    actions: [
      {
        id: "act1",
        name: "submit",
        trigger: "change",
        inputs,
        steps: [],
      },
    ],
  };
}

function field(type: unknown, extra: Record<string, unknown> = {}): StructuredField {
  return { name: "value", type, ...extra } as StructuredField;
}

function issues(flows: ProcessFlow[], screens: Screen[]) {
  return checkScreenItemFieldTypeConsistency(flows, screens);
}

function codes(flows: ProcessFlow[], screens: Screen[]): string[] {
  return issues(flows, screens).map((issue) => issue.code);
}

describe("checkScreenItemFieldTypeConsistency", () => {
  it("detects OPTIONS_NOT_SUBSET_OF_ENUM", () => {
    const flow = makeFlow(FLOW_ID, [field("string", { domain: { enum: { values: ["A", "B"] } } })]);
    const screen = makeScreen(SCREEN_ID, [
      makeItem("status", "string", {
        options: [
          { value: "A", label: "A" },
          { value: "C", label: "C" },
        ],
      }),
    ]);

    const result = issues([flow], [screen]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: `screens[si=${SCREEN_ID}].items[ii=status].events[ei=change].argumentMapping.value`,
      code: "OPTIONS_NOT_SUBSET_OF_ENUM",
      severity: "error",
      screenId: SCREEN_ID,
      itemId: "status",
      flowId: FLOW_ID,
      inputId: "value",
    });
  });

  it("does not detect OPTIONS_NOT_SUBSET_OF_ENUM when options are inside enum", () => {
    const flow = makeFlow(FLOW_ID, [field("string", { domain: { enum: { values: ["A", "B"] } } })]);
    const screen = makeScreen(SCREEN_ID, [
      makeItem("status", "string", { options: [{ value: "A", label: "A" }] }),
    ]);

    expect(codes([flow], [screen])).not.toContain("OPTIONS_NOT_SUBSET_OF_ENUM");
  });

  it("detects DOMAIN_KEY_MISMATCH", () => {
    const flow = makeFlow(FLOW_ID, [field({ kind: "domain", domainKey: "CustomerId" })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("customerId", { kind: "domain", domainKey: "OrderId" })]);

    expect(issues([flow], [screen])).toMatchObject([{ code: "DOMAIN_KEY_MISMATCH", severity: "error" }]);
  });

  it("does not detect DOMAIN_KEY_MISMATCH when domainKey matches", () => {
    const flow = makeFlow(FLOW_ID, [field({ kind: "domain", domainKey: "CustomerId" })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("customerId", { kind: "domain", domainKey: "CustomerId" })]);

    expect(codes([flow], [screen])).not.toContain("DOMAIN_KEY_MISMATCH");
  });

  it("detects TYPE_MISMATCH through @self item reference", () => {
    const flow = makeFlow(FLOW_ID, [field("number")]);
    const screen = makeScreen(SCREEN_ID, [
      makeItem("button", "string", {}, [makeEvent({ value: "@self.amount" })]),
      makeItem("amount", "string", {}, []),
    ]);

    expect(issues([flow], [screen])).toMatchObject([{ code: "TYPE_MISMATCH", severity: "error" }]);
  });

  it("does not detect TYPE_MISMATCH when @self item type matches", () => {
    const flow = makeFlow(FLOW_ID, [field("number")]);
    const screen = makeScreen(SCREEN_ID, [
      makeItem("button", "string", {}, [makeEvent({ value: "@self.amount" })]),
      makeItem("amount", "number", {}, []),
    ]);

    expect(codes([flow], [screen])).not.toContain("TYPE_MISMATCH");
  });

  it("skips TYPE_MISMATCH for nested @self paths", () => {
    const flow = makeFlow(FLOW_ID, [field("number")]);
    const screen = makeScreen(SCREEN_ID, [
      makeItem("button", "string", {}, [makeEvent({ value: "@self.amount.value" })]),
      makeItem("amount", "string", {}, []),
    ]);

    expect(codes([flow], [screen])).not.toContain("TYPE_MISMATCH");
  });

  it("detects PATTERN_DIVERGENCE", () => {
    const flow = makeFlow(FLOW_ID, [field("string", { domain: { pattern: "^[A-Z]+$" } })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("code", "string", { validation: { pattern: "^[0-9]+$" } })]);

    expect(issues([flow], [screen])).toMatchObject([{ code: "PATTERN_DIVERGENCE", severity: "warning" }]);
  });

  it("does not detect PATTERN_DIVERGENCE when pattern matches", () => {
    const flow = makeFlow(FLOW_ID, [field("string", { domain: { pattern: "^[A-Z]+$" } })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("code", "string", { validation: { pattern: "^[A-Z]+$" } })]);

    expect(codes([flow], [screen])).not.toContain("PATTERN_DIVERGENCE");
  });

  it("detects RANGE_DIVERGENCE", () => {
    const flow = makeFlow(FLOW_ID, [field("number", { domain: { minimum: 1, maximum: 10 } })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("quantity", "number", { validation: { minimum: 2, maximum: 10 } })]);

    expect(issues([flow], [screen])).toMatchObject([{ code: "RANGE_DIVERGENCE", severity: "warning" }]);
  });

  it("does not detect RANGE_DIVERGENCE when range matches", () => {
    const flow = makeFlow(FLOW_ID, [field("number", { domain: { minimum: 1, maximum: 10 } })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("quantity", "number", { validation: { minimum: 1, maximum: 10 } })]);

    expect(codes([flow], [screen])).not.toContain("RANGE_DIVERGENCE");
  });

  it("detects LENGTH_DIVERGENCE", () => {
    const flow = makeFlow(FLOW_ID, [field("string", { domain: { minLength: 1, maxLength: 20 } })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("name", "string", { validation: { minLength: 1, maxLength: 10 } })]);

    expect(issues([flow], [screen])).toMatchObject([{ code: "LENGTH_DIVERGENCE", severity: "warning" }]);
  });

  it("does not detect LENGTH_DIVERGENCE when length matches", () => {
    const flow = makeFlow(FLOW_ID, [field("string", { domain: { minLength: 1, maxLength: 20 } })]);
    const screen = makeScreen(SCREEN_ID, [makeItem("name", "string", { validation: { minLength: 1, maxLength: 20 } })]);

    expect(codes([flow], [screen])).not.toContain("LENGTH_DIVERGENCE");
  });

  it("returns no issues for empty input", () => {
    expect(checkScreenItemFieldTypeConsistency([], [])).toEqual([]);
  });

  it("returns no issues when argumentMapping is absent", () => {
    const flow = makeFlow(FLOW_ID, [field("number")]);
    const screen = makeScreen(SCREEN_ID, [makeItem("amount", "string", {}, [makeEvent(undefined)])]);

    expect(checkScreenItemFieldTypeConsistency([flow], [screen])).toEqual([]);
  });

  it("skips unknown handlerFlowId without crashing", () => {
    const flow = makeFlow(FLOW_ID, [field("number")]);
    const screen = makeScreen(SCREEN_ID, [makeItem("amount", "string", {}, [makeEvent({ value: "@self.amount" }, UNKNOWN_FLOW_ID)])]);

    expect(checkScreenItemFieldTypeConsistency([flow], [screen])).toEqual([]);
  });
});
