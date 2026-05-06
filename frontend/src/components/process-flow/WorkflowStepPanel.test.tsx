import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { WorkflowStepPanel } from "./WorkflowStepPanel";
import type { Step, WorkflowStep } from "../../types/action";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { WORKFLOW_PATTERN_VALUES } from "../../types/action";

const conventions: ConventionsCatalog = {
  version: "1.0.0",
  role: {
    manager: { name: "上長" },
    financeManager: { name: "経理責任者" },
  },
};

const baseStep: WorkflowStep = {
  id: "workflow-step",
  type: "workflow",
  description: "承認",
  maturity: "draft",
  pattern: "approval-sequential",
  approvers: [],
};

const renderPanel = (step: WorkflowStep, onChange = vi.fn()) => render(
  <WorkflowStepPanel
    step={step}
    allSteps={[step]}
    conventions={conventions}
    onChange={onChange}
  />,
);

const field = (container: HTMLElement, path: string) =>
  container.querySelector(`[data-field-path="${path}"]`) as HTMLElement;

const firstInput = (container: HTMLElement, path: string) =>
  field(container, path).querySelector("input") as HTMLInputElement;

const firstSelect = (container: HTMLElement, path: string) =>
  (field(container, path).matches("select")
    ? field(container, path)
    : field(container, path).querySelector("select")) as HTMLSelectElement;

describe("WorkflowStepPanel", () => {
  it("空文字は escalateTo.role / escalateTo.userExpression / label / deadlineExpression / escalateAfter で undefined に正規化される", () => {
    const onChange = vi.fn();
    const step: WorkflowStep = {
      ...baseStep,
      approvers: [{ role: "manager", label: "上長", order: 1 }],
      deadlineExpression: "@submittedAt + duration('P1D')",
      escalateAfter: "duration('P1D')",
      escalateTo: { role: "financeManager", userExpression: "@approver" },
    };
    const { container } = renderPanel(step, onChange);

    fireEvent.change(firstSelect(container, "escalateTo.role"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ escalateTo: { userExpression: "@approver" } });

    fireEvent.change(firstInput(container, "escalateTo.userExpression"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ escalateTo: { role: "financeManager" } });

    fireEvent.change(firstInput(container, "approvers[0].label"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({
      approvers: [{ role: "manager", label: undefined, order: 1 }],
    });

    fireEvent.change(firstInput(container, "deadlineExpression"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ deadlineExpression: undefined });

    fireEvent.change(firstInput(container, "escalateAfter"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ escalateAfter: undefined });
  });

  it("approver の追加、削除、ロール変更で正しい patch を返す", () => {
    const onChange = vi.fn();
    const { container } = renderPanel(baseStep, onChange);

    fireEvent.click(within(field(container, "approvers")).getByRole("button", { name: /追加/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      approvers: [{ role: "manager", order: 1 }],
    });

    const stepWithApprover: WorkflowStep = {
      ...baseStep,
      approvers: [{ role: "manager", label: "上長", order: 1 }],
    };
    const { container: updated } = renderPanel(stepWithApprover, onChange);
    fireEvent.change(firstSelect(updated, "approvers[0].role"), { target: { value: "financeManager" } });
    expect(onChange).toHaveBeenLastCalledWith({
      approvers: [{ role: "financeManager", label: "上長", order: 1 }],
    });

    fireEvent.click(within(field(updated, "approvers")).getByTitle("削除"));
    expect(onChange).toHaveBeenLastCalledWith({ approvers: [] });
  });

  it("quorum.type の切替で n フィールドが表示 / 非表示になる", () => {
    const onChange = vi.fn();
    const { container, rerender } = renderPanel({ ...baseStep, quorum: { type: "any" } }, onChange);
    expect(field(container, "quorum.n")).toBeNull();

    fireEvent.change(firstSelect(container, "quorum.type"), { target: { value: "n-of-m" } });
    expect(onChange).toHaveBeenLastCalledWith({ quorum: { type: "n-of-m", n: 1 } });

    rerender(
      <WorkflowStepPanel
        step={{ ...baseStep, quorum: { type: "n-of-m", n: 2 } }}
        allSteps={[]}
        conventions={conventions}
        onChange={onChange}
      />,
    );
    expect(field(container, "quorum.n")).not.toBeNull();
    fireEvent.change(firstSelect(container, "quorum.type"), { target: { value: "majority" } });
    expect(onChange).toHaveBeenLastCalledWith({ quorum: { type: "majority" } });
  });

  it("onApproved / onRejected / onTimeout は Step[] として追加・削除できる", () => {
    const onChange = vi.fn();
    const { container } = renderPanel(baseStep, onChange);

    for (const path of ["onApproved", "onRejected", "onTimeout"] as const) {
      const section = field(container, path);
      fireEvent.click(within(section).getByRole("button", { name: /ステップ追加/ }));
      const patch = onChange.mock.lastCall?.[0] as Partial<WorkflowStep>;
      expect(patch[path]).toEqual([
        {
          id: expect.stringMatching(/^workflow-/),
          type: "other",
          description: "",
          maturity: "draft",
        },
      ]);
    }

    const child: Step = {
      id: "child-step",
      type: "other",
      description: "子ステップ",
      maturity: "draft",
    };
    const { container: updated } = renderPanel({ ...baseStep, onApproved: [child] }, onChange);
    fireEvent.click(within(field(updated, "onApproved")).getByTitle("削除"));
    expect(onChange).toHaveBeenLastCalledWith({ onApproved: undefined });
  });

  it("pattern dropdown に 11 種すべての WorkflowPattern が表示される", () => {
    const { container } = renderPanel(baseStep);
    const options = Array.from(firstSelect(container, "pattern").options).map((option) => option.value);
    expect(options).toEqual(WORKFLOW_PATTERN_VALUES);
    expect(options).toHaveLength(11);
  });
});
