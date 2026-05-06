import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { LogStepPanel } from "./LogStepPanel";
import type { LogStep } from "../../types/action";

const baseStep: LogStep = {
  id: "test-step",
  type: "log",
  description: "",
  level: "info",
  message: "test",
  maturity: "draft",
};

const getStructuredRows = (container: HTMLElement) => {
  const wrap = container.querySelector('[data-field-path="structuredData"]');
  return Array.from(wrap?.querySelectorAll<HTMLElement>(".d-flex.align-items-center.gap-1.mb-1") ?? []);
};

describe("LogStepPanel structuredData", () => {
  // Must-fix #2 (PR #410 review): key を全消去しても entry と value が消失しない
  it("既存 entry の key を全消去しても entry が消えず value が保持される", () => {
    const onChange = vi.fn();
    const stepWithData: LogStep = {
      ...baseStep,
      structuredData: { orderId: "@orderId" },
    };
    const { container, rerender } = render(
      <LogStepPanel step={stepWithData} onChange={onChange} />,
    );

    const rows = getStructuredRows(container);
    expect(rows).toHaveLength(1);

    const keyInput = rows[0].querySelector("input") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "" } });

    expect(onChange).toHaveBeenLastCalledWith({ structuredData: undefined });

    rerender(<LogStepPanel step={{ ...stepWithData, structuredData: undefined }} onChange={onChange} />);
    const rowsAfter = getStructuredRows(container);
    expect(rowsAfter).toHaveLength(1);
    const valueInput = rowsAfter[0].querySelectorAll("input")[1] as HTMLInputElement;
    expect(valueInput?.value).toBe("@orderId");
  });

  it("key を再入力すると normalize されて structuredData が再構築される", () => {
    const onChange = vi.fn();
    const stepWithData: LogStep = {
      ...baseStep,
      structuredData: { orderId: "@orderId" },
    };
    const { container, rerender } = render(
      <LogStepPanel step={stepWithData} onChange={onChange} />,
    );

    const keyInput = getStructuredRows(container)[0].querySelector("input") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "" } });
    rerender(<LogStepPanel step={{ ...stepWithData, structuredData: undefined }} onChange={onChange} />);
    fireEvent.change(getStructuredRows(container)[0].querySelector("input") as HTMLInputElement, {
      target: { value: "customerId" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ structuredData: { customerId: "@orderId" } });
  });

  // Should-fix #3 (PR #410 review): 重複 key は is-invalid で警告
  it("同じ key を持つ 2 行があると両方に is-invalid が付与される", () => {
    const onChange = vi.fn();
    const stepWithData: LogStep = {
      ...baseStep,
      structuredData: { orderId: "@orderId" },
    };
    const { container } = render(
      <LogStepPanel step={stepWithData} onChange={onChange} />,
    );

    const addBtn = container.querySelector("button.btn-outline-secondary") as HTMLButtonElement;
    fireEvent.click(addBtn);

    const rows = getStructuredRows(container);
    expect(rows).toHaveLength(2);
    const newKeyInput = rows[1].querySelector("input") as HTMLInputElement;
    fireEvent.change(newKeyInput, { target: { value: "orderId" } });

    const keyInputs = rows.map((r) => r.querySelector("input") as HTMLInputElement);
    expect(keyInputs[0].className).toContain("is-invalid");
    expect(keyInputs[1].className).toContain("is-invalid");
  });

  it("key 全消去 → 値編集 → key 再入力 で value が消えない (in-place edit)", () => {
    const onChange = vi.fn();
    const stepWithData: LogStep = {
      ...baseStep,
      structuredData: { orderId: "@orderId" },
    };
    const { container, rerender } = render(
      <LogStepPanel step={stepWithData} onChange={onChange} />,
    );

    const keyInput = getStructuredRows(container)[0].querySelector("input") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "" } });
    rerender(<LogStepPanel step={{ ...stepWithData, structuredData: undefined }} onChange={onChange} />);

    const valueInput = getStructuredRows(container)[0].querySelectorAll("input")[1] as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "@newValue" } });

    fireEvent.change(getStructuredRows(container)[0].querySelector("input") as HTMLInputElement, {
      target: { value: "customerId" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ structuredData: { customerId: "@newValue" } });
  });
});
