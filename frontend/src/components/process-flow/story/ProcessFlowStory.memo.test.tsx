/**
 * 「流れ」: 1 つの操作で、変わっていない行は描き直さない (React.memo)。
 * 操作のたびにアクション全体が複製されるので、前と同じ内容の部分を前の参照に戻して、行が変わっていないことを見分ける (storyShare.ts)。
 * 行の印を作る stepChips の呼び出し回数で数える (描き直された行の数にほぼ等しい)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import type { ValidationError } from "../../../utils/actionValidation";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("./storyModel", async (orig) => {
  const actual = await orig<typeof import("./storyModel")>();
  return { ...actual, stepChips: (...a: Parameters<typeof actual.stepChips>) => { calls.n++; return actual.stepChips(...a); } };
});
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx: { tableName: (id: string) => string | undefined; screenName: (id: string) => string | undefined } = { tableName: () => undefined, screenName: () => undefined };
const NO_TABLES: never[] = [];

function flat(n: number): ActionDefinition {
  const steps = Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, kind: "compute", description: `計算 ${i}`, expression: `${i}`, outputBinding: { name: `v${i}` } }));
  // 入れ子 (判定の道の中・繰り返しの中) も入れる
  steps.push({ id: "br", kind: "branch", description: "分ける", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "@v1 == 1" }, steps: [{ id: "in-1", kind: "compute", description: "中", expression: "1" }] }] } as never);
  steps.push({ id: "lp", kind: "loop", description: "繰り返す", loopKind: "collection", collectionSource: "@inputs.xs", collectionItemName: "x", steps: [{ id: "in-2", kind: "compute", description: "中 2", expression: "2" }] } as never);
  return ({ id: "a1", name: "x", trigger: "submit", inputs: [{ name: "xs", type: { kind: "array", itemType: "string" } }], responses: [], steps }) as unknown as ActionDefinition;
}

/** 本番の親 (CanvasPane) と同じに、編集のたびに ambient・externalSystems・問題の一覧を作り直して渡す */
function Harness({ ctx = flowCtx, problems, selected = new Set<string>() }: { ctx?: typeof flowCtx; problems?: ValidationError[]; selected?: ReadonlySet<string> }) {
  const [action, setAction] = useState(flat(60));
  return (
    <ProcessFlowStory action={action} reviewKey="t:memo" ctx={ctx} selectedStepIds={selected} onSelectStep={vi.fn()} onOpenStep={vi.fn()} editable
      onMutate={(fn) => setAction((cur) => { const next = structuredClone(cur); fn(next); return next; })}
      flowIds={() => collectAllProcessFlowLocalIds({ actions: [action] })} tables={NO_TABLES}
      ambient={[{ name: "session.user", label: "ログイン中の人" }]} externalSystems={Object.keys({ pay: 1 })} problems={problems} />
  );
}

describe("流れ: 変わっていない行は描き直さない", () => {
  beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => cleanup());

  it("1 つの工程を 1 つ下へ動かしても、描き直されるのは、動いた工程だけ (全工程の描き直しにならない)", () => {
    render(<Harness />);
    const rows = screen.getAllByTestId("pfs-row").length;
    expect(rows).toBeGreaterThan(60);
    calls.n = 0;
    fireEvent.click(screen.getAllByTestId("pfs-down")[10]);
    // 入れ替わった 2 工程 (番号が変わる) とその中身。60 工程すべてではない
    expect(calls.n).toBeGreaterThan(0);
    expect(calls.n).toBeLessThan(12);
  });

  it("親が毎回作り直して渡す物 (ambient・接続先・選択・問題の一覧) でも、内容が同じなら、全工程の描き直しにならない", () => {
    const { rerender } = render(<Harness problems={[]} selected={new Set()} />);
    calls.n = 0;
    rerender(<Harness problems={[]} selected={new Set()} />);
    expect(calls.n).toBe(0);
    calls.n = 0;
    fireEvent.click(screen.getAllByTestId("pfs-down")[10]);
    expect(calls.n).toBeLessThan(12);
  });

  it("古い表示が残らない: 選択・問題・呼び名・テーブル名・確認済みが変わると、その行の表示が変わる", () => {
    const err = (stepId: string): ValidationError => ({ stepId, severity: "error", message: "試験の指摘", path: "" } as unknown as ValidationError);
    const { rerender } = render(<Harness />);
    const row = (id: string) => screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === id)!;
    expect(row("s-3").className).not.toContain("is-selected");
    rerender(<Harness selected={new Set(["s-3"])} problems={[err("s-3")]} />);
    expect(row("s-3").className).toContain("is-selected");
    expect(row("s-3").querySelector("[data-testid='pfs-problem']")).not.toBeNull();
    expect(row("s-4").className).not.toContain("is-selected");
    rerender(<Harness selected={new Set()} problems={[]} />);
    expect(row("s-3").className).not.toContain("is-selected");
    expect(row("s-3").querySelector("[data-testid='pfs-problem']")).toBeNull();
    // 確認済み
    const check = row("s-7").querySelector<HTMLElement>("[data-testid='pfs-check']")!;
    expect(check.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(check);
    expect(row("s-7").querySelector("[data-testid='pfs-check']")!.getAttribute("aria-pressed")).toBe("true");
    expect(row("s-8").querySelector("[data-testid='pfs-check']")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("古い表示が残らない: テーブルの名前 (ctx) が変わると、その名前を出す行が変わる", () => {
    const a = flowCtx;
    const b = { tableName: (id: string) => (id === "t1" ? "注文" : undefined), screenName: () => undefined };
    const act = flat(2);
    (act.steps as unknown as Array<Record<string, unknown>>).unshift({ id: "db", kind: "dbAccess", description: "取る", tableId: "t1", operation: "SELECT" });
    function H({ ctx }: { ctx: typeof flowCtx }) { return <ProcessFlowStory action={act} reviewKey="t:ctx" ctx={ctx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} editable={false} tables={NO_TABLES} />; }
    const { rerender } = render(<H ctx={a} />);
    const dbRow = () => screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "db")!;
    expect(dbRow().textContent).toContain("t1");
    rerender(<H ctx={b} />);
    expect(dbRow().textContent).toContain("注文");
  });

  it("工程の説明を直すと、直した行の中身が変わる (描き直しを省いても、古い表示が残らない)", () => {
    render(<Harness />);
    const row = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "s-5")!;
    expect(row.textContent).toContain("計算 5");
    fireEvent.click(row.querySelector("[data-testid='pfs-delete']")!);
    expect(screen.queryAllByTestId("pfs-row").some((r) => r.getAttribute("data-step-id") === "s-5")).toBe(false);
    // 隣の行は、そのまま残り、番号だけが変わる
    const next = screen.getAllByTestId("pfs-row").find((r) => r.getAttribute("data-step-id") === "s-6")!;
    expect(next.querySelector(".pfs-num")?.textContent).toContain("6");
  });
});
