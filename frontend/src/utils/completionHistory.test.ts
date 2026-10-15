import { describe, it, expect, beforeEach } from "vitest";
import { recordCompletionPick, applyCompletionHistory, historyScore } from "./completionHistory";

const cands = [{ value: "a" }, { value: "b" }, { value: "c" }];

describe("completionHistory", () => {
  beforeEach(() => localStorage.clear());

  it("履歴が無ければ元の順のまま", () => {
    expect(applyCompletionHistory("r", cands, () => 0).map((c) => c.value)).toEqual(["a", "b", "c"]);
  });

  it("選んだ回数が多い候補が、同じ一致の強さの中で上に来る", () => {
    recordCompletionPick("r", "c");
    recordCompletionPick("r", "c");
    recordCompletionPick("r", "b");
    expect(applyCompletionHistory("r", cands, () => 0).map((c) => c.value)).toEqual(["c", "b", "a"]);
  });

  it("一致の強さの順は履歴で崩さない", () => {
    recordCompletionPick("r", "c");
    const rank = (c: { value: string }) => (c.value === "a" ? 0 : 1);
    expect(applyCompletionHistory("r", cands, rank).map((c) => c.value)).toEqual(["a", "c", "b"]);
  });

  it("別の補完の履歴は混ざらない / 古い履歴は直近の加点が無い", () => {
    recordCompletionPick("other", "c");
    expect(applyCompletionHistory("r", cands, () => 0).map((c) => c.value)).toEqual(["a", "b", "c"]);
    expect(historyScore({ n: 2, t: 0 }, 10 * 24 * 3600 * 1000)).toBe(2);
    expect(historyScore({ n: 2, t: 1000 }, 2000)).toBe(5);
  });

  it("壊れた保存値でも落ちない", () => {
    localStorage.setItem("harmony.completionHistory", "{oops");
    expect(applyCompletionHistory("r", cands, () => 0)).toHaveLength(3);
    recordCompletionPick("r", "a");
  });
});
