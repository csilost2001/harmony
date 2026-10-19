import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx = { tableName: () => undefined, screenName: () => undefined };

function base(): ActionDefinition {
  return ({
    id: "a1", name: "試験", trigger: "submit",
    inputs: [{ name: "customerId", label: "取引先ID", type: "integer" }, { name: "email", label: "メール", type: "string" }],
    responses: [{ id: "200-ok", status: 200, description: "完了" }, { id: "422-x", status: 422, description: "不備" }],
    steps: [
      { id: "step-01", kind: "validation", description: "入力を確かめる", fieldErrorsVar: "fieldErrors", rules: [
        { field: "customerId", type: "required", severity: "error", message: "必須です" },
        { field: "email", type: "maxLength", length: 50, severity: "msg", lengthRef: undefined, extraKey: "残る" },
      ], inlineBranch: { ok: [], ng: [], ngResponseId: "422-x" } },
      { id: "step-02", kind: "dbAccess", description: "取得", tableId: "t1", operation: "SELECT", sql: "SELECT id, name FROM customers WHERE id = @inputs.customerId", outputBinding: { name: "customer" } },
      { id: "step-03", kind: "workflow", description: "承認", pattern: "approval-sequential", approvers: [{ role: "@conv.role.manager", label: "部長", order: 1 }], onApproved: [], onRejected: [], onTimeout: [] },
      { id: "step-04", kind: "externalSystem", description: "決済", systemRef: "payment", httpCall: { method: "POST", path: "/v1/charges", body: "@var.x" }, timeoutMs: 5000, outputBinding: { name: "pay" } },
    ],
  }) as unknown as ActionDefinition;
}

function Harness() {
  const [action, setAction] = useState(base());
  return (
    <>
      <ProcessFlowStory action={action} reviewKey="t:fe" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} editable
        onMutate={(fn) => setAction((cur) => { const next = structuredClone(cur); fn(next); return next; })}
        flowIds={() => collectAllProcessFlowLocalIds({ actions: [action] })}
        tables={[{ id: "t1", name: "取引先", physicalName: "customers" }]} />
      <pre data-testid="dump">{JSON.stringify(action)}</pre>
    </>
  );
}
const dump = (): { steps: Array<Record<string, unknown>> } => JSON.parse(screen.getByTestId("dump").textContent ?? "{}");
const step = (id: string) => dump().steps.find((s) => s.id === id)!;

describe("流れ: 細かい欄をその場で直す", () => {
  beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => cleanup());

  it("入力チェック: ルールの印から窓が開き、値を直すと、触らない項目は残る", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(/最大 50/));
    const pop = screen.getByTestId("pfs-popover");
    const rules = within(pop).getAllByTestId("pfs-rule");
    expect(rules).toHaveLength(2);
    fireEvent.change(within(rules[1]).getByLabelText("長さ"), { target: { value: "100" } });
    fireEvent.click(within(pop).getByTestId("pfs-rules-apply"));
    const r = (step("step-01").rules as Array<Record<string, unknown>>)[1];
    expect(r.length).toBe(100);
    expect(r.extraKey).toBe("残る");
    expect(r.severity).toBe("msg");
    // 1 つ目は変わらない
    expect((step("step-01").rules as Array<Record<string, unknown>>)[0]).toMatchObject({ field: "customerId", type: "required", message: "必須です" });
  });

  it("入力チェック: ルールを足す・種類を変える・足りない値は決められない", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-edit-rules"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.click(within(pop).getByTestId("pfs-rule-add"));
    const rules = within(pop).getAllByTestId("pfs-rule");
    fireEvent.change(within(rules[2]).getByLabelText("ルールの種類"), { target: { value: "range" } });
    expect(within(pop).getByTestId("pfs-rules-apply")).toBeDisabled();
    expect(pop).toHaveTextContent("最小か最大");
    fireEvent.change(within(rules[2]).getByLabelText("最小"), { target: { value: "1" } });
    fireEvent.change(within(rules[2]).getByLabelText("最大"), { target: { value: "99" } });
    fireEvent.click(within(pop).getByTestId("pfs-rules-apply"));
    expect((step("step-01").rules as Array<Record<string, unknown>>)[2]).toMatchObject({ type: "range", min: 1, max: 99 });
  });

  it("SQL: 直して決めると、sql が変わる (結果の列が出る)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-edit-sql"));
    const pop = screen.getByTestId("pfs-popover");
    expect(pop).toHaveTextContent("結果の列: id, name");
    fireEvent.change(within(pop).getByTestId("pfs-sql"), { target: { value: "SELECT id, name, email FROM customers WHERE id = @inputs.customerId" } });
    expect(pop).toHaveTextContent("結果の列: id, name, email");
    fireEvent.click(within(pop).getByTestId("pfs-sql-apply"));
    expect(String(step("step-02").sql)).toContain("email");
  });

  it("承認者と期限: 承認者を足し、期限を入れる (承認の種類・順番は残る)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("pfs-edit-approvers"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.click(within(pop).getByTestId("pfs-approver-add"));
    const rows = within(pop).getAllByTestId("pfs-approver");
    fireEvent.change(within(rows[1]).getByLabelText("役割"), { target: { value: "@conv.role.director" } });
    fireEvent.change(within(pop).getByLabelText("期限"), { target: { value: "now() + 3d" } });
    fireEvent.click(within(pop).getByTestId("pfs-approvers-apply"));
    const s = step("step-03") as { approvers: Array<Record<string, unknown>>; deadlineExpression: string; pattern: string };
    expect(s.approvers).toHaveLength(2);
    expect(s.approvers[0]).toMatchObject({ role: "@conv.role.manager", label: "部長", order: 1 });
    expect(s.approvers[1].role).toBe("@conv.role.director");
    expect(s.deadlineExpression).toBe("now() + 3d");
    expect(s.pattern).toBe("approval-sequential");
  });

  it("外部システム: 呼び方を直しても、body など触らない項目は残る", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("POST /v1/charges"));
    const pop = screen.getByTestId("pfs-popover");
    fireEvent.change(within(pop).getByLabelText("パス"), { target: { value: "/v2/charges" } });
    fireEvent.change(within(pop).getByLabelText("待つ秒数"), { target: { value: "10" } });
    fireEvent.click(within(pop).getByTestId("pfs-external-apply"));
    const s = step("step-04") as { httpCall: Record<string, unknown>; timeoutMs: number };
    expect(s.httpCall).toMatchObject({ method: "POST", path: "/v2/charges", body: "@var.x" });
    expect(s.timeoutMs).toBe(10000);
  });
});
