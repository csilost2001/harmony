import { describe, it, expect } from "vitest";
import type { Step } from "../types/v3";
import { canIndentStep, canOutdentStep, findStepDeep, indentStep, locateStep, outdentStep } from "./stepTree";

const s = (id: string, subSteps?: Step[]) => ({ id, kind: "compute", description: id, ...(subSteps ? { subSteps } : {}) }) as unknown as Step;
const ids = (list: Step[]): unknown => list.map((x) => (x.subSteps?.length ? { [x.id]: ids(x.subSteps) } : x.id));

describe("stepTree", () => {
  it("id で探す (入れ子の中も)", () => {
    const steps = [s("a"), s("b", [s("b1", [s("b11")])])];
    expect(locateStep(steps, "b11")?.parent?.id).toBe("b1");
    expect(locateStep(steps, "zz")).toBeNull();
  });

  it("インデント: 直前の兄弟の配下の末尾へ。最初の工程はできない", () => {
    const steps = [s("a", [s("a1")]), s("b"), s("c")];
    expect(canIndentStep(steps, "a")).toBe(false);
    expect(indentStep(steps, "a")).toBe(false);
    expect(indentStep(steps, "b")).toBe(true);
    expect(ids(steps)).toEqual([{ a: ["a1", "b"] }, "c"]);
    // 入れ子の中でも、その兄弟に対して
    expect(indentStep(steps, "b")).toBe(true);
    expect(ids(steps)).toEqual([{ a: [{ a1: ["b"] }] }, "c"]);
  });

  it("アウトデント: 親の次の位置へ。後ろの兄弟は自分の配下に引き継ぐ。空になった subSteps は消す", () => {
    const steps = [s("a", [s("a1"), s("a2"), s("a3")]), s("z")];
    expect(canOutdentStep(steps, "a")).toBe(false);
    expect(outdentStep(steps, "a2")).toBe(true);
    expect(ids(steps)).toEqual([{ a: ["a1"] }, { a2: ["a3"] }, "z"]);
    expect(outdentStep(steps, "a1")).toBe(true);
    expect(steps[0].subSteps).toBeUndefined();
    expect(ids(steps)).toEqual(["a", "a1", { a2: ["a3"] }, "z"]);
  });

  it("インデント → アウトデントで元の並びに戻る (後ろに兄弟がいなければ)", () => {
    const steps = [s("a"), s("b")];
    indentStep(steps, "b");
    outdentStep(steps, "b");
    expect(ids(steps)).toEqual(["a", "b"]);
  });
});

describe("findStepDeep", () => {
  it("分岐の枝・繰り返しの本体・TX・subSteps の中も探せる", () => {
    const deep = s("deep");
    const steps = [
      { id: "b", kind: "branch", branches: [{ steps: [{ id: "x", kind: "loop", steps: [{ id: "t", kind: "transactionScope", steps: [], onCommit: [deep] }] }] }] },
      s("c", [s("c1")]),
    ] as unknown as Step[];
    expect(findStepDeep(steps, "deep")?.id).toBe("deep");
    expect(findStepDeep(steps, "c1")?.id).toBe("c1");
    expect(findStepDeep(steps, "none")).toBeNull();
  });
});

describe("入れ子の操作は、分岐の枝・繰り返しの本体の中の工程にも使える", () => {
  const branchFlow = () => [{ id: "b", kind: "branch", branches: [{ steps: [s("a1"), s("a2")] }] }] as unknown as Step[];
  const arm = (steps: Step[]) => ((steps[0] as unknown as { branches: Array<{ steps: Step[] }> }).branches[0].steps);

  it("枝の中の 2 番目の工程をインデント → 1 番目の subSteps へ (枝の外へは出ない)", () => {
    const steps = branchFlow();
    expect(canIndentStep(steps, "a2")).toBe(true);
    expect(indentStep(steps, "a2")).toBe(true);
    expect(ids(arm(steps))).toEqual([{ a1: ["a2"] }]);
    expect(steps).toHaveLength(1);
    expect(canIndentStep(steps, "a1")).toBe(false);
  });

  it("枝・繰り返し本体の直下の工程は、アウトデントできない (subSteps の中にいるときだけ)", () => {
    const steps = [...branchFlow(), { id: "l", kind: "loop", steps: [s("l1")] }] as unknown as Step[];
    expect(canOutdentStep(steps, "a1")).toBe(false);
    expect(outdentStep(steps, "a1")).toBe(false);
    expect(canOutdentStep(steps, "l1")).toBe(false);
    expect(outdentStep(steps, "l1")).toBe(false);
  });

  it("枝の中の subSteps の子をアウトデント → 枝の配列の、親の次へ", () => {
    const steps = [{ id: "b", kind: "branch", branches: [{ steps: [s("a1", [s("c1")])] }] }] as unknown as Step[];
    expect(canOutdentStep(steps, "c1")).toBe(true);
    expect(outdentStep(steps, "c1")).toBe(true);
    expect(ids(arm(steps))).toEqual(["a1", "c1"]);
  });

  it("findStepDeep の範囲 (ワークフロー・入力チェックの枝・外部呼び出しの後処理) も、backend と同じ", () => {
    const steps = [
      { id: "wf", kind: "workflow", onApproved: [s("w1")] },
      { id: "v", kind: "validation", inlineBranch: { ok: [s("o1")], ng: [s("n1")] } },
      { id: "x", kind: "externalSystem", errorHandling: { outcomes: { failure: { sideEffects: [s("e1")] } } } },
    ] as unknown as Step[];
    for (const id of ["w1", "o1", "n1", "e1"]) expect(findStepDeep(steps, id)?.id).toBe(id);
  });
});

