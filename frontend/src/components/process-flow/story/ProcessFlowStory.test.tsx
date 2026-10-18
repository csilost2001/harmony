import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx = { tableName: (id: string) => ({ order: "注文" }[id]), screenName: () => undefined };

function action(): ActionDefinition {
  return ({
    id: "a1", name: "試験", trigger: "submit",
    responses: [{ id: "200-ok", status: 200, description: "完了" }, { id: "404-nf", status: 404, description: "取引先なし" }],
    steps: [
      { id: "s1", kind: "dbAccess", heading: "取引先を確かめる", description: "取引先を取得する", tableId: "order", operation: "SELECT", sql: "SELECT id FROM t WHERE id = @inputs.id", outputBinding: { name: "customer", label: "取引先" } },
      {
        id: "s2", kind: "branch", description: "無ければ返す",
        branches: [{ id: "b1", code: "A", label: "無い", condition: { kind: "expression", expression: "@customer == null" }, steps: [{ id: "r1", kind: "return", description: "404 を返す", responseId: "404-nf" }] }],
        elseBranch: { id: "e1", code: "B", label: "ある", steps: [] },
      },
      {
        id: "s3", heading: "確定する", kind: "loop", description: "明細ごとに登録する", loopKind: "collection", collectionSource: "@inputs.lines", collectionItemName: "line", collectionItemLabel: "明細の行",
        steps: [{ id: "s3a", kind: "compute", description: "金額を足す", expression: "@line.qty", outputBinding: { name: "total", label: "合計" } }],
      },
      { id: "s4", kind: "return", description: "完了を返す", responseId: "200-ok" },
    ] as unknown as ActionDefinition["steps"],
  }) as unknown as ActionDefinition;
}

function setup(extra: Partial<Parameters<typeof ProcessFlowStory>[0]> = {}) {
  const onSelectStep = vi.fn();
  const onOpenStep = vi.fn();
  const utils = render(
    <ProcessFlowStory action={action()} reviewKey="t:a1" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={onSelectStep} onOpenStep={onOpenStep} {...extra} />,
  );
  return { ...utils, onSelectStep, onOpenStep };
}

