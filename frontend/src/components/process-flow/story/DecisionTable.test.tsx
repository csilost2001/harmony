import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";
import { subscribeToasts, type ToastMessage } from "../../../utils/toast";
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx = { tableName: () => undefined, screenName: () => undefined };

function base(): ActionDefinition {
  return ({
    id: "a1", name: "試験", trigger: "submit",
    inputs: [{ name: "type", label: "種別", type: "string" }, { name: "amount", label: "金額", type: "integer" }, { name: "vip", label: "上得意", type: "boolean" }],
    responses: [{ id: "200-ok", status: 200, description: "完了" }, { id: "422-x", status: 422, description: "不備" }],
    steps: [
      {
        id: "step-01", kind: "branch", description: "区分を決める",
        branches: [
          { id: "br-01", code: "A", condition: { kind: "expression", expression: "@inputs.type == 'corp' && @inputs.amount > 1000000" }, steps: [{ id: "step-02", kind: "log", description: "上長承認へ" }] },
          { id: "br-02", code: "B", condition: { kind: "expression", expression: "@inputs.type == 'corp' && @inputs.amount <= 1000000 || @inputs.vip == true" }, steps: [{ id: "step-03", kind: "log", description: "自動承認" }] },
        ],
        elseBranch: { id: "br-03", code: "X", steps: [{ id: "step-04", kind: "return", description: "不備", responseId: "422-x" }] },
      },
      { id: "step-05", kind: "branch", description: "高額かつ停止", branches: [{ id: "br-04", code: "A", condition: { kind: "expression", expression: "@inputs.amount > 100 && @inputs.vip == false || @inputs.type == 'x'" }, steps: [{ id: "step-06", kind: "return", description: "返す", responseId: "422-x" }] }], elseBranch: { id: "br-05", code: "B", steps: [] } },
    ],
  }) as unknown as ActionDefinition;
}

function Harness({ editable = true }: { editable?: boolean }) {
  const [action, setAction] = useState(base());
  return (
    <>
      <ProcessFlowStory
        action={action} reviewKey="t:dt" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()}
        editable={editable}
        onMutate={(fn) => setAction((cur) => { const next = structuredClone(cur); fn(next); return next; })}
        flowIds={() => collectAllProcessFlowLocalIds({ actions: [action] })}
        tables={[]}
      />
      <pre data-testid="dump">{JSON.stringify(action)}</pre>
    </>
  );
}
const dump = (): ActionDefinition => JSON.parse(screen.getByTestId("dump").textContent ?? "{}") as ActionDefinition;
const armExpr = (stepId: string, armId: string): string => {
  const s = dump().steps.find((x) => x.id === stepId) as unknown as { branches: Array<{ id: string; condition: { expression: string } }> };
  return s.branches.find((b) => b.id === armId)!.condition.expression;
};

