/**
 * 「流れ」: 1 つの操作で、変わっていない行は描き直さない (React.memo)。
 * 操作のたびにアクション全体が複製されるので、前と同じ内容の部分を前の参照に戻して、行が変わっていないことを見分ける (storyShare.ts)。
 * 行の印を作る stepChips の呼び出し回数で数える (描き直された行の数にほぼ等しい)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("./storyModel", async (orig) => {
  const actual = await orig<typeof import("./storyModel")>();
  return { ...actual, stepChips: (...a: Parameters<typeof actual.stepChips>) => { calls.n++; return actual.stepChips(...a); } };
});
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx = { tableName: () => undefined, screenName: () => undefined };
const NO_TABLES: never[] = [];

function flat(n: number): ActionDefinition {
  const steps = Array.from({ length: n }, (_, i) => ({ id: `s-${i}`, kind: "compute", description: `計算 ${i}`, expression: `${i}`, outputBinding: { name: `v${i}` } }));
  // 入れ子 (判定の道の中・繰り返しの中) も入れる
  steps.push({ id: "br", kind: "branch", description: "分ける", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "@v1 == 1" }, steps: [{ id: "in-1", kind: "compute", description: "中", expression: "1" }] }] } as never);
  steps.push({ id: "lp", kind: "loop", description: "繰り返す", loopKind: "collection", collectionSource: "@inputs.xs", collectionItemName: "x", steps: [{ id: "in-2", kind: "compute", description: "中 2", expression: "2" }] } as never);
  return ({ id: "a1", name: "x", trigger: "submit", inputs: [{ name: "xs", type: { kind: "array", itemType: "string" } }], responses: [], steps }) as unknown as ActionDefinition;
}

function Harness() {
  const [action, setAction] = useState(flat(60));
  return (
    <ProcessFlowStory action={action} reviewKey="t:memo" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} editable
      onMutate={(fn) => setAction((cur) => { const next = structuredClone(cur); fn(next); return next; })}
      flowIds={() => collectAllProcessFlowLocalIds({ actions: [action] })} tables={NO_TABLES} />
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
