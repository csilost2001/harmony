import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionDefinition, ProcessFlow } from "../../../types/v3";
import {
  asLoose,
  asLooseList,
  buildVarLabels,
  childGroups,
  collectExits,
  conditionText,
  countSteps,
  isGuardBranch,
  reviewTargets,
  sectionsOf,
  stepChips,
  stepCode,
  stepDigest,
  variableFlow,
  type StoryCtx,
} from "./storyModel";

const retail = (name: string): ProcessFlow =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../../../examples/retail/harmony/process-flows/${name}.json`), "utf-8")) as ProcessFlow;

const flowCtx = { tableName: (id: string) => ({ order: "注文" }[id]), screenName: () => undefined };

function mini(): ActionDefinition {
  return ({
    id: "a1",
    name: "試験",
    trigger: "submit",
    inputs: [{ name: "customerId", label: "取引先", type: "integer", required: true }],
    responses: [
      { id: "200-ok", status: 200, description: "完了" },
      { id: "404-nf", status: 404, description: "取引先なし" },
      { id: "422-x", status: 422, description: "不備" },
    ],
    steps: [
      { id: "s1", kind: "dbAccess", heading: "取引先を確かめる", description: "取得する", tableId: "order", operation: "SELECT", sql: "SELECT id FROM t WHERE id = @inputs.customerId", outputBinding: { name: "customer", label: "取引先" } },
      {
        id: "s2", kind: "branch", description: "無ければ返す",
        branches: [{ id: "b1", code: "A", label: "無い", condition: { kind: "expression", expression: "@customer == null" }, steps: [{ id: "r1", kind: "return", description: "404", responseId: "404-nf" }] }],
        elseBranch: { id: "e1", code: "B", label: "ある", steps: [] },
      },
      {
        id: "s3", kind: "branch", description: "2 つの道",
        branches: [
          { id: "b2", code: "A", label: "多い", condition: { kind: "expression", expression: "@customer.n > 3" }, steps: [{ id: "r2", kind: "return", description: "422", responseId: "422-x" }, ] },
          { id: "b3", code: "B", label: "エラー", condition: { kind: "tryCatch", errorCode: "E1", errorVar: "caught" }, steps: [{ id: "c1", kind: "compute", description: "控える", expression: "@caught.code", outputBinding: { name: "memo" } }] },
        ],
        elseBranch: { id: "e2", code: "C", label: "少ない", steps: [{ id: "c2", kind: "compute", description: "足す", expression: "1" }] },
      },
      { id: "s4", heading: "確定する", kind: "return", description: "終わり", responseId: "200-ok", runIf: "@customer != null" },
    ] as unknown as ActionDefinition["steps"],
  }) as unknown as ActionDefinition;
}

describe("見出しによる区切り", () => {
  it("見出しが無ければ、全体が 1 つの区切り", () => {
    const sec = sectionsOf(asLooseList(retail("cart-add").actions[0].steps));
    expect(sec).toHaveLength(1);
    expect(sec[0].heading).toBeNull();
  });
  it("heading のある工程から、新しい区切りを始める", () => {
    const sec = sectionsOf(asLooseList(mini().steps));
    expect(sec.map((s) => [s.heading, s.steps.length, s.startIndex])).toEqual([["取引先を確かめる", 3, 0], ["確定する", 1, 3]]);
  });
  it("先頭に見出しが無い工程は、見出しなしの区切りになる", () => {
    const sec = sectionsOf(asLooseList([{ id: "a", kind: "compute" }, { id: "b", kind: "compute", heading: "H" }] as never));
    expect(sec.map((s) => s.heading)).toEqual([null, "H"]);
  });
});

describe("入れ子とガード", () => {
  it("「返す」だけの判定は、ガード", () => {
    const steps = asLooseList(mini().steps);
    expect(isGuardBranch(steps[1])).toBe(true);
    expect(isGuardBranch(steps[2])).toBe(false);
    expect(isGuardBranch(steps[0])).toBe(false);
  });
  it("腕に記号 (A, B…) が付く", () => {
    const g = childGroups(asLoose(mini().steps[2]));
    expect(g.map((x) => [x.role, x.code])).toEqual([["arm", "A"], ["arm", "B"], ["else", "C"]]);
  });
  it("トランザクションと繰り返しの中身 (実サンプル)", () => {
    const steps = asLooseList(retail("order-confirm").actions[0].steps);
    const tx = steps.find((s) => s.kind === "transactionScope");
    expect(tx).toBeTruthy();
    expect(childGroups(tx!)[0].role).toBe("body");
    expect(countSteps(steps)).toBeGreaterThan(steps.length);
  });
  it("確認済みの対象は、ガードの中の「返す」を含めない", () => {
    const steps = asLooseList(mini().steps);
    const ids = reviewTargets(steps).map((s) => s.id);
    expect(ids).toContain("s2");
    expect(ids).not.toContain("r1");
    expect(ids).toContain("r2");
  });
});

describe("条件", () => {
  const labels = buildVarLabels(mini());
  it("式・tryCatch を言葉にする", () => {
    const g = childGroups(asLoose(mini().steps[2]));
    expect(conditionText(g[0].condition, labels)).toBe("取引先 の n が 3 より大きい");
    expect(conditionText(g[1].condition, labels)).toBe("エラー「E1」が起きたとき");
    expect(conditionText({ kind: "affectedRowsZero" }, labels)).toContain("0 件");
    expect(conditionText({ kind: "externalOutcome", outcome: "timeout" }, labels)).toContain("時間切れ");
  });
});

describe("出口", () => {
  it("すべての「返す」と、そこへ行く道すじ", () => {
    const action = mini();
    const exits = collectExits(action);
    expect(exits.map((e) => [e.stepId, e.status, e.error])).toEqual([["r1", 404, true], ["r2", 422, true], ["s4", 200, false]]);
    expect(exits[0].path).toEqual(["取引先 が ない"]);
    expect(exits[1].path).toEqual(["取引先 の n が 3 より大きい"]);
    expect(exits[2].path).toEqual(["「取引先 が ある」のとき"]);
    expect(exits[2].label).toBe("完了");
  });
  it("それ以外の道は、ほかの腕の名前で言う", () => {
    const action = mini();
    action.steps.push({
      id: "s5", kind: "branch", description: "x",
      branches: [{ id: "b9", code: "A", label: "甲", condition: { kind: "expression", expression: "@a == null" }, steps: [] }],
      elseBranch: { id: "e9", code: "B", steps: [{ id: "r9", kind: "return", description: "z", responseId: "200-ok" }] },
    } as never);
    const last = collectExits(action).at(-1)!;
    expect(last.stepId).toBe("r9");
    expect(last.path[0]).toContain("のどれでもない");
  });
  it("実サンプルでも、返す工程の数だけ出口がある", () => {
    const action = retail("order-confirm").actions[0];
    const returns: string[] = [];
    const walk = (l: unknown) => { for (const s of asLooseList(l as never)) { if (s.kind === "return") returns.push(s.id); for (const g of childGroups(s)) walk(g.steps); } };
    walk(action.steps);
    expect(collectExits(action).map((e) => e.stepId).sort()).toEqual(returns.sort());
  });
});

describe("変数の流れ", () => {
  it("作る場所と使う場所", () => {
    const vars = variableFlow(mini());
    const customer = vars.find((v) => v.name === "customer")!;
    expect(customer.defIds).toEqual(["s1"]);
    expect(customer.useIds).toEqual(expect.arrayContaining(["s2", "s3", "s4"]));
    expect(customer.label).toBe("取引先");
    const caught = vars.find((v) => v.name === "caught")!;
    expect(caught.how).toBe("errorVar");
    expect(caught.useIds).toContain("c1");
  });
  it("実サンプル: TX の結果は @var.action.<名前> の形でも使われる", () => {
    const vars = variableFlow(retail("order-confirm").actions[0]);
    const tx = vars.find((v) => v.name === "txResult")!;
    expect(tx.defIds.length).toBe(1);
    expect(tx.useIds.length).toBeGreaterThan(0);
  });
});

describe("行の印・コード・指紋", () => {
  const action = mini();
  const ctx: StoryCtx = { flow: flowCtx, action, labels: buildVarLabels(action) };
  it("DB の行: テーブル名・操作・条件・結果の変数", () => {
    const chips = stepChips(asLoose(action.steps[0]), ctx);
    expect(chips.map((c) => c.text)).toEqual(["注文", "検索", "条件: id = @inputs.customerId", "→ 取引先"]);
    expect(chips.at(-1)?.varName).toBe("customer");
  });
  it("返す行: 状態コードと説明", () => {
    const chips = stepChips(asLoose(action.steps[3]), ctx);
    expect(chips[0]).toMatchObject({ text: "200 完了", tone: "ok" });
  });
  it("SQL のコード", () => {
    expect(stepCode(asLoose(action.steps[0]))).toContain("SELECT id");
    expect(stepCode(asLoose(action.steps[1]))).toBeUndefined();
  });
  it("指紋: 内容が変わると変わる。入れ子の中は含めない", () => {
    const a = asLoose(action.steps[2]);
    const d1 = stepDigest(a);
    const b = asLoose(JSON.parse(JSON.stringify(action.steps[2])) as never);
    expect(stepDigest(b)).toBe(d1);
    (b.branches as Array<{ steps: unknown[] }>)[0].steps = [];
    expect(stepDigest(b)).toBe(d1);
    b.description = "変えた";
    expect(stepDigest(b)).not.toBe(d1);
  });
});
