/**
 * 設計どうしの参照の整合 (shared/src/analysis/integrity.ts) と、工程の入れ子の置き場所をすべて歩く forEachStep。
 * shared には試験の実行がないので、ここに置く。
 */
import { describe, expect, it } from "vitest";
import { checkIntegrity, forEachStep, type DesignDocInput } from "@harmony/shared";

const base = (): DesignDocInput => ({
  project: { name: "t" },
  screens: [{ id: "s1", name: "画面1", items: [{ id: "i1", binding: { kind: "tableColumn", ref: { tableId: "t1", columnId: "c1" } }, events: [{ id: "e", handlerFlowId: "f1", handlerActionId: "a1" }] }] }],
  tables: [{ id: "t1", name: "表1", columns: [{ id: "c1", physicalName: "col_1" }], constraints: [{ id: "fk", kind: "foreignKey", referencedTableId: "t1", referencedColumnIds: ["c1"] }] }],
  flows: [{
    meta: { id: "f1", name: "処理1", screenId: "s1" },
    actions: [{ id: "a1", responses: [{ id: "r200", status: 200 }], steps: [
      { id: "s-1", kind: "dbAccess", tableId: "t1", operation: "SELECT" },
      { id: "s-2", kind: "branch", branches: [{ id: "b", code: "A", condition: { kind: "expression", expression: "@x == 1" }, steps: [{ id: "s-3", kind: "return", responseId: "r200" }] }] },
    ] }],
  }],
  limits: { max: { value: 1 } }, regex: {}, messages: { ok: {} },
} as unknown as DesignDocInput);

const msgs = (i: DesignDocInput) => checkIntegrity(i).map((x) => `${x.severity}|${x.message}`);

