/**
 * ScreenItem.events[] + ProcessFlow.meta.primaryInvoker AJV 検証 (#624)
 *
 * 画面項目イベント (backward reference) と処理フロー primaryInvoker 任意宣言の
 * schema 拡張に対する正常系・異常系・後方互換テスト。
 */
import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let ajv: Ajv2020;
let validateScreenItem: ValidateFunction;
let validateProcessFlow: ValidateFunction;

beforeAll(() => {
  ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateScreenItem = ajv.compile(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
  validateProcessFlow = ajv.compile(loadJson(join(v3Dir, "process-flow.v3.schema.json")) as object);
});

// RFC 4122 v4 UUID 形式 (3 ブロック目 "4xxx"、4 ブロック目 "[89ab]xxx") を満たすテスト用 UUID
const FLOW_UUID = "11111111-1111-4111-8111-111111111111";
const SCREEN_UUID = "22222222-2222-4222-8222-222222222222";

function makeMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FLOW_UUID,
    name: "test",
    version: "1.0.0",
    maturity: "draft",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    kind: "common",
    ...overrides,
  };
}

describe("ScreenItem.events[] (#624)", () => {
  it("events 未指定の最小 ScreenItem が pass する (後方互換)", () => {
    const item = { id: "submitBtn", label: "送信", type: "string" };
    expect(validateScreenItem(item)).toBe(true);
  });

  it("handlerFlowId + argumentMapping を持つ正常系", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [
        {
          id: "click",
          label: "クリック時",
          handlerFlowId: FLOW_UUID,
          argumentMapping: {
            userId: "@session.userId",
            amount: "@self.amountInput.value",
          },
        },
      ],
    };
    expect(validateScreenItem(item)).toBe(true);
  });

  it("複数の events (1 画面項目で複数イベント) が pass する", () => {
    const item = {
      id: "amountInput",
      label: "金額",
      type: "number",
      events: [
        { id: "change", handlerFlowId: FLOW_UUID },
        { id: "blur", handlerFlowId: FLOW_UUID },
      ],
    };
    expect(validateScreenItem(item)).toBe(true);
  });

  it("events.id を欠落させると fail", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [{ handlerFlowId: FLOW_UUID }],
    };
    expect(validateScreenItem(item)).toBe(false);
  });

  it("events.handlerFlowId を欠落させると fail", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [{ id: "click" }],
    };
    expect(validateScreenItem(item)).toBe(false);
  });

  it("events に未知のプロパティを含むと fail (additionalProperties: false)", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [
        { id: "click", handlerFlowId: FLOW_UUID, unknownField: "rejected" },
      ],
    };
    expect(validateScreenItem(item)).toBe(false);
  });

  it("argumentMapping のキーが Identifier 形式 (lowerCamelCase) でないと fail", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [
        {
          id: "click",
          handlerFlowId: FLOW_UUID,
          argumentMapping: {
            "Invalid-Key": "@self.value",
          },
        },
      ],
    };
    expect(validateScreenItem(item)).toBe(false);
  });

  it("argumentMapping の値が string (ExpressionString) でないと fail", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [
        {
          id: "click",
          handlerFlowId: FLOW_UUID,
          argumentMapping: {
            userId: 12345,
          },
        },
      ],
    };
    expect(validateScreenItem(item)).toBe(false);
  });
});

describe("ProcessFlow.meta.primaryInvoker (#624)", () => {
  it("primaryInvoker 未指定の最小 ProcessFlow が pass する (後方互換)", () => {
    const flow = { meta: makeMeta(), actions: [] };
    expect(validateProcessFlow(flow)).toBe(true);
  });

  it("primaryInvoker (screen-item-event) を持つ正常系", () => {
    const flow = {
      meta: makeMeta({
        kind: "screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_UUID,
          itemId: "submitBtn",
          eventId: "click",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(true);
  });

  it("primaryInvoker.screenId を欠落させると fail", () => {
    const flow = {
      meta: makeMeta({
        kind: "screen",
        primaryInvoker: {
          kind: "screen-item-event",
          itemId: "submitBtn",
          eventId: "click",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });

  it("primaryInvoker.kind が未対応の値だと fail", () => {
    const flow = {
      meta: makeMeta({
        kind: "screen",
        primaryInvoker: { kind: "unknown-invoker" },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });

  it("primaryInvoker に未知のトップレベルプロパティを含むと fail (additionalProperties: false)", () => {
    const flow = {
      meta: makeMeta({
        kind: "screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_UUID,
          itemId: "submitBtn",
          eventId: "click",
          unknownField: "rejected",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });

  it("primaryInvoker.itemId が Identifier 形式 (lowerCamelCase) でないと fail", () => {
    const flow = {
      meta: makeMeta({
        kind: "screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_UUID,
          itemId: "Submit-Btn",
          eventId: "click",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });
});
