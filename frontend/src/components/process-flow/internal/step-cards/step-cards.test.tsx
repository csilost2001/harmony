// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): step-cards/ 配下 15 個の sub-component の最小 rendering test。
//
// 各 sub-component は StepCard.tsx から純粋に抽出されたもの。本テストは
// (1) crash せず render される (2) kind 固有のキー要素が DOM に出る、を確認する。
// 詳細な振る舞いテストは元々 StepCard 系では薄かったため、本 PR では rendering 中心。

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  AuditStepCardBody,
  BranchStepCardBody,
  CommonProcessStepCardBody,
  ComputeStepCardBody,
  DbAccessStepCardBody,
  DisplayUpdateStepCardBody,
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
  it("systemRef / protocol input が描画される", () => {
    const step = baseStep({ kind: "externalSystem", systemRef: "stripe", protocol: "REST" });
    const { container } = render(
      <ExternalSystemStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("接続先");
    expect(container.textContent).toContain("プロトコル");
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
  it("responseRef と bodyExpression input を描画する", () => {
    const step = baseStep({ kind: "return", responseRef: "200-ok" });
    const { container } = render(
      <ReturnStepCardBody step={step} allSteps={[]} onChange={noop} />,
    );
    expect(container.textContent).toContain("responseRef");
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