describe("checkIntegrity (設計どうしの参照)", () => {
  it("整った設計は 0 件", () => { expect(checkIntegrity(base())).toEqual([]); });

  it("処理フロー: 画面・テーブル・遷移先・レスポンス・空の条件・工程 id の重複", () => {
    const i = base();
    const f = i.flows[0] as unknown as { meta: Record<string, unknown>; actions: Array<{ steps: Array<Record<string, unknown>> }> };
    f.meta.screenId = "gone";
    f.actions[0].steps[0].tableId = "gone-table";
    f.actions[0].steps.push({ id: "s-9", kind: "screenTransition", targetScreenId: "gone-screen" }, { id: "s-1", kind: "compute", expression: "1" });
    (f.actions[0].steps[1].branches as Array<Record<string, any>>)[0].condition.expression = "  ";
    (f.actions[0].steps[1].branches as Array<Record<string, any>>)[0].steps[0].responseId = "r404";
    const out = msgs(i).join("\n");
    for (const w of ["呼び出す画面「gone」", "テーブル「gone-table」", "遷移先の画面「gone-screen」", "レスポンス「r404」", "条件が空です", "工程の id「s-1」が 2 回"]) expect(out, w).toContain(w);
  });

  it("画面項目: 結びつき先のテーブル・カラム、イベントの処理フロー・アクション", () => {
    const i = base();
    const it = (i.screens[0].items as unknown as Array<Record<string, any>>)[0];
    it.binding.ref = { tableId: "t1", columnId: "gone-col" };
    it.events[0].handlerActionId = "gone-action";
    let out = msgs(i).join("\n");
    expect(out).toContain("カラム「gone-col」");
    expect(out).toContain("アクション「gone-action」");
    it.binding.ref = { tableId: "gone-table", columnId: "c1" };
    it.events[0].handlerFlowId = "gone-flow";
    out = msgs(i).join("\n");
    expect(out).toContain("テーブル「gone-table」");
    expect(out).toContain("処理フロー「gone-flow」");
    // 物理名での結びつきも受ける
    (i.screens[0].items as unknown as Array<Record<string, any>>)[0].binding.ref = { tableId: "t1", columnId: "col_1" };
    (i.screens[0].items as unknown as Array<Record<string, any>>)[0].events = [];
    expect(checkIntegrity(i)).toEqual([]);
  });

  it("テーブル: 外部キーの参照先のテーブル・カラム。noConstraint は見ない", () => {
    const i = base();
    const t = i.tables[0] as unknown as { constraints: Array<Record<string, unknown>> };
    t.constraints[0].referencedTableId = "gone";
    expect(msgs(i).join("\n")).toContain("参照先のテーブル「gone」");
    t.constraints[0].referencedTableId = "t1"; t.constraints[0].referencedColumnIds = ["gone-col"];
    expect(msgs(i).join("\n")).toContain("参照先のカラム「gone-col」");
    t.constraints[0].noConstraint = true;
    expect(checkIntegrity(i)).toEqual([]);
  });

  it("規約の参照: 定義された側があるときだけ見る。定義の中の項目まで書く参照は先頭の名前で見る", () => {
    const i = base();
    const f = i.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> };
    f.actions[0].steps.push({ id: "s-7", kind: "compute", expression: "@conv.limit.max + @conv.limit.max.value + @conv.limit.gone + @conv.msg.ok + @conv.msg.gone2 + @conv.regex.nothing" });
    const out = msgs(i).join("\n");
    expect(out).toContain("@conv.limit.gone");
    expect(out).toContain("@conv.msg.gone2");
    expect(out).toContain("@conv.regex.nothing");
    expect(out).not.toContain("@conv.limit.max」");
    const i2 = base(); (i2 as unknown as Record<string, unknown>).limits = undefined;
    (i2.flows[0] as unknown as { actions: Array<{ steps: Array<Record<string, unknown>> }> }).actions[0].steps.push({ id: "s-7", kind: "compute", expression: "@conv.limit.gone" });
    expect(checkIntegrity(i2)).toEqual([]); // 規約を読めていないときは、言わない
  });

  it("アクションをまたぐ同じ工程 id は、警告でなく情報", () => {
    const i = base();
    (i.flows[0] as unknown as { actions: unknown[] }).actions.push({ id: "a2", steps: [{ id: "s-1", kind: "compute", expression: "1" }] });
    const out = checkIntegrity(i);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("info");
    expect(out[0].message).toContain("アクションをまたいで");
  });

  it("入れ子 (検証の OK/NG・承認の後・失敗系の副作用) の中の工程も見る", () => {
    const i = base();
    (i.flows[0] as unknown as { actions: Array<{ steps: unknown[] }> }).actions[0].steps.push(
      { id: "v", kind: "validation", inlineBranch: { ok: [], ng: [{ id: "ng-1", kind: "dbAccess", tableId: "gone-ng" }] } },
      { id: "w", kind: "workflow", onApproved: [{ id: "ap-1", kind: "dbAccess", tableId: "gone-ap" }] },
      { id: "x", kind: "externalSystem", errorHandling: { outcomes: { failure: { sideEffects: [{ id: "se-1", kind: "dbAccess", tableId: "gone-se" }] } } } },
    );
    const out = msgs(i).join("\n");
    for (const t of ["gone-ng", "gone-ap", "gone-se"]) expect(out, t).toContain(`テーブル「${t}」`);
  });
});

describe("forEachStep: 入れ子の置き場所をすべて歩く", () => {
  it("steps / subSteps / 分岐の道 / 上記以外 / コミット後・ロールバック時 / 承認・却下・期限切れ / 検証の OK・NG / 失敗系の副作用", () => {
    const steps = [
      { id: "a", kind: "loop", steps: [{ id: "a1", kind: "compute" }], subSteps: [{ id: "a2", kind: "compute" }] },
      { id: "b", kind: "branch", branches: [{ id: "x", code: "A", steps: [{ id: "b1", kind: "compute" }] }], elseBranch: { steps: [{ id: "b2", kind: "compute" }] } },
      { id: "c", kind: "transactionScope", steps: [], onCommit: [{ id: "c1", kind: "log" }], onRollback: [{ id: "c2", kind: "log" }] },
      { id: "d", kind: "workflow", onApproved: [{ id: "d1" }], onRejected: [{ id: "d2" }], onTimeout: [{ id: "d3" }] },
      { id: "e", kind: "validation", inlineBranch: { ok: [{ id: "e1" }], ng: [{ id: "e2" }] } },
      { id: "f", kind: "externalSystem", errorHandling: { outcomes: { failure: { sideEffects: [{ id: "f1" }] }, success: { sideEffects: [{ id: "f2" }] } } } },
    ];
    const seen: string[] = [];
    forEachStep(steps as never, (s) => { seen.push(String((s as { id?: string }).id)); });
    expect(seen.sort()).toEqual(["a", "a1", "a2", "b", "b1", "b2", "c", "c1", "c2", "d", "d1", "d2", "d3", "e", "e1", "e2", "f", "f1", "f2"]);
  });
});
