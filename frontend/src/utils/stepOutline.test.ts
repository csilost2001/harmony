import { describe, it, expect } from "vitest";
import type { Step } from "../types/v3";
import { buildStepOutline, filterOutline } from "./stepOutline";
import { normalizeForMatch } from "./textMatch";

const st = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, ...extra }) as unknown as Step;

describe("buildStepOutline", () => {
  const steps = [
    st("s1", "validation", { description: "入力を検査する" }),
    st("s2", "branch", {
      branches: [{ condition: "@inputs.amount > 0", steps: [st("s2a", "dbAccess", { description: "注文を保存" })] }],
      elseBranch: { steps: [st("s2b", "return")] },
    }),
    st("s3", "loop", { steps: [st("s3a", "dbAccess"), st("s3b", "dbAccess", { subSteps: [st("s3b1", "log")] })] }),
  ];
  it("入れ子を、番号 (1 / 2.1 / 3.2.1。分岐・else は通し番号) と深さつきの並びにする", () => {
    const o = buildStepOutline(steps);
    expect(o.map((x) => `${x.number}:${x.id}:${x.depth}`)).toEqual(["1:s1:0", "2:s2:0", "2.1:s2a:1", "2.2:s2b:1", "3:s3:0", "3.1:s3a:1", "3.2:s3b:1", "3.2.1:s3b1:2"]);
  });
  it("分岐の条件・else・繰り返しは、その中の最初の工程に見出しとして付く", () => {
    const o = buildStepOutline(steps);
    expect(o.find((x) => x.id === "s2a")?.group).toBe("分岐 1: @inputs.amount > 0");
    expect(o.find((x) => x.id === "s2b")?.group).toBe("それ以外 (else)");
    expect(o.find((x) => x.id === "s3a")?.group).toBe("繰り返しの中");
    expect(o.find((x) => x.id === "s1")?.group).toBeUndefined();
  });
  it("説明の先頭が、目次の文字になる (長ければ縮める)", () => {
    expect(buildStepOutline(steps)[0].text).toBe("入力を検査する");
    expect(buildStepOutline([st("x", "log", { description: "あ".repeat(60) })])[0].text).toHaveLength(29);
  });
  it("空の並びは空", () => { expect(buildStepOutline([])).toEqual([]); });
});

describe("filterOutline", () => {
  it("番号・種類名・説明で絞り込む", () => {
    const o = buildStepOutline([st("a", "dbAccess", { description: "注文を保存" }), st("b", "log", { description: "ログ" })]);
    expect(filterOutline(o, "保存", normalizeForMatch).map((x) => x.id)).toEqual(["a"]);
    expect(filterOutline(o, "", normalizeForMatch)).toHaveLength(2);
    expect(filterOutline(o, "2", normalizeForMatch).map((x) => x.id)).toEqual(["b"]);
  });
});
