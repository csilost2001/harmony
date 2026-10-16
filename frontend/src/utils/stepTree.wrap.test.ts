import { describe, it, expect } from "vitest";
import type { Step } from "../types/v3";
import { wrapSteps } from "./stepTree";

const st = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "compute", ...extra }) as unknown as Step;
const wrapper = () => ({ id: "w", kind: "transactionScope", steps: [] }) as unknown as Step;

describe("wrapSteps (続編 第 8 弾 #147)", () => {
  it("隣り合う工程を、先頭の位置に入れた入れ物の中へ、元の順で移す", () => {
    const steps = [st("a"), st("b"), st("c"), st("d")];
    expect(wrapSteps(steps, ["c", "b"], wrapper())).toEqual({ ok: true });
    expect(steps.map((s) => s.id)).toEqual(["a", "w", "d"]);
    expect(((steps[1] as unknown as { steps: Step[] }).steps).map((s) => s.id)).toEqual(["b", "c"]);
  });
  it("1 つだけでも囲める / 末尾も囲める", () => {
    const steps = [st("a"), st("b")];
    expect(wrapSteps(steps, ["b"], wrapper()).ok).toBe(true);
    expect(steps.map((s) => s.id)).toEqual(["a", "w"]);
  });
  it("離れた工程は囲めない (steps は変わらない)", () => {
    const steps = [st("a"), st("b"), st("c")];
    const r = wrapSteps(steps, ["a", "c"], wrapper());
    expect(r.ok).toBe(false);
    expect(steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
  it("入れ子の違う工程・存在しない工程・空は囲めない", () => {
    const steps = [st("a", { subSteps: [st("a1")] }), st("b")];
    expect(wrapSteps(steps, ["a1", "b"], wrapper()).ok).toBe(false);
    expect(wrapSteps(steps, ["zzz"], wrapper()).ok).toBe(false);
    expect(wrapSteps(steps, [], wrapper()).ok).toBe(false);
  });
  it("入れ子の中の工程も、その入れ子の中で囲める", () => {
    const steps = [st("a", { subSteps: [st("a1"), st("a2"), st("a3")] })];
    expect(wrapSteps(steps, ["a1", "a2"], wrapper()).ok).toBe(true);
    const subs = (steps[0] as unknown as { subSteps: Step[] }).subSteps;
    expect(subs.map((s) => s.id)).toEqual(["w", "a3"]);
  });
});