describe("判定表", () => {
  beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => cleanup());

  it("閲覧中: 分岐に「判定表で見る」が出て、開くと条件の行 × 道の列の表が出る (直す窓口は無い)", () => {
    render(<Harness editable={false} />);
    const toggle = screen.getAllByTestId("pfs-dt-toggle")[0];
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const dt = screen.getByTestId("pfs-dt");
    // 行は 4 つ (種別=corp / 金額>100万 (と、その反対) / 上得意) → 3 行。道 A, B の 1・2, それ以外
    expect(within(dt).getAllByRole("row")).toHaveLength(1 + 3 + 1);
    expect(within(dt).getAllByRole("columnheader")).toHaveLength(1 + 4);
    expect(within(dt).queryByTestId("pfs-dt-cell")).toBeNull();
    expect(within(dt).getAllByText("○").length).toBeGreaterThan(0);
    expect(within(dt).getAllByText("×").length).toBeGreaterThan(0);
    expect(within(dt).queryByTestId("pfs-dt-add-row")).toBeNull();
  });

  it("「または」を含む道は列に分かれ、そのときの結果の行が出る", () => {
    render(<Harness editable={false} />);
    fireEvent.click(screen.getAllByTestId("pfs-dt-toggle")[0]);
    const dt = screen.getByTestId("pfs-dt");
    expect(within(dt).getByText("B の 1")).toBeInTheDocument();
    expect(within(dt).getByText("B の 2")).toBeInTheDocument();
    expect(within(dt).getByText(/上長承認へ/)).toBeInTheDocument();
    expect(within(dt).getByText(/422 不備/)).toBeInTheDocument();
  });

  it("複合条件のガードにも、判定表が出る", () => {
    render(<Harness editable={false} />);
    const toggles = screen.getAllByTestId("pfs-dt-toggle");
    expect(toggles).toHaveLength(2);
    fireEvent.click(toggles[1]);
    const dts = screen.getAllByTestId("pfs-dt");
    expect(within(dts[0]).getByText(/それ以外/)).toBeInTheDocument();
  });

  it("編集中: マスを押すと ○ → × → － と切り替わり、その道の式だけが変わる", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-dt-toggle")[0]);
    const dt = screen.getByTestId("pfs-dt");
    // 道 A の列の、「上得意」の行 (3 行目) は － (関係しない)
    const rows = within(dt).getAllByRole("row");
    const vipRow = rows.find((r) => within(r).queryByText(/上得意/))!;
    const cells = within(vipRow).getAllByTestId("pfs-dt-cell");
    fireEvent.click(cells[0]);
    expect(armExpr("step-01", "br-01")).toBe("@inputs.type == 'corp' && @inputs.amount > 1000000 && @inputs.vip == true");
    fireEvent.click(within(within(screen.getByTestId("pfs-dt")).getAllByRole("row").find((r) => within(r).queryByText(/上得意/))!).getAllByTestId("pfs-dt-cell")[0]);
    expect(armExpr("step-01", "br-01")).toBe("@inputs.type == 'corp' && @inputs.amount > 1000000 && @inputs.vip != true");
    // 道 B は触っていない
    expect(armExpr("step-01", "br-02")).toBe("@inputs.type == 'corp' && @inputs.amount <= 1000000 || @inputs.vip == true");
  });

  it("見落としの指摘が出る (どの道にも入らない組み合わせ / 隠れる道)", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-dt-toggle")[1]);
    // 2 つ目の分岐は、それ以外があるので、抜けは出ない
    expect(screen.queryByText(/どの道にも入りません/)).toBeNull();
  });

  it("ひな型「条件の組み合わせで分ける」: 道 A・B と「それ以外」が入り、判定表が開く", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-gap-add").at(-1)!);
    fireEvent.click(screen.getByTestId("pfs-template-decision"));
    const added = dump().steps.at(-1) as unknown as { kind: string; branches: unknown[]; elseBranch: unknown };
    expect(added.kind).toBe("branch");
    expect(added.branches).toHaveLength(2);
    expect(added.elseBranch).toBeTruthy();
    expect(screen.getAllByTestId("pfs-dt").length).toBeGreaterThan(0);
  });

  it("条件の行を足して、マスを埋めると、その道の式ができる", () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-gap-add").at(-1)!);
    fireEvent.click(screen.getByTestId("pfs-template-decision"));
    const dt = screen.getAllByTestId("pfs-dt").at(-1)!;
    fireEvent.click(within(dt).getByTestId("pfs-dt-add-row"));
    const pop = screen.getByTestId("pfs-popover");
    // 値の元を「入力」にし、項目 amount・「より大きい」・値 100
    fireEvent.change(within(pop).getByLabelText("値の元"), { target: { value: "@inputs" } });
    fireEvent.change(within(pop).getByLabelText("項目"), { target: { value: "amount" } });
    fireEvent.change(within(pop).getByLabelText("比べ方"), { target: { value: ">" } });
    fireEvent.change(within(pop).getByLabelText("比べる値"), { target: { value: "100" } });
    fireEvent.click(within(pop).getByTestId("pfs-dt-row-apply"));
    const cells = within(screen.getAllByTestId("pfs-dt").at(-1)!).getAllByTestId("pfs-dt-cell");
    fireEvent.click(cells[0]); // 道 A の列 → ○
    fireEvent.click(cells[1]); // 道 B の列 → ○
    fireEvent.click(cells[1]); // 道 B の列 → ×
    const added = dump().steps.at(-1) as unknown as { branches: Array<{ condition: { expression: string } }> };
    expect(added.branches[0].condition.expression).toBe("@inputs.amount > 100");
    expect(added.branches[1].condition.expression).toBe("@inputs.amount <= 100");
  });

  it("「または」の列が、すべて「－」になる操作は断り、「列を外す」で列ごと外せる", () => {
    const toasts: ToastMessage[] = [];
    const off = subscribeToasts((t) => toasts.push(t));
    render(<Harness />);
    fireEvent.click(screen.getAllByTestId("pfs-dt-toggle")[0]);
    const dt = screen.getByTestId("pfs-dt");
    // 道 B の 2 列目は「上得意 == true」だけ。その行のマスを 2 回押して「－」にしようとする (○ → × → －)
    const vipRow = within(dt).getAllByRole("row").find((r) => within(r).queryByText(/上得意/))!;
    const cells = within(vipRow).getAllByTestId("pfs-dt-cell");
    const before = armExpr("step-01", "br-02");
    fireEvent.click(cells[2]); // B の 2 列目: ○ → ×
    fireEvent.click(within(within(screen.getByTestId("pfs-dt")).getAllByRole("row").find((r) => within(r).queryByText(/上得意/))!).getAllByTestId("pfs-dt-cell")[2]); // × → － (断られる)
    expect(toasts.at(-1)?.text).toContain("すべて「－」");
    expect(armExpr("step-01", "br-02")).toBe(before.replace("@inputs.vip == true", "@inputs.vip != true"));
    // × にしても、行の向きは変わらない (マスは × のまま)
    expect(within(within(screen.getByTestId("pfs-dt")).getAllByRole("row").find((r) => within(r).queryByText(/上得意/))!).getAllByTestId("pfs-dt-cell")[2]).toHaveTextContent("×");
    // 列ごと外す
    fireEvent.click(within(screen.getByTestId("pfs-dt")).getAllByTestId("pfs-dt-del-alt")[1]);
    expect(armExpr("step-01", "br-02")).toBe("@inputs.type == 'corp' && @inputs.amount <= 1000000");
    off();
  });
});
