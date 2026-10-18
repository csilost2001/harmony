import { describe, expect, it } from "vitest";
import type { ActionDefinition, Step } from "../../../types/v3";
import { TEMPLATES, buildKind, searchTemplates, uniqueName, type TemplateCtx } from "./storyTemplates";
import { childGroups, asLoose, isGuardBranch } from "./storyModel";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";

const responses = [{ id: "200-ok", status: 200 }, { id: "404-nf", status: 404 }, { id: "422-x", status: 422 }] as unknown as ActionDefinition["responses"];
const ctx = (used: string[] = []): TemplateCtx => ({ ids: new Set(["step-01", "br-01"]), responses, usedVars: new Set(used) });
const get = (key: string) => TEMPLATES.find((t) => t.key === key)!;

describe("uniqueName", () => {
  it("使われていれば、2, 3… を付ける", () => {
    expect(uniqueName("found", new Set())).toBe("found");
    expect(uniqueName("found", new Set(["found", "found2"]))).toBe("found3");
  });
});

describe("ひな型", () => {
  it("ガード: 腕が 1 つで中が「返す」だけの判定 (流れでガードとして出る形)", () => {
    const [g] = get("guard").build(ctx());
    expect(isGuardBranch(asLoose(g))).toBe(true);
    expect(childGroups(asLoose(g))[0].steps[0]).toMatchObject({ kind: "return", responseId: "404-nf" });
  });
  it("1 件取得して、無ければ返す: 取得 + ガード。変数の名前は重ならず、ガードがその変数を見る", () => {
    const [db, guard] = get("lookup").build(ctx(["found"]));
    expect((db as unknown as { outputBinding: { name: string } }).outputBinding.name).toBe("found2");
    const arm = childGroups(asLoose(guard))[0];
    expect((arm.condition as { expression: string }).expression).toBe("@found2 == null");
    expect(arm.steps[0]).toMatchObject({ responseId: "404-nf" });
  });
  it("承認: 承認されたら・却下されたら・期限が切れたら の枠が、最初からある", () => {
    const [w] = get("workflow").build(ctx());
    expect(childGroups(asLoose(w)).map((g) => g.role)).toEqual(["approved", "rejected", "timeout"]);
  });
  it("作った工程の ID は、すべて重ならない (流れ全体で一意)", () => {
    const c = ctx();
    const made: Step[] = [];
    for (const t of TEMPLATES) made.push(...t.build(c));
    const all = collectAllProcessFlowLocalIds({ actions: [{ id: "x", steps: made }] });
    const count = JSON.stringify(made).match(/"id":/g)!.length;
    expect(all.size - 1).toBe(count); // 1 は、アクションの ID
  });
  it("すべての種類を、1 工程として作れる", () => {
    const [s] = buildKind("loop", ctx());
    expect(s.kind).toBe("loop");
  });
  it("検索: 日本語・読み・別の呼び方で絞れる", () => {
    expect(searchTemplates("承認").map((t) => t.key)).toEqual(["workflow"]);
    expect(searchTemplates("ガード")[0].key).toBe("guard");
    expect(searchTemplates("select").map((t) => t.key)).toEqual(expect.arrayContaining(["lookup", "db"]));
    expect(searchTemplates("")).toHaveLength(TEMPLATES.length);
  });
});
