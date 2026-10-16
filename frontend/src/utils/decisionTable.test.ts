import { describe, it, expect } from "vitest";
import type { FlowStep } from "@harmony/shared";
import { buildDecisionTables } from "./decisionTable";

const st = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "compute", ...extra }) as unknown as FlowStep;
const expr = (e: string) => ({ kind: "expression", expression: e });

describe("buildDecisionTables (続編 第 8 弾 #149)", () => {
  const steps = [
    st("b1", { kind: "branch", description: "在庫の確認", branches: [
      { code: "A", label: "在庫あり", condition: expr("@stock > 0"), steps: [st("a1", { description: "出荷する" })] },
      { code: "B", label: "在庫ほぼなし", condition: expr("@stock>0"), steps: [] },
    ] }),
    st("b2", { kind: "branch", description: "決済", branches: [{ code: "A", condition: expr("@pay == 'card'"), steps: [st("c1")] }], elseBranch: { code: "Z", steps: [st("c2", { description: "エラー" })] } }),
    st("loop", { kind: "loop", steps: [st("b3", { kind: "branch", branches: [{ code: "A", condition: expr(""), steps: [st("x")] }] })] }),
  ];
  const t = buildDecisionTables(steps);
  it("入れ子の中も含め、分岐の工程ごとに表を作る", () => {
    expect(t.map((x) => x.stepId)).toEqual(["b1", "b2", "b3"]);
    expect(t[0].arms.map((a) => a.code)).toEqual(["A", "B"]);
    expect(t[0].arms[0]).toMatchObject({ condition: "@stock > 0", stepCount: 1, isElse: false });
    expect(t[0].arms[0].firstStep).toContain("出荷する");
    expect(t[1].arms[1]).toMatchObject({ code: "Z", isElse: true, condition: "上記以外" });
  });
  it("抜け・重複・空を指摘する", () => {
    expect(t[0].issues.join("\n")).toContain("「上記以外」の枝がありません");
    expect(t[0].issues.join("\n")).toContain("A と B は、同じ条件");
    expect(t[0].issues.join("\n")).toContain("枝 B の中に工程がありません");
    expect(t[2].issues.join("\n")).toContain("枝 A の条件が空です");
  });
  it("問題の無い分岐は、指摘が空", () => { expect(t[1].issues).toEqual([]); });
  it("分岐が無ければ空", () => { expect(buildDecisionTables([st("x")])).toEqual([]); });
});
