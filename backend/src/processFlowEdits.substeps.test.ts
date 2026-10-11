import { describe, it, expect } from "vitest";
import { insertStepAt, type ProcessFlowDoc } from "./processFlowEdits.js";

const doc = (): ProcessFlowDoc => ({
  meta: { id: "f" },
  actions: [{ id: "act-001", name: "a", trigger: "click", steps: [
    { id: "step-01", kind: "compute", description: "親", subSteps: [{ id: "step-02", kind: "log", description: "子" }] },
    { id: "step-03", kind: "compute", description: "次" },
  ] }],
} as unknown as ProcessFlowDoc);

describe("insertStepAt — 親の工程の配下 (subSteps) へ", () => {
  it("親を指定すると、その subSteps の末尾 (または位置) に入る。入れ子の中の親も探す", () => {
    const d = doc();
    insertStepAt(d, "act-001", { id: "step-10", kind: "log", description: "子 2" } as never, undefined, "step-01");
    insertStepAt(d, "act-001", { id: "step-11", kind: "log", description: "先頭" } as never, 0, "step-01");
    insertStepAt(d, "act-001", { id: "step-12", kind: "log", description: "孫" } as never, undefined, "step-02");
    const root = d.actions[0].steps[0];
    expect(root.subSteps?.map((s) => s.id)).toEqual(["step-11", "step-02", "step-10"]);
    expect(root.subSteps?.[1].subSteps?.map((s) => s.id)).toEqual(["step-12"]);
    expect(d.actions[0].steps.map((s) => s.id)).toEqual(["step-01", "step-03"]);
  });

  it("親が見つからなければエラー。親を指定しなければ従来どおりアクション直下", () => {
    const d = doc();
    expect(() => insertStepAt(d, "act-001", { id: "step-10", kind: "log", description: "" } as never, undefined, "step-99")).toThrow(/見つかりません/);
    insertStepAt(d, "act-001", { id: "step-10", kind: "log", description: "" } as never, 1);
    expect(d.actions[0].steps.map((s) => s.id)).toEqual(["step-01", "step-10", "step-03"]);
  });
});
