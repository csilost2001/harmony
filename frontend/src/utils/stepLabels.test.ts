import { describe, it, expect } from "vitest";
import type { Step } from "../types/v3";
import { buildStepLabelMap, getStepLabel } from "./actionUtils";

const s = (id: string, subSteps?: Step[]) => ({ id, kind: "compute", description: id, ...(subSteps ? { subSteps } : {}) }) as unknown as Step;

describe("工程の番号 (設計書の処理記述表と同じ規則)", () => {
  it("配下の工程は <親>-S-n。繰り返しなどの本体の番号 (1-1) とは混ざらない", () => {
    const map = buildStepLabelMap([s("a", [s("a1", [s("a11")]), s("a2")]), s("b")]);
    expect([...map.entries()]).toEqual([["a", "1"], ["a1", "1-S-1"], ["a11", "1-S-1-S-1"], ["a2", "1-S-2"], ["b", "2"]]);
    expect(getStepLabel(0, 1)).toBe("1-S-2");
  });
});
