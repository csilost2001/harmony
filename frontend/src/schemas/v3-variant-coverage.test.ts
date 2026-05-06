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

let validateProcessFlow: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  ajv.addSchema(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
  validateProcessFlow = ajv.compile(loadJson(join(v3Dir, "process-flow.v3.schema.json")) as object);
});

const META_BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "fixture flow",
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
  kind: "screen",
};

function makeFlow(steps: unknown[], opts?: { contextOverride?: object; metaOverride?: object }): unknown {
  return {
    meta: { ...META_BASE, ...(opts?.metaOverride ?? {}) },
    ...(opts?.contextOverride ? { context: opts.contextOverride } : {}),
    actions: [
      {
        id: "act-001",
        name: "fixture",
        trigger: "submit",
        steps,
      },
    ],
  };
}

function dump(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((e) => `${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`)
    .join("\n");
}

function expectPass(flow: unknown, hint: string) {
  const ok = validateProcessFlow(flow);
  expect(ok, ok ? "" : `${hint}\n${dump(validateProcessFlow)}`).toBe(true);
}

function expectFail(flow: unknown, hint: string) {
  const ok = validateProcessFlow(flow);
  expect(ok, ok ? `${hint} should have failed` : "").toBe(false);
}

describe("v3 variant fixture coverage — BranchCondition (#531)", () => {
  it("kind=tryCatch with errorCode", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "branch",
        description: "tryCatch fixture",
        branches: [
          {
            id: "br-a",
            code: "A",
            condition: { kind: "tryCatch", errorCode: "STOCK_SHORTAGE" },
            steps: [],
          },
        ],
      },
    ]);
    expectPass(flow, "BranchCondition tryCatch");
  });

  it("kind=affectedRowsZero with stepId", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "branch",
        description: "affectedRowsZero fixture",
        branches: [
          {
            id: "br-a",
            code: "A",
            condition: { kind: "affectedRowsZero", stepId: "step-prev" },
            steps: [],
          },
        ],
      },
    ]);
    expectPass(flow, "BranchCondition affectedRowsZero");
  });

  it("kind=externalOutcome with outcome", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "branch",
        description: "externalOutcome fixture",
        branches: [
          {
            id: "br-a",
            code: "A",
            condition: {
              kind: "externalOutcome",
              stepId: "step-ext",
              outcome: "failure",
            },
            steps: [],
          },
        ],
      },
    ]);
    expectPass(flow, "BranchCondition externalOutcome");
  });
});

describe("v3 variant fixture coverage — Step kinds (#531)", () => {
  it("kind=screenTransition", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "screenTransition",
        description: "screen transition fixture",
        targetScreenId: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    expectPass(flow, "ScreenTransitionStep");
  });

  it("kind=displayUpdate", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "displayUpdate",
        description: "display update fixture",
        target: "$.dashboardWidget",
      },
    ]);
    expectPass(flow, "DisplayUpdateStep");
  });

  it("kind=eventSubscribe with topic + filter", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "eventSubscribe",
        description: "event subscribe fixture",
        topic: "order.confirmed",
        filter: "@payload.amount > 1000",
      },
    ]);
    expectPass(flow, "EventSubscribeStep");
  });

  it("kind=jump with jumpTo", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "jump",
        description: "jump fixture",
        jumpTo: "step-99",
      },
    ]);
    expectPass(flow, "JumpStep");
  });

  it("kind=loopBreak inside LoopStep", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "loop",
        description: "loop with break",
        loopKind: "collection",
        collectionSource: "@items",
        collectionItemName: "item",
        steps: [
          {
            id: "step-01-01",
            kind: "loopBreak",
            description: "break fixture",
          },
        ],
      },
    ]);
    expectPass(flow, "LoopBreakStep");
  });

  it("kind=loopContinue inside LoopStep", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "loop",
        description: "loop with continue",
        loopKind: "collection",
        collectionSource: "@items",
        collectionItemName: "item",
        steps: [
          {
            id: "step-01-01",
            kind: "loopContinue",
            description: "continue fixture",
          },
        ],
      },
    ]);
    expectPass(flow, "LoopContinueStep");
  });

  it("kind=commonProcess with refId + argumentMapping + returnMapping", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "commonProcess",
        description: "common process fixture",
        refId: "33333333-3333-4333-8333-333333333333",
        argumentMapping: { customerId: "@inputs.customerId" },
        returnMapping: { customerProfile: "顧客プロファイル" },
      },
    ]);
    expectPass(flow, "CommonProcessStep");
  });
});

