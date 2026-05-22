// Phase-2 (#1145): step-cards/ 配下 15 個の sub-component の最小 rendering test。
//
// 各 sub-component は StepCard.tsx から純粋に抽出されたもの。本テストは
// (1) crash せず render される (2) kind 固有のキー要素が DOM に出る、を確認する。
// 詳細な振る舞いテストは元々 StepCard 系では薄かったため、本 PR では rendering 中心。

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  AiAgentStepCardBody,
  AiCallStepCardBody,
  AuditStepCardBody,
  BranchStepCardBody,
  CommonProcessStepCardBody,
  ComponentCallStepCardBody,
  ComputeStepCardBody,
  DbAccessStepCardBody,
  DisplayUpdateStepCardBody,
  EventPublishStepCardBody,
  EventSubscribeStepCardBody,
  ExternalSystemStepCardBody,
  JumpStepCardBody,
  LogStepCardBody,
  LoopStepCardBody,
  ReturnStepCardBody,
  ScreenTransitionStepCardBody,
  TransactionScopeStepCardBody,
  ValidationStepCardBody,
  WorkflowStepCardBody,
} from "./index";

// ── 共通テストヘルパ ───────────────────────────────────────────────

const noop = () => {};
const baseStep = (overrides: any = {}) => ({
  id: "step-1",
  description: "",
  ...overrides,
});

// ── ValidationStepCardBody ─────────────────────────────────────────

