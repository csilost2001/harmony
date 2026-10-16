import { describe, it, expect } from "vitest";
import { getStepExpandCommand, issueStepExpand, shouldBeOpen } from "./stepExpand";

describe("stepExpand (続編 第 8 弾 #145)", () => {
  it("合図を出すたびに世代が進み、種類が入れ替わる", () => {
    const e0 = getStepExpandCommand().epoch;
    issueStepExpand("expand");
    expect(getStepExpandCommand()).toEqual({ epoch: e0 + 1, mode: "expand" });
    issueStepExpand("expand");
    expect(getStepExpandCommand().epoch).toBe(e0 + 2); // 同じ種類でも、世代が進む (もう一度、開き直す)
    issueStepExpand("attention");
    expect(getStepExpandCommand().mode).toBe("attention");
  });
  it("開くかどうか: すべて開く / すべて畳む / 要確認だけ", () => {
    expect(shouldBeOpen("expand", false)).toBe(true);
    expect(shouldBeOpen("collapse", true)).toBe(false);
    expect(shouldBeOpen("attention", true)).toBe(true);
    expect(shouldBeOpen("attention", false)).toBe(false);
  });
});