describe("v3 variant fixture coverage — LoopKind (#531)", () => {
  it("loopKind=count with countExpression", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "loop",
        description: "count loop fixture",
        loopKind: "count",
        countExpression: "@inputs.retryMax",
        steps: [
          { id: "step-01-01", kind: "log", description: "tick", level: "info", message: "iteration" },
        ],
      },
    ]);
    expectPass(flow, "LoopStep count mode");
  });

  it("loopKind=condition with conditionExpression + conditionMode=continue", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "loop",
        description: "condition loop fixture",
        loopKind: "condition",
        conditionMode: "continue",
        conditionExpression: "@hasMore == true",
        steps: [
          { id: "step-01-01", kind: "log", description: "tick", level: "info", message: "iteration" },
        ],
      },
    ]);
    expectPass(flow, "LoopStep condition mode");
  });
});

describe("v3 variant fixture coverage — WorkflowPattern 11 種 + quorum 2 variants (#531)", () => {
  const APPROVERS = [
    { role: "@conv.role.staff", label: "担当", order: 1 },
    { role: "@conv.role.manager", label: "課長", order: 2 },
  ];

  function workflowFlow(extra: object) {
    return makeFlow([
      {
        id: "step-01",
        kind: "workflow",
        description: "workflow fixture",
        approvers: APPROVERS,
        ...extra,
      },
    ]);
  }

  it("pattern=review", () => {
    expectPass(workflowFlow({ pattern: "review" }), "WorkflowPattern review");
  });

  it("pattern=approval-parallel", () => {
    expectPass(workflowFlow({ pattern: "approval-parallel" }), "WorkflowPattern approval-parallel");
  });

  it("pattern=approval-veto", () => {
    expectPass(workflowFlow({ pattern: "approval-veto" }), "WorkflowPattern approval-veto");
  });

  it("pattern=approval-quorum with quorum.type=majority", () => {
    expectPass(
      workflowFlow({ pattern: "approval-quorum", quorum: { type: "majority" } }),
      "WorkflowPattern approval-quorum majority",
    );
  });

  it("pattern=approval-quorum with quorum.type=nOfM + n", () => {
    expectPass(
      workflowFlow({ pattern: "approval-quorum", quorum: { type: "nOfM", n: 2 } }),
      "WorkflowPattern approval-quorum nOfM",
    );
  });

  it("pattern=approval-escalation with escalateAfter + escalateTo", () => {
    expectPass(
      workflowFlow({
        pattern: "approval-escalation",
        escalateAfter: "PT24H",
        escalateTo: { role: "@conv.role.director" },
      }),
      "WorkflowPattern approval-escalation",
    );
  });

  it("pattern=sign-off", () => {
    expectPass(workflowFlow({ pattern: "sign-off" }), "WorkflowPattern sign-off");
  });

  it("pattern=acknowledge", () => {
    expectPass(workflowFlow({ pattern: "acknowledge" }), "WorkflowPattern acknowledge");
  });

  it("pattern=branch-merge", () => {
    expectPass(workflowFlow({ pattern: "branch-merge" }), "WorkflowPattern branch-merge");
  });

  it("pattern=discussion", () => {
    expectPass(workflowFlow({ pattern: "discussion" }), "WorkflowPattern discussion");
  });

  it("pattern=ad-hoc", () => {
    expectPass(workflowFlow({ pattern: "ad-hoc" }), "WorkflowPattern ad-hoc");
  });
});

