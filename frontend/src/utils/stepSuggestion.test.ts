import { describe, it, expect } from "vitest";
import { buildTransitionStats, suggestNextKinds, findStepKind, forEachStepList, START } from "./stepSuggestion";
import type { ProcessFlow } from "../types/v3";

const flow = (steps: unknown[]) => ({ actions: [{ id: "a", steps }] }) as unknown as ProcessFlow;
const s = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, ...extra });

describe("stepSuggestion", () => {
  it("工程の並びを入れ子まで数える", () => {
    const f = flow([
      s("1", "validation"), s("2", "dbAccess"),
      s("3", "branch", { branches: [{ code: "A", steps: [s("4", "log"), s("5", "return")] }], elseBranch: { steps: [s("6", "log")] } }),
    ]);
    const stats = buildTransitionStats([f]);
    expect(stats.get(START)?.get("validation")).toBe(1);
    expect(stats.get("validation")?.get("dbAccess")).toBe(1);
    expect(stats.get("dbAccess")?.get("branch")).toBe(1);
    expect(stats.get("log")?.get("return")).toBe(1);
    expect(stats.get(START)?.get("log")).toBe(2); // 分岐の中の先頭 2 か所
  });

  it("実績 (2 回以上) を、組み込みの目安より先に出す", () => {
    const flows = [1, 2, 3].map(() => flow([s("1", "dbAccess"), s("2", "externalSystem")]));
    const stats = buildTransitionStats(flows);
    const r = suggestNextKinds(["branch", "compute", "log", "externalSystem", "dbAccess"], "dbAccess", stats);
    expect(r[0]).toEqual({ kind: "externalSystem", count: 3, source: "このワークスペース" });
    expect(r.slice(1).every((x) => x.source === "よくある流れ")).toBe(true);
    expect(r.map((x) => x.kind)).toEqual(["externalSystem", "branch", "compute"]);
  });

  it("実績が 1 回だけなら目安を使う / 選べない種類は出さない / 先頭は START の目安", () => {
    const stats = buildTransitionStats([flow([s("1", "dbAccess"), s("2", "externalSystem")])]);
    expect(suggestNextKinds(["branch", "externalSystem"], "dbAccess", stats).map((x) => x.kind)).toEqual(["branch"]);
    expect(suggestNextKinds(["validation", "dbAccess", "compute", "return"], undefined).map((x) => x.kind)).toEqual(["validation", "dbAccess", "compute"]);
    expect(suggestNextKinds(["return"], "不明な種類")).toEqual([]);
  });

  it("工程 id から種類を探す", () => {
    const f = flow([s("1", "branch", { branches: [{ steps: [s("9", "compute")] }] })]);
    expect(findStepKind(f, "9")).toBe("compute");
    expect(findStepKind(f, "nope")).toBeUndefined();
  });

  it("深すぎる入れ子・循環でも止まる", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 100; i++) { const n: Record<string, unknown> = {}; deep.x = n; deep = n; }
    let calls = 0;
    forEachStepList(root, () => { calls++; });
    expect(calls).toBe(0);
  });
});
