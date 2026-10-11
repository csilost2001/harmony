import { describe, it, expect } from "vitest";
import { insertStepAt, nestStep, type ProcessFlowDoc } from "./processFlowEdits.js";

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

describe("nestStep — インデント / アウトデント", () => {
  const ids = (list: Array<{ id: string; subSteps?: unknown[] }>): unknown => list.map((x) => (x.subSteps?.length ? { [x.id]: ids(x.subSteps as never) } : x.id));

  it("indent: 直前の兄弟の配下の末尾へ。先頭の工程はエラー", () => {
    const d = doc();
    nestStep(d, "step-03", "indent");
    expect(ids(d.actions[0].steps as never)).toEqual([{ "step-01": ["step-02", "step-03"] }]);
    expect(() => nestStep(d, "step-01", "indent")).toThrow(/先頭/);
  });

  it("outdent: 親の次の位置へ。後ろの兄弟は配下へ引き継ぎ、空になった subSteps は消す。入れ子の外はエラー", () => {
    const d = doc();
    d.actions[0].steps[0].subSteps!.push({ id: "step-04", kind: "log", description: "" } as never);
    nestStep(d, "step-02", "outdent");
    expect(ids(d.actions[0].steps as never)).toEqual([ "step-01", { "step-02": ["step-04"] }, "step-03" ]);
    expect(d.actions[0].steps[0].subSteps).toBeUndefined();
    expect(() => nestStep(d, "step-03", "outdent")).toThrow(/入れ子の中にない/);
  });
});

describe("入れ子の操作は、分岐の枝・繰り返しの本体・外部呼び出しの後処理などの中の工程にも使える (frontend の stepTree.findStepDeep と同じ範囲)", () => {
  const st = (id: string, extra: object = {}) => ({ id, kind: "log", description: id, ...extra });
  const flowOf = (steps: unknown[]): ProcessFlowDoc => ({ meta: { id: "f" }, actions: [{ id: "act-001", name: "a", trigger: "click", steps }] } as unknown as ProcessFlowDoc);
  const ids = (list: Array<{ id: string; subSteps?: unknown[] }>): unknown => list.map((x) => (x.subSteps?.length ? { [x.id]: ids(x.subSteps as never) } : x.id));

  it("分岐の枝の中の 2 番目の工程をインデント → 1 番目の subSteps へ (枝の外へは出ない)。先頭の工程・枝の直下の工程のアウトデントはできない", () => {
    const d = flowOf([st("b", { kind: "branch", branches: [{ id: "br-01", steps: [st("a1"), st("a2")] }] })]);
    nestStep(d, "a2", "indent");
    const arm = (d.actions[0].steps[0].branches as unknown as Array<{ steps: never[] }>)[0].steps;
    expect(ids(arm)).toEqual([{ a1: ["a2"] }]);
    expect(() => nestStep(d, "a1", "indent")).toThrow(/先頭/);
    expect(() => nestStep(d, "a1", "outdent")).toThrow(/入れ子の中にない/); // 枝の直下は、subSteps の中ではない
  });

  it("枝の中の subSteps の子をアウトデント → 枝の配列の、親の次へ", () => {
    const d = flowOf([st("b", { kind: "branch", branches: [{ id: "br-01", steps: [st("a1", { subSteps: [st("c1")] })] }] })]);
    nestStep(d, "c1", "outdent");
    const arm = (d.actions[0].steps[0].branches as unknown as Array<{ steps: never[] }>)[0].steps;
    expect(ids(arm)).toEqual(["a1", "c1"]);
  });

  it("繰り返しの本体・ワークフロー・入力チェックの枝・errorHandling.outcomes の中も探せる", () => {
    const d = flowOf([
      st("loop", { kind: "loop", steps: [st("l1"), st("l2")] }),
      st("wf", { kind: "workflow", onApproved: [st("w1"), st("w2")] }),
      st("v", { kind: "validation", inlineBranch: { ok: [st("o1"), st("o2")], ng: [] } }),
      st("x", { kind: "externalSystem", errorHandling: { outcomes: { failure: { sideEffects: [st("e1"), st("e2")] } } } }),
    ]);
    for (const id of ["l2", "w2", "o2", "e2"]) nestStep(d, id, "indent");
    const [loop, wf, v, x] = d.actions[0].steps as never[] as Array<Record<string, any>>;
    expect(ids(loop.steps)).toEqual([{ l1: ["l2"] }]);
    expect(ids(wf.onApproved)).toEqual([{ w1: ["w2"] }]);
    expect(ids(v.inlineBranch.ok)).toEqual([{ o1: ["o2"] }]);
    expect(ids(x.errorHandling.outcomes.failure.sideEffects)).toEqual([{ e1: ["e2"] }]);
  });
});

