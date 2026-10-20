import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActionDefinition } from "../../../types/v3";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";
import { countSteps, asLooseList } from "./storyModel";
import { ProcessFlowStory } from "./ProcessFlowStory";

const flowCtx = { tableName: () => undefined, screenName: () => undefined };

/** 約 300 工程の大きな流れ (判定・繰り返し・ガード・DB・計算が入る) */
function big(): ActionDefinition {
  const steps: unknown[] = [];
  let n = 0;
  const id = () => `step-${String(++n).padStart(4, "0")}`;
  for (let i = 0; i < 20; i++) {
    steps.push({ id: id(), kind: "dbAccess", heading: i % 4 === 0 ? `区切り ${i}` : undefined, description: `取得 ${i}`, tableId: "t", operation: "SELECT", sql: `SELECT id, name FROM t${i} WHERE id = @inputs.k`, outputBinding: { name: `row${i}`, label: `行${i}` } });
    steps.push({ id: id(), kind: "branch", description: "無ければ返す", branches: [{ id: `br-${i}a`, code: "A", condition: { kind: "expression", expression: `@row${i} == null` }, steps: [{ id: id(), kind: "return", description: "404", responseId: "404-nf" }] }], elseBranch: { id: `br-${i}b`, code: "B", steps: [] } });
    steps.push({
      id: id(), kind: "branch", description: "区分で分ける",
      branches: [0, 1, 2].map((k) => ({ id: `br-${i}-${k}`, code: "ABC"[k], condition: { kind: "expression", expression: `@inputs.t == 'x${k}' && @inputs.amount > ${k * 100} || @inputs.vip == true` }, steps: [{ id: id(), kind: "compute", description: `計算 ${k}`, expression: "1+1", outputBinding: { name: `c${i}${k}` } }, { id: id(), kind: "log", description: "記録" }] })),
      elseBranch: { id: `br-${i}-e`, code: "X", steps: [{ id: id(), kind: "log", description: "その他" }] },
    });
    steps.push({ id: id(), kind: "loop", description: `明細 ${i}`, loopKind: "collection", collectionSource: "@inputs.lines", collectionItemName: `line${i}`, steps: Array.from({ length: 5 }, (_, k) => ({ id: id(), kind: "compute", description: `行の計算 ${k}`, expression: `@line${i}.q * ${k}`, outputBinding: { name: `s${i}${k}`, operation: "accumulate", initialValue: 0 } })) });
    steps.push({ id: id(), kind: "validation", description: "確かめる", fieldErrorsVar: `fe${i}`, rules: [{ field: "a", type: "required" }, { field: "b", type: "maxLength", length: 10 }] });
  }
  return ({ id: "a1", name: "大きな流れ", trigger: "submit", inputs: [{ name: "k", type: "integer" }, { name: "t", type: "string" }, { name: "amount", type: "integer" }, { name: "vip", type: "boolean" }, { name: "lines", type: { kind: "array", itemType: "string" } }], responses: [{ id: "404-nf", status: 404, description: "なし" }], steps }) as unknown as ActionDefinition;
}

function Harness({ editable }: { editable: boolean }) {
  const [action, setAction] = useState(big());
  return (
    <ProcessFlowStory action={action} reviewKey="t:perf" ctx={flowCtx} selectedStepIds={new Set()} onSelectStep={vi.fn()} onOpenStep={vi.fn()} editable={editable}
      onMutate={(fn) => setAction((cur) => { const next = structuredClone(cur); fn(next); return next; })}
      flowIds={() => collectAllProcessFlowLocalIds({ actions: [action] })} tables={[]} />
  );
}

describe("流れ: 大きな流れ (約 300 工程) の描画", () => {
  beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => cleanup());

  it("読む表示と編集中の表示が、数秒以内に出て、1 回の操作の描き直しも遅くない", () => {
    const total = countSteps(asLooseList(big().steps));
    expect(total).toBeGreaterThanOrEqual(300);
    const t0 = performance.now();
    render(<Harness editable={false} />);
    const readMs = performance.now() - t0;
    expect(screen.getAllByTestId("pfs-section").length).toBeGreaterThan(1);
    cleanup();

    const t1 = performance.now();
    render(<Harness editable />);
    const editMs = performance.now() - t1;
    const t2 = performance.now();
    fireEvent.click(screen.getAllByTestId("pfs-down")[0]);
    const opMs = performance.now() - t2;
    // jsdom は実ブラウザより遅い。数秒を超えるなら、描画の作りに問題がある (目安であり、実機の速度ではない)
    console.info(`[perf] ${total} 工程: 読む ${readMs.toFixed(0)}ms / 編集 ${editMs.toFixed(0)}ms / 1 操作 ${opMs.toFixed(0)}ms`);
    expect(readMs).toBeLessThan(8000);
    expect(editMs).toBeLessThan(10000);
    expect(opMs).toBeLessThan(5000);
  }, 40000);
});
