import { describe, it, expect } from "vitest";
import { cloneStepsWithNewIds } from "./stepClone";

const collectIds = (n: unknown, out: string[] = []): string[] => {
  if (Array.isArray(n)) n.forEach((x) => collectIds(x, out));
  else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (k === "id" && typeof v === "string") out.push(v); else collectIds(v, out); }
  return out;
};

const steps = [
  { id: "step-01", kind: "branch", branches: [{ id: "br-01", steps: [{ id: "step-02", kind: "log" }] }], elseBranch: { steps: [{ id: "step-03", kind: "log" }] } },
  { id: "step-04", kind: "loop", loop: { steps: [{ id: "step-05", kind: "compute", subSteps: [{ id: "step-06", kind: "log" }] }] }, onFail: { jumpTo: "step-02" } },
];

describe("cloneStepsWithNewIds", () => {
  it("どの深さの id も新しくし、貼り先の既存の ID と重ならない。元は書き換えない", () => {
    const existing = new Set(["step-01", "step-02", "step-03", "step-04", "step-05", "step-06", "br-01"]);
    const before = JSON.stringify(steps);
    const out = cloneStepsWithNewIds(steps, existing);
    expect(JSON.stringify(steps)).toBe(before);
    const ids = collectIds(out);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    for (const id of ids) expect(["step-01", "step-02", "step-03", "step-04", "step-05", "step-06", "br-01"]).not.toContain(id);
    // 分岐は、分岐の接頭辞のまま
    expect(ids.some((i) => i.startsWith("br-"))).toBe(true);
  });

  it("複製のあいだの参照 (ジャンプ先) は新しい ID に追従する。複製の外への参照は、そのまま", () => {
    const out = cloneStepsWithNewIds(steps, new Set(["step-01", "step-02", "step-03", "step-04", "step-05", "step-06", "br-01"])) as typeof steps;
    const newStep02 = (out[0].branches as Array<{ steps: Array<{ id: string }> }>)[0].steps[0].id;
    expect((out[1].onFail as { jumpTo: string }).jumpTo).toBe(newStep02);
    const external = cloneStepsWithNewIds([{ id: "step-09", kind: "jump", jumpTo: "step-77" }], new Set(["step-09"])) as Array<{ jumpTo: string }>;
    expect(external[0].jumpTo).toBe("step-77");
  });

  it("同じ工程を 2 回続けて貼っても、ID は重ならない (貼るたびに、追加した ID を足す)", () => {
    const existing = new Set<string>(["step-01"]);
    const a = collectIds(cloneStepsWithNewIds(steps, existing));
    const b = collectIds(cloneStepsWithNewIds(steps, existing));
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });
});