describe("v3 variant fixture coverage — Context (#531)", () => {
  it("context.health + readiness + resources を全部使う", () => {
    const flow = makeFlow(
      [{ id: "step-01", kind: "log", description: "min", level: "info", message: "ok" }],
      {
        contextOverride: {
          health: {
            checks: [
              { name: "db ping", kind: "db", target: "primary", timeout: 1000 },
              { name: "external api", kind: "http", target: "https://api.example.com/health", timeout: 3000 },
            ],
          },
          readiness: {
            checks: [{ name: "warm cache", kind: "custom", target: "@fn.isCacheWarm()" }],
            minimumPassCount: 1,
          },
          resources: {
            cpu: { request: "100m", limit: "500m" },
            memory: { request: "256Mi", limit: "1Gi" },
            dbConnections: 10,
            timeout: 30,
          },
        },
      },
    );
    expectPass(flow, "Context health/readiness/resources");
  });
});

describe("v3 variant fixture coverage — Saga (txBoundary + compensatesFor) (#531)", () => {
  it("txBoundary.role=begin/member/end + compensatesFor", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "log",
        description: "saga begin",
        level: "info",
        message: "begin tx",
        txBoundary: { role: "begin", txId: "tx-saga-001" },
      },
      {
        id: "step-02",
        kind: "log",
        description: "saga member",
        level: "info",
        message: "do work",
        txBoundary: { role: "member", txId: "tx-saga-001" },
      },
      {
        id: "step-03",
        kind: "log",
        description: "saga compensation for step-02",
        level: "warn",
        message: "compensate",
        compensatesFor: "step-02",
      },
      {
        id: "step-04",
        kind: "log",
        description: "saga end",
        level: "info",
        message: "end tx",
        txBoundary: { role: "end", txId: "tx-saga-001" },
      },
    ]);
    expectPass(flow, "Saga txBoundary + compensatesFor");
  });
});

describe("v3 variant fixture coverage — CdcDestination 2 種 (#531)", () => {
  it("destination.kind=eventStream with topic", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "cdc",
        description: "CDC to event stream",
        tableIds: ["44444444-4444-4444-8444-444444444444"],
        captureMode: "incremental",
        destination: { kind: "eventStream", topic: "inventory.changed" },
      },
    ]);
    expectPass(flow, "CdcDestination eventStream");
  });

  it("destination.kind=table with tableId", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "cdc",
        description: "CDC to table",
        tableIds: ["44444444-4444-4444-8444-444444444444"],
        captureMode: "full",
        destination: { kind: "table", tableId: "55555555-5555-4555-8555-555555555555" },
      },
    ]);
    expectPass(flow, "CdcDestination table");
  });
});

describe("v3 variant fixture coverage — Negative tests (discriminator 機能確認) (#531)", () => {
  it("WorkflowPattern=approval-quorum で quorum 欠如 → reject", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "workflow",
        description: "missing quorum",
        pattern: "approval-quorum",
        approvers: [{ role: "@conv.role.x" }],
      },
    ]);
    expectFail(flow, "approval-quorum requires quorum");
  });

  it("WorkflowPattern=approval-escalation で escalateAfter/escalateTo 欠如 → reject", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "workflow",
        description: "missing escalation fields",
        pattern: "approval-escalation",
        approvers: [{ role: "@conv.role.x" }],
      },
    ]);
    expectFail(flow, "approval-escalation requires escalateAfter+escalateTo");
  });

  it("BranchCondition kind=tryCatch で errorCode 欠如 → reject", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "branch",
        description: "tryCatch missing errorCode",
        branches: [
          {
            id: "br-a",
            code: "A",
            condition: { kind: "tryCatch" },
            steps: [],
          },
        ],
      },
    ]);
    expectFail(flow, "tryCatch requires errorCode");
  });

  it("CdcDestination kind=eventStream で topic 欠如 → reject", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "cdc",
        description: "eventStream missing topic",
        tableIds: ["44444444-4444-4444-8444-444444444444"],
        captureMode: "incremental",
        destination: { kind: "eventStream" },
      },
    ]);
    expectFail(flow, "eventStream requires topic");
  });

  it("WorkflowQuorum.type=nOfM で n 欠如 → reject", () => {
    const flow = makeFlow([
      {
        id: "step-01",
        kind: "workflow",
        description: "nOfM missing n",
        pattern: "approval-quorum",
        approvers: [{ role: "@conv.role.x" }],
        quorum: { type: "nOfM" },
      },
    ]);
    expectFail(flow, "WorkflowQuorum nOfM requires n");
  });
});