describe("ProcessFlowStory (流れの表示)", () => {
  beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => cleanup());

  it("見出しで区切り、入れ子・ガード・繰り返しを見せる", () => {
    setup();
    expect(screen.getAllByTestId("pfs-section")).toHaveLength(2);
    expect(screen.getByText("取引先を確かめる")).toBeInTheDocument();
    expect(screen.getByText("確定する")).toBeInTheDocument();
    // ガード: 条件が言葉で、返す内容が 1 行
    const guard = screen.getByTestId("pfs-guard");
    expect(within(guard).getByText("取引先")).toBeInTheDocument();
    expect(guard).toHaveTextContent("が ない");
    expect(guard).toHaveTextContent("404");
    // 繰り返しの中の工程も出る
    expect(screen.getByText("金額を足す")).toBeInTheDocument();
  });

  it("概要では入れ子を畳み、実装では SQL を出す", () => {
    setup();
    fireEvent.click(screen.getByTestId("pfs-zoom-impl"));
    expect(screen.getByText(/SELECT id FROM t/)).toBeInTheDocument();
    expect(screen.getByTestId("process-flow-story").className).toContain("pfs-z-impl");
    fireEvent.click(screen.getByTestId("pfs-zoom-overview"));
    expect(screen.getByTestId("process-flow-story").className).toContain("pfs-z-overview");
    expect(localStorage.getItem("harmony.processFlow.storyZoom")).toBe("overview");
  });

  it("出口: すべての「返す」を、状態コードと道すじつきで並べ、クリックで流れへ戻る", () => {
    setup();
    fireEvent.click(screen.getByTestId("pfs-tab-exits"));
    const exits = screen.getAllByTestId("pfs-exit");
    expect(exits).toHaveLength(2);
    expect(exits[0]).toHaveTextContent("200");
    expect(exits[1]).toHaveTextContent("404");
    expect(exits[1]).toHaveTextContent("取引先 が ない");
    fireEvent.click(exits[1]);
    expect(screen.getByTestId("pfs-tab-flow")).toHaveAttribute("aria-selected", "true");
  });

  it("変数: 一覧から選ぶと、作る場所・使う場所を示す帯が出る", () => {
    setup();
    fireEvent.click(screen.getByTestId("pfs-tab-vars"));
    const rows = screen.getAllByTestId("pfs-var-row");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(rows.find((r) => r.textContent?.includes("customer"))!);
    const bar = screen.getByTestId("pfs-varbar");
    expect(bar).toHaveTextContent("取引先");
    expect(bar).toHaveTextContent("作る 1 か所");
    expect(bar).toHaveTextContent("使う 1 か所");
    fireEvent.click(within(bar).getByText("解除"));
    expect(screen.queryByTestId("pfs-varbar")).toBeNull();
  });

  it("確認済み: 付けると進み具合が増え、ブラウザに残る。工程が変わると外れた扱いになる", () => {
    const { unmount } = setup();
    expect(screen.getByTestId("pfs-progress-text")).toHaveTextContent("確認済み 0 /");
    fireEvent.click(screen.getAllByTestId("pfs-check")[0]);
    expect(screen.getByTestId("pfs-progress-text")).toHaveTextContent("確認済み 1 /");
    unmount();
    // 開き直しても残る
    setup();
    expect(screen.getByTestId("pfs-progress-text")).toHaveTextContent("確認済み 1 /");
    cleanup();
    // 工程の内容が変わると、印は外れる
    const a = action();
    (a.steps[0] as unknown as { description: string }).description = "変えた説明";
    render(<ProcessFlowStory action={a} reviewKey="t:a1" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} />);
    expect(screen.getByTestId("pfs-progress-text")).toHaveTextContent("確認済み 0 /");
    expect(screen.getByText("変更あり")).toBeInTheDocument();
  });

  it("行のクリックで選択、ダブルクリック / 開くボタンで、カードで開く", () => {
    const { onSelectStep, onOpenStep } = setup();
    const row = screen.getAllByTestId("pfs-row")[0];
    fireEvent.click(row);
    expect(onSelectStep).toHaveBeenCalledWith("s1");
    fireEvent.doubleClick(row);
    expect(onOpenStep).toHaveBeenCalledWith("s1");
    fireEvent.click(within(row).getByLabelText("カードで開く"));
    expect(onOpenStep).toHaveBeenCalledTimes(2);
  });

  it("見出しの帯で畳める", () => {
    setup();
    const header = screen.getByRole("button", { name: /確定する/ });
    fireEvent.click(header);
    expect(screen.queryByText("金額を足す")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText("金額を足す")).toBeInTheDocument();
  });

  it("工程が無いときは案内を出す", () => {
    const a = action();
    a.steps = [];
    render(<ProcessFlowStory action={a} reviewKey="t:empty" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} />);
    expect(screen.getByText(/工程がありません/)).toBeInTheDocument();
  });

  it("実行条件 (runIf) は、ガード・繰り返しの枠・次の行へ にも出る", () => {
    const a = action();
    (a.steps[1] as unknown as { runIf: string }).runIf = "@customer != null";
    (a.steps[2] as unknown as { runIf: string }).runIf = "@inputs.lines.length > 0";
    render(<ProcessFlowStory action={a} reviewKey="t:runif" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} />);
    expect(within(screen.getByTestId("pfs-guard")).getByText(/のときだけ/)).toBeInTheDocument();
    expect(screen.getAllByText(/のときだけ/).length).toBeGreaterThanOrEqual(2);
  });

  it("この処理の中で作られない値 (入力・規約) は、変数のボタンにしない", () => {
    const a = action();
    (a.steps[1] as unknown as { branches: Array<{ condition: unknown }> }).branches[0].condition = { kind: "expression", expression: "@inputs.n > @conv.limit.max" };
    render(<ProcessFlowStory action={a} reviewKey="t:plain" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} />);
    const guard = screen.getByTestId("pfs-guard");
    expect(within(guard).queryAllByRole("button")).toHaveLength(2); // 確認済み・カードで開く だけ
    expect(guard).toHaveTextContent("conv.limit.max");
  });

  it("行にフォーカスして Enter で選び、Shift+Enter でカードで開く", () => {
    const { onSelectStep, onOpenStep } = setup();
    const row = screen.getAllByTestId("pfs-row")[0];
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelectStep).toHaveBeenCalledWith("s1");
    fireEvent.keyDown(row, { key: "Enter", shiftKey: true });
    expect(onOpenStep).toHaveBeenCalledWith("s1");
  });

  it("タブは、左右の矢印キーで移れる", () => {
    setup();
    fireEvent.keyDown(screen.getByTestId("pfs-tab-flow"), { key: "ArrowRight" });
    expect(screen.getByTestId("pfs-tab-exits")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("概要で、出口をクリックすると、詳細に切り替わって、その行へ移る", () => {
    setup();
    fireEvent.click(screen.getByTestId("pfs-zoom-overview"));
    fireEvent.click(screen.getByTestId("pfs-tab-exits"));
    fireEvent.click(screen.getAllByTestId("pfs-exit")[0]);
    expect(screen.getByTestId("process-flow-story").className).toContain("pfs-z-detail");
  });

  it("変数の「次」を続けて押すと、場所が順に進む (戻らない)", async () => {
    const hits: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) { hits.push(this.getAttribute("data-step-id") ?? ""); });
    setup();
    fireEvent.click(screen.getByTestId("pfs-tab-vars"));
    fireEvent.click(screen.getAllByTestId("pfs-var-row").find((r) => r.textContent?.includes("line"))!);
    await waitFor(() => expect(hits.length).toBeGreaterThanOrEqual(1));
    const before = hits.length;
    fireEvent.click(screen.getByLabelText("次の場所へ"));
    await waitFor(() => expect(hits.length).toBe(before + 1));
    const first = hits[before];
    fireEvent.click(screen.getByLabelText("次の場所へ"));
    await waitFor(() => expect(hits.length).toBe(before + 2));
    expect(hits[before + 1]).not.toBe(first);
  });
});
