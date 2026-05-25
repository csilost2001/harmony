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

// RFC #1284: EntityId は kebab-case、uuid は RFC 4122 v4 を別 field で保持
const FLOW_ID = "fixture-flow";
const FLOW_UUID = "11111111-1111-4111-8111-111111111111";
const SCREEN_ID = "fixture-screen";

function makeMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FLOW_ID,
    uuid: FLOW_UUID,
    name: "test",
    version: "1.0.0",
    maturity: "draft",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    flowType: "common", // #1263 Phase X1: meta.kind → meta.flowType
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
          handlerFlowId: FLOW_ID,
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
        { id: "change", handlerFlowId: FLOW_ID },
        { id: "blur", handlerFlowId: FLOW_ID },
      ],
    };
    expect(validateScreenItem(item)).toBe(true);
  });

  it("events.id を欠落させると fail", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [{ handlerFlowId: FLOW_ID }],
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
        { id: "click", handlerFlowId: FLOW_ID, unknownField: "rejected" },
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
          handlerFlowId: FLOW_ID,
          argumentMapping: {
            "Invalid-Key": "@self.value",
          },
        },
      ],
    };
    expect(validateScreenItem(item)).toBe(false);
  });

  it("argumentMapping の値が string (TemplateString) でないと fail", () => {
    const item = {
      id: "submitBtn",
      label: "送信",
      type: "string",
      events: [
        {
          id: "click",
          handlerFlowId: FLOW_ID,
          argumentMapping: {
            userId: 12345,
          },
        },
      ],
    };
    expect(validateScreenItem(item)).toBe(false);
  });

  it("handlerActionId 付きで pass (#1019)", () => {
    const item = {
      id: "saveBtn",
      label: "保存",
      type: "string",
      events: [
        {
          id: "click",
          handlerFlowId: FLOW_ID,
          handlerActionId: "act-create",
          argumentMapping: { userId: "@session.userId" },
        },
      ],
    };
    expect(validateScreenItem(item)).toBe(true);
  });

  it("handlerActionId が LocalId 形式 (記号始まり等) を満たさないと fail (#1019)", () => {
    const item = {
      id: "saveBtn",
      label: "保存",
      type: "string",
      events: [
        {
          id: "click",
          handlerFlowId: FLOW_ID,
          handlerActionId: "-invalid-leading-hyphen",
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
        flowType: "screen", screenId: "fixture-target-screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
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
        flowType: "screen", screenId: "fixture-target-screen",
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
        flowType: "screen", screenId: "fixture-target-screen",
        primaryInvoker: { kind: "unknown-invoker" },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });

  it("primaryInvoker に未知のトップレベルプロパティを含むと fail (additionalProperties: false)", () => {
    const flow = {
      meta: makeMeta({
        flowType: "screen", screenId: "fixture-target-screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
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
        flowType: "screen", screenId: "fixture-target-screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
          itemId: "Submit-Btn",
          eventId: "click",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });

  it("primaryInvoker.actionId 付きで pass (#1019)", () => {
    const flow = {
      meta: makeMeta({
        flowType: "screen", screenId: "fixture-target-screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
          itemId: "saveBtn",
          eventId: "click",
          actionId: "act-create",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(true);
  });

  it("primaryInvoker.actionId が LocalId 形式を満たさないと fail (#1019)", () => {
    const flow = {
      meta: makeMeta({
        flowType: "screen", screenId: "fixture-target-screen",
        primaryInvoker: {
          kind: "screen-item-event",
          screenId: SCREEN_ID,
          itemId: "saveBtn",
          eventId: "click",
          actionId: "-invalid",
        },
      }),
      actions: [],
    };
    expect(validateProcessFlow(flow)).toBe(false);
  });
});

// ─── ScreenItem.events[].effects[] AJV 検証 (#1283) ───────────────────────

function makeItemWithEffects(effects: unknown[]): Record<string, unknown> {
  return {
    id: "submitBtn",
    label: "送信",
    type: "string",
    events: [
      {
        id: "click",
        handlerFlowId: FLOW_ID,
        effects,
      },
    ],
  };
}

describe("ScreenItem.events[].effects[] (#1065 / #1283)", () => {
  // --- 正常系 ---

  it("effects 未指定で pass (後方互換)", () => {
    const item = { id: "submitBtn", label: "送信", type: "string", events: [{ id: "click", handlerFlowId: FLOW_ID }] };
    expect(validateScreenItem(item)).toBe(true);
  });

  it("clear variant — kind + target で pass", () => {
    const item = makeItemWithEffects([{ kind: "clear", target: "cityList" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("setReadonly variant — boolean value で pass", () => {
    const item = makeItemWithEffects([{ kind: "setReadonly", target: "amountInput", value: true }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("setEnabled variant — boolean false で pass", () => {
    const item = makeItemWithEffects([{ kind: "setEnabled", target: "submitBtn", value: false }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("setVisible variant — TemplateString (string) value で pass", () => {
    const item = makeItemWithEffects([{ kind: "setVisible", target: "errorMsg", value: "@self.hasError" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("setOptions variant — target + value (string) で pass", () => {
    const item = makeItemWithEffects([{ kind: "setOptions", target: "prefSelect", value: "pref-catalog" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("showDialog variant — target のみ (value optional) で pass", () => {
    const item = makeItemWithEffects([{ kind: "showDialog", target: "confirmDialog" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("showDialog variant — target + value で pass", () => {
    const item = makeItemWithEffects([{ kind: "showDialog", target: "confirmDialog", value: "削除しますか?" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("setMessage variant — target + optional value で pass", () => {
    const item = makeItemWithEffects([{ kind: "setMessage", target: "errorArea" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("refreshList variant — target のみで pass", () => {
    const item = makeItemWithEffects([{ kind: "refreshList", target: "orderList" }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("applyAjaxResult variant — mapping object で pass", () => {
    const item = makeItemWithEffects([{ kind: "applyAjaxResult", mapping: { "data.cities": "cityList" } }]);
    expect(validateScreenItem(item)).toBe(true);
  });

  it("複数 effect を同時に持つ event が pass", () => {
    const item = makeItemWithEffects([
      { kind: "clear", target: "messageArea" },
      { kind: "setVisible", target: "spinner", value: true },
      { kind: "applyAjaxResult", mapping: { result: "outputField" } },
    ]);
    expect(validateScreenItem(item)).toBe(true);
  });

  // --- 異常系 ---

  it("clear variant — target 欠落で fail", () => {
    const item = makeItemWithEffects([{ kind: "clear" }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("setReadonly variant — value 欠落で fail", () => {
    const item = makeItemWithEffects([{ kind: "setReadonly", target: "nameInput" }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("setEnabled variant — target 欠落で fail", () => {
    const item = makeItemWithEffects([{ kind: "setEnabled", value: true }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("applyAjaxResult variant — mapping 欠落で fail", () => {
    const item = makeItemWithEffects([{ kind: "applyAjaxResult" }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("applyAjaxResult.mapping の value が Identifier 形式違反 (大文字始まり) で fail", () => {
    // Identifier は lowerCamelCase (^[a-z][a-zA-Z0-9]*$ パターン)
    const item = makeItemWithEffects([{ kind: "applyAjaxResult", mapping: { "data.cities": "InvalidKey" } }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("未知 kind で fail", () => {
    const item = makeItemWithEffects([{ kind: "unknownEffect", target: "field" }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("clear variant に unknownField を含むと fail (additionalProperties: false)", () => {
    const item = makeItemWithEffects([{ kind: "clear", target: "cityList", unknownField: "rejected" }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("setVisible variant に unknownField を含むと fail (additionalProperties: false)", () => {
    const item = makeItemWithEffects([{ kind: "setVisible", target: "field", value: true, unknownField: "rejected" }]);
    expect(validateScreenItem(item)).toBe(false);
  });

  it("applyAjaxResult variant に unknownField を含むと fail (additionalProperties: false)", () => {
    const item = makeItemWithEffects([{ kind: "applyAjaxResult", mapping: {}, unknownField: "rejected" }]);
    expect(validateScreenItem(item)).toBe(false);
  });
});