// ─── #533 R3-1/R3-2/R3-3 schema fix の機能検証 ──────────────────────────

import Ajv2020Default, { type ValidateFunction as VF2 } from "ajv/dist/2020";
import addFormatsDefault from "ajv-formats";

let validateScreenItem: VF2;

beforeAll(() => {
  const ajv2 = new Ajv2020Default({ allErrors: true, strict: false, discriminator: true });
  addFormatsDefault(ajv2);
  ajv2.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateScreenItem = ajv2.compile(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
});

describe("v3 schema fix #533 R3-1: IdentifierPath で object field 参照 (#533)", () => {
  it("variableName='createdOrder.order_number' (ドット区切り) は pass する", () => {
    const item = {
      id: "orderNumber",
      label: "指示番号",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "createdOrder.order_number" },
    };
    const ok = validateScreenItem(item);
    expect(ok, ok ? "" : (validateScreenItem.errors ?? []).map((e) => e.message).join("\n")).toBe(true);
  });

  it("variableName='inventoryRows' (Identifier 単独) も依然 pass する", () => {
    const item = {
      id: "items",
      label: "items",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "inventoryRows" },
    };
    const ok = validateScreenItem(item);
    expect(ok).toBe(true);
  });

  it("variableName='Foo.bar' (大文字始まり) は依然 reject (IdentifierPath 規範: 各セグメント小文字始まり)", () => {
    const item = {
      id: "x",
      label: "x",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "Foo.bar" },
    };
    const ok = validateScreenItem(item);
    expect(ok).toBe(false);
  });

  it("variableName='response.data[0].name' (array index 含む) は reject (expression 形式を使う)", () => {
    const item = {
      id: "x",
      label: "x",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "response.data[0].name" },
    };
    const ok = validateScreenItem(item);
    expect(ok).toBe(false);
  });

  it("variableName='test_' (末尾 underscore) は reject (PR #534 N-1 で厳格化)", () => {
    const item = {
      id: "x",
      label: "x",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "test_" },
    };
    const ok = validateScreenItem(item);
    expect(ok).toBe(false);
  });

  it("variableName='user__name' (連続 underscore) は reject (PR #534 N-1 で厳格化)", () => {
    const item = {
      id: "x",
      label: "x",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "user__name" },
    };
    const ok = validateScreenItem(item);
    expect(ok).toBe(false);
  });

  it("variableName='user_id' (snake_case 1 セグメント) は pass", () => {
    const item = {
      id: "x",
      label: "x",
      type: "string",
      direction: "output",
      valueFrom: { kind: "flowVariable", variableName: "user_id" },
    };
    const ok = validateScreenItem(item);
    expect(ok).toBe(true);
  });
});