describe("ValidationStepCardBody", () => {
  it("conditions input が描画される", () => {
    const step = baseStep({ kind: "validation", conditions: "test-cond", rules: [] });
    const { container } = render(
      <ValidationStepCardBody
        step={step}
        allSteps={[]}
        onChange={noop}
      />,
    );
    const input = container.querySelector('[data-field-path="conditions"] input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("test-cond");
  });

  it("conditions 変更で onChange が呼ばれる", () => {
    const onChange = vi.fn();
    const step = baseStep({ kind: "validation", conditions: "", rules: [] });
    const { container } = render(
      <ValidationStepCardBody step={step} allSteps={[]} onChange={onChange} />,
    );
    const input = container.querySelector('[data-field-path="conditions"] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "新条件" } });
    expect(onChange).toHaveBeenCalledWith({ conditions: "新条件" });
  });
});

// ── DbAccessStepCardBody ────────────────────────────────────────────

describe("DbAccessStepCardBody", () => {
  const tables = [{ id: "t1", physicalName: "users", name: "ユーザー" }];

  it("operation select が描画される (SELECT 既定)", () => {
    const step = baseStep({ kind: "dbAccess", tableId: "", operation: "SELECT" });
    const { container } = render(
      <DbAccessStepCardBody step={step} allSteps={[]} tables={tables} onChange={noop} />,
    );
    const selects = container.querySelectorAll("select");
    expect(selects.length).toBeGreaterThanOrEqual(2); // table + operation
  });

  it("UPDATE 選択時に影響行数チェック UI が描画される", () => {
    const step = baseStep({ kind: "dbAccess", tableId: "t1", operation: "UPDATE" });
    const { container } = render(
      <DbAccessStepCardBody step={step} allSteps={[]} tables={tables} onChange={noop} />,
    );
    expect(container.textContent).toContain("影響行数チェック");
  });

  it("SELECT 時は影響行数チェック UI が出ない", () => {
    const step = baseStep({ kind: "dbAccess", tableId: "t1", operation: "SELECT" });
    const { container } = render(
      <DbAccessStepCardBody step={step} allSteps={[]} tables={tables} onChange={noop} />,
    );
    expect(container.textContent).not.toContain("影響行数チェック");
  });
});

// ── ExternalSystemStepCardBody ──────────────────────────────────────

describe("ExternalSystemStepCardBody", () => {
  it("systemRef input が描画される (#1016: protocol は v3 schema 外のため削除済)", () => {
    const step = baseStep({ kind: "externalSystem", systemRef: "stripe" });
    const { container } = render(
      <ExternalSystemStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("接続先");
    // protocol は v3 schema に存在しないため UI から削除済
    expect(container.textContent).not.toContain("プロトコル");
  });

  it("retryPolicy 未設定時は backoff select が出ない", () => {
    const step = baseStep({ kind: "externalSystem", systemRef: "stripe" });
    const { container } = render(
      <ExternalSystemStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).not.toContain("backoff:");
  });
});

// ── CommonProcessStepCardBody ───────────────────────────────────────

describe("CommonProcessStepCardBody", () => {
  it("commonGroups の選択肢を描画する", () => {
    const step = baseStep({ kind: "commonProcess", refId: "cg-1" });
    const cgs = [{ id: "cg-1", name: "認証" }, { id: "cg-2", name: "ログ" }];
    const { container } = render(
      <CommonProcessStepCardBody
        step={step}
        allSteps={[]}
        commonGroups={cgs}
        onChange={noop}
      />,
    );
    const opts = container.querySelectorAll("option");
    // 1 placeholder + 2 cg = 3
    expect(opts.length).toBe(3);
  });
});

// ── ComputeStepCardBody ─────────────────────────────────────────────

describe("ComputeStepCardBody", () => {
  it("expression input が描画される", () => {
    const step = baseStep({ kind: "compute", expression: "@a + @b" });
    const { container } = render(
      <ComputeStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("代入式");
  });
});

// ── ReturnStepCardBody ──────────────────────────────────────────────

describe("ReturnStepCardBody", () => {
  it("responseId と bodyExpression input を描画する (#1016: v3 ReturnStep.responseId に rename)", () => {
    const step = baseStep({ kind: "return", responseId: "200-ok" });
    const { container } = render(
      <ReturnStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("responseId");
    expect(container.textContent).toContain("bodyExpression");
  });
});

// ── ScreenTransitionStepCardBody ────────────────────────────────────

describe("ScreenTransitionStepCardBody", () => {
  it("screens の選択肢を描画する", () => {
    const step = baseStep({
      kind: "screenTransition",
      targetScreenId: "s-1",
      targetScreenName: "確認画面",
    });
    const screens = [{ id: "s-1", name: "確認画面" }];
    const { container } = render(
      <ScreenTransitionStepCardBody
        step={step}
        allSteps={[]}
        screens={screens}
        onChange={noop}
      />,
    );
    expect(container.textContent).toContain("遷移先画面");
    const opts = container.querySelectorAll("option");
    // 1 placeholder + 1 screen
    expect(opts.length).toBe(2);
  });
});

// ── DisplayUpdateStepCardBody ───────────────────────────────────────

describe("DisplayUpdateStepCardBody", () => {
  it("target input が描画される", () => {
    const step = baseStep({ kind: "displayUpdate", target: "メッセージ" });
    const { container } = render(
      <DisplayUpdateStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("メッセージ");
  });
});

// ── BranchStepCardBody ──────────────────────────────────────────────

describe("BranchStepCardBody", () => {
  const makeBranchStep = () =>
    baseStep({
      kind: "branch",
      branches: [
        { id: "b-1", code: "A", condition: { kind: "expression", expression: "" }, steps: [] },
        { id: "b-2", code: "B", condition: { kind: "expression", expression: "" }, steps: [] },
      ],
    });

  it("2 分岐 + add ボタンを描画する", () => {
    const step = makeBranchStep();
    const { container } = render(
      <BranchStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
      />,
    );
    const sections = container.querySelectorAll(".branch-section");
    expect(sections.length).toBe(2);
    const addBtn = container.querySelector(".branch-add-row");
    expect(addBtn).not.toBeNull();
  });

  it("readOnly=true で分岐追加ボタンを非表示", () => {
    const step = makeBranchStep();
    const { container } = render(
      <BranchStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
        readOnly
      />,
    );
    expect(container.querySelector(".branch-add-row")).toBeNull();
  });

  it("分岐を追加すると onChange + onCommit が呼ばれる", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const step = makeBranchStep();
    const { container } = render(
      <BranchStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={onChange}
        onCommit={onCommit}
        onNavigateCommon={noop}
      />,
    );
    const addBtn = container.querySelector(".branch-add-btn") as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const call = onChange.mock.calls[0][0];
    expect(call.branches.length).toBe(3);
    expect(call.branches[2].code).toBe("C");
  });
});

// ── LoopStepCardBody ────────────────────────────────────────────────

describe("LoopStepCardBody", () => {
  it("count loop で 回数 input を描画する", () => {
    const step = baseStep({
      kind: "loop",
      loopKind: "count",
      countExpression: "3",
      steps: [],
    });
    const { container } = render(
      <LoopStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
      />,
    );
    expect(container.textContent).toContain("回数 / 範囲");
  });

  it("condition loop で 条件モード + 条件式 を描画する", () => {
    const step = baseStep({
      kind: "loop",
      loopKind: "condition",
      conditionMode: "exit",
      conditionExpression: "残件数 > 0",
      steps: [],
    });
    const { container } = render(
      <LoopStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
      />,
    );
    expect(container.textContent).toContain("条件モード");
    expect(container.textContent).toContain("条件式");
  });

  it("collection loop で コレクション + 要素変数名 を描画する", () => {
    const step = baseStep({
      kind: "loop",
      loopKind: "collection",
      collectionSource: "items",
      collectionItemName: "item",
      steps: [],
    });
    const { container } = render(
      <LoopStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
      />,
    );
    expect(container.textContent).toContain("コレクション");
    expect(container.textContent).toContain("要素変数名");
  });
});

// ── LogStepCardBody / AuditStepCardBody / TransactionScopeStepCardBody ──
//    既存 *StepPanel.test.tsx でカバー済のため smoke のみ。

describe("LogStepCardBody", () => {
  it("crash せず描画される", () => {
    const step = baseStep({ kind: "log", level: "info", message: "" });
    const { container } = render(
      <LogStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe("AuditStepCardBody", () => {
  it("crash せず描画される", () => {
    const step = baseStep({ kind: "audit", action: "" });
    const { container } = render(
      <AuditStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe("TransactionScopeStepCardBody", () => {
  it("crash せず描画される", () => {
    const step = baseStep({
      kind: "transactionScope",
      isolationLevel: "READ_COMMITTED",
      propagation: "REQUIRED",
      steps: [],
    });
    const { container } = render(
      <TransactionScopeStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

// ── JumpStepCardBody ────────────────────────────────────────────────

describe("JumpStepCardBody", () => {
  it("ジャンプ先 label を描画する", () => {
    const step = baseStep({ kind: "jump", jumpTo: "step-2" });
    const { container } = render(
      <JumpStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("ジャンプ先");
  });
});

// ── WorkflowStepCardBody ────────────────────────────────────────────

describe("WorkflowStepCardBody", () => {
  it("crash せず描画される (approval-sequential)", () => {
    const step = baseStep({
      kind: "workflow",
      pattern: "approval-sequential",
      approvers: [],
      quorum: { type: "any" },
    });
    const { container } = render(
      <WorkflowStepCardBody
        step={step}
        allSteps={[]}
        tables={[]}
        screens={[]}
        commonGroups={[]}
        onChange={noop}
        onNavigateCommon={noop}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

// ── ComponentCallStepCardBody (Phase-3 #1145、#1163 review Phase-2 補足) ──
describe("ComponentCallStepCardBody", () => {
  it("componentRef / operation input が描画される", () => {
    const step = baseStep({
      kind: "componentCall",
      componentRef: "generic-definitions/component-definition/OrderValidator",
      operation: "validate",
    });
    const { container } = render(
      <ComponentCallStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("componentRef");
    expect(container.textContent).toContain("operation");
    const inputs = container.querySelectorAll("input");
    expect(inputs[0].value).toBe("generic-definitions/component-definition/OrderValidator");
    expect(inputs[1].value).toBe("validate");
  });

  it("componentRef 変更で onChange が呼ばれる", () => {
    const onChange = vi.fn();
    const step = baseStep({ kind: "componentCall", componentRef: "", operation: "" });
    const { container } = render(
      <ComponentCallStepCardBody step={step} allSteps={[]} onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "newRef" } });
    expect(onChange).toHaveBeenCalledWith({ componentRef: "newRef" });
  });
});

// ── AiCallStepCardBody (Phase-3 #1145、#1163 review Phase-2 補足) ────────
describe("AiCallStepCardBody", () => {
  it("modelRef input と messages textarea が描画される", () => {
    const step = baseStep({
      kind: "aiCall",
      modelRef: "summarizeModel",
      messages: [{ role: "system", content: "you are helpful" }],
    });
    const { container } = render(
      <AiCallStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("modelRef");
    expect(container.textContent).toContain("messages");
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("summarizeModel");
  });

  it("modelRef 変更で onChange が呼ばれる", () => {
    const onChange = vi.fn();
    const step = baseStep({ kind: "aiCall", modelRef: "", messages: [] });
    const { container } = render(
      <AiCallStepCardBody step={step} allSteps={[]} onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "claude-opus" } });
    expect(onChange).toHaveBeenCalledWith({ modelRef: "claude-opus" });
  });
});

// ── AiAgentStepCardBody (Phase-3 #1145、#1163 review Phase-2 補足) ───────
describe("AiAgentStepCardBody", () => {
  it("modelRef / maxIterations / tools が描画される", () => {
    const step = baseStep({
      kind: "aiAgent",
      modelRef: "agentModel",
      messages: [],
      tools: [{ functionRef: "catalogs.functions.search" }],
      maxIterations: 5,
    });
    const { container } = render(
      <AiAgentStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("modelRef");
    expect(container.textContent).toContain("maxIterations");
    expect(container.textContent).toContain("tools");
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numberInput.value).toBe("5");
  });

  it("maxIterations 変更で onChange が呼ばれる", () => {
    const onChange = vi.fn();
    const step = baseStep({
      kind: "aiAgent",
      modelRef: "x",
      messages: [],
      tools: [],
      maxIterations: 10,
    });
    const { container } = render(
      <AiAgentStepCardBody step={step} allSteps={[]} onChange={onChange} />,
    );
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ maxIterations: 7 });
  });
});

// ── EventPublishStepCardBody (#1260 Phase 2 sub-section B) ───────────────
describe("EventPublishStepCardBody", () => {
  it("topic input と payload textarea が描画される", () => {
    const step = baseStep({
      kind: "eventPublish",
      topic: "order.placed",
      payload: "@input.order",
    });
    const { container } = render(
      <EventPublishStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("topic");
    expect(container.textContent).toContain("payload");
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("order.placed");
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe("@input.order");
  });

  it("topic 変更で onChange が呼ばれる", () => {
    const onChange = vi.fn();
    const step = baseStep({ kind: "eventPublish", topic: "", payload: undefined });
    const { container } = render(
      <EventPublishStepCardBody step={step} allSteps={[]} onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "payment.completed" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ topic: "payment.completed" }));
  });
});

// ── EventSubscribeStepCardBody (#1260 Phase 2 sub-section B) ────────────
describe("EventSubscribeStepCardBody", () => {
  it("topic input と filter textarea が描画される", () => {
    const step = baseStep({
      kind: "eventSubscribe",
      topic: "order.placed",
      filter: "@event.amount > 1000",
    });
    const { container } = render(
      <EventSubscribeStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("topic");
    expect(container.textContent).toContain("filter");
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("order.placed");
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe("@event.amount > 1000");
  });

  it("topic 変更で onChange が呼ばれる", () => {
    const onChange = vi.fn();
    const step = baseStep({ kind: "eventSubscribe", topic: "", filter: undefined });
    const { container } = render(
      <EventSubscribeStepCardBody step={step} allSteps={[]} onChange={onChange} />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "inventory.low" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ topic: "inventory.low" }));
  });
});

// ── ExternalSystemStepCardBody auth セクション (#1260 Phase 2 sub-section B) ──
describe("ExternalSystemStepCardBody auth section", () => {
  it("auth.kind select が描画される (workspace prop あり)", () => {
    const step = baseStep({
      kind: "externalSystem",
      systemRef: "stripe",
      auth: { kind: "bearer", tokenRef: "@secret.stripeKey" },
    });
    const { container } = render(
      <ExternalSystemStepCardBody step={step} allSteps={[]} onChange={noop} workspace={undefined} />,
    );
    expect(container.textContent).toContain("認証");
    const selects = container.querySelectorAll("select");
    // auth.kind select が存在する (他に retryPolicy backoff select がある場合もあり)
    const authSelect = Array.from(selects).find(
      (s) => (s as HTMLSelectElement).value === "bearer",
    ) as HTMLSelectElement | undefined;
    expect(authSelect).not.toBeUndefined();
    expect(authSelect!.value).toBe("bearer");
  });

  it("auth.tokenRef input が描画される", () => {
    const step = baseStep({
      kind: "externalSystem",
      systemRef: "stripe",
      auth: { kind: "apiKey", tokenRef: "@secret.stripeKey" },
    });
    const { container } = render(
      <ExternalSystemStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    const inputs = container.querySelectorAll("input");
    // tokenRef input が存在し値が "@secret.stripeKey" である
    const tokenInput = Array.from(inputs).find(
      (i) => (i as HTMLInputElement).value === "@secret.stripeKey",
    ) as HTMLInputElement | undefined;
    expect(tokenInput).not.toBeUndefined();
  });
});
