import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AuditStepPanel } from "./AuditStepPanel";
import type { AuditStep } from "../../types/action";

const baseStep: AuditStep = {
  id: "test-step",
  type: "audit",
  description: "",
  action: "order.create",
  maturity: "draft",
};

describe("AuditStepPanel", () => {
  // Must-fix #1 (PR #410 review): resource.type / resource.id の片方だけ入力時は
  // schema 上 type=""/id="X" のような片側空 object になってしまうのを防ぐ
  it("resource.type だけ入力すると resource は undefined のまま", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AuditStepPanel step={baseStep} onChange={onChange} />,
    );
    const typeInput = container.querySelector('[data-field-path="resource.type"] input') as HTMLInputElement;
    fireEvent.change(typeInput, { target: { value: "Order" } });
    expect(onChange).toHaveBeenLastCalledWith({ resource: undefined });
  });

  it("resource.id だけ入力すると resource は undefined のまま", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AuditStepPanel step={baseStep} onChange={onChange} />,
    );
    const idInput = container.querySelector('[data-field-path="resource.id"] input') as HTMLInputElement;
    fireEvent.change(idInput, { target: { value: "@orderId" } });
    expect(onChange).toHaveBeenLastCalledWith({ resource: undefined });
  });

  it("resource.type と resource.id 両方揃った時のみ resource が出力される", () => {
    const onChange = vi.fn();
    const stepWithType: AuditStep = { ...baseStep, resource: { type: "Order", id: "" } };
    const { container } = render(
      <AuditStepPanel step={stepWithType} onChange={onChange} />,
    );
    const idInput = container.querySelector('[data-field-path="resource.id"] input') as HTMLInputElement;
    fireEvent.change(idInput, { target: { value: "@orderId" } });
    expect(onChange).toHaveBeenLastCalledWith({ resource: { type: "Order", id: "@orderId" } });
  });

  it("両方入っている state から id を空にすると resource が undefined", () => {
    const onChange = vi.fn();
    const stepFull: AuditStep = { ...baseStep, resource: { type: "Order", id: "@orderId" } };
    const { container } = render(
      <AuditStepPanel step={stepFull} onChange={onChange} />,
    );
    const idInput = container.querySelector('[data-field-path="resource.id"] input') as HTMLInputElement;
    fireEvent.change(idInput, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ resource: undefined });
  });

  it("空白のみ入力は trim されて空扱い", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AuditStepPanel step={baseStep} onChange={onChange} />,
    );
    const typeInput = container.querySelector('[data-field-path="resource.type"] input') as HTMLInputElement;
    fireEvent.change(typeInput, { target: { value: "   " } });
    expect(onChange).toHaveBeenLastCalledWith({ resource: undefined });
  });
});