describe("v3 schema fix #533 R3-2: ClosingStep.cutoffAt pattern (#533)", () => {
  function closingFlow(cutoffAt: string) {
    return makeFlow([
      {
        id: "step-01",
        kind: "closing",
        description: "closing fixture",
        period: "monthly",
        cutoffAt,
      },
    ]);
  }

  it("cutoffAt='23:59:59' (HH:MM:SS) は pass", () => {
    expectPass(closingFlow("23:59:59"), "cutoffAt HH:MM:SS");
  });

  it("cutoffAt='23:59' (HH:MM) も pass", () => {
    expectPass(closingFlow("23:59"), "cutoffAt HH:MM");
  });

  it("cutoffAt='00:00:00' は pass", () => {
    expectPass(closingFlow("00:00:00"), "cutoffAt min");
  });

  it("cutoffAt='99:99' は reject", () => {
    expectFail(closingFlow("99:99"), "cutoffAt 99:99 should reject");
  });

  it("cutoffAt='25:00:00' (時 24+) は reject", () => {
    expectFail(closingFlow("25:00:00"), "cutoffAt 25:00:00 should reject");
  });
});

describe("v3 schema fix #533 R3-3: scheduled + httpRoute 不整合 reject (#533)", () => {
  it("kind=scheduled + Action に httpRoute なし → pass", () => {
    const flow = makeFlow(
      [{ id: "step-01", kind: "log", description: "ok", level: "info", message: "ok" }],
      { metaOverride: { kind: "scheduled" } },
    );
    expectPass(flow, "scheduled + no httpRoute");
  });

  it("kind=screen + Action に httpRoute あり → 従来通り pass", () => {
    const flow = {
      meta: { ...META_BASE, kind: "screen" },
      actions: [
        {
          id: "act-001",
          name: "fixture",
          trigger: "submit",
          httpRoute: { method: "POST", path: "/api/x" },
          steps: [{ id: "step-01", kind: "log", description: "ok", level: "info", message: "ok" }],
        },
      ],
    };
    expectPass(flow, "screen + httpRoute should pass");
  });

  it("kind=scheduled + Action に httpRoute あり → reject (R3-3 if/then)", () => {
    const flow = {
      meta: { ...META_BASE, kind: "scheduled" },
      actions: [
        {
          id: "act-001",
          name: "fixture",
          trigger: "auto",
          httpRoute: { method: "POST", path: "/api/x" },
          steps: [{ id: "step-01", kind: "log", description: "ok", level: "info", message: "ok" }],
        },
      ],
    };
    expectFail(flow, "scheduled + httpRoute should reject");
  });
});

// ─── #762 viewer screen-item AJV テスト ────────────────────────────────────

describe("v3 schema #762: direction='viewer' の AJV 検証", () => {
  it("正常系: direction=viewer + viewDefinitionId + valueFrom.flowVariable は pass", () => {
    const item = {
      id: "propertyRows",
      label: "物件一覧",
      type: { kind: "array", itemType: "json" },
      direction: "viewer",
      viewDefinitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      valueFrom: {
        kind: "flowVariable",
        variableName: "rows",
      },
    };
    const ok = validateScreenItem(item);
    expect(ok, ok ? "" : (validateScreenItem.errors ?? []).map((e) => e.message).join("\n")).toBe(true);
  });

  it("正常系: direction=viewer + viewDefinitionId のみ (valueFrom 省略 = VD query 自動実行) は pass", () => {
    const item = {
      id: "propertyRows",
      label: "物件一覧",
      type: { kind: "array", itemType: "json" },
      direction: "viewer",
      viewDefinitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const ok = validateScreenItem(item);
    expect(ok, ok ? "" : (validateScreenItem.errors ?? []).map((e) => e.message).join("\n")).toBe(true);
  });

  it("異常系: direction=viewer で viewDefinitionId 欠落は AJV reject", () => {
    const item = {
      id: "propertyRows",
      label: "物件一覧",
      type: { kind: "array", itemType: "json" },
      direction: "viewer",
      // viewDefinitionId を意図的に省略
    };
    const ok = validateScreenItem(item);
    expect(ok, ok ? "direction=viewer で viewDefinitionId 欠落が pass してしまった" : "").toBe(false);
  });
});
