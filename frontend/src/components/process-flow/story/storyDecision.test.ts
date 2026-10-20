import { describe, expect, it } from "vitest";
import type { Step } from "../../../types/v3";
import { armsEmptiedByRemoving, atomKey, buildDecisionModel, composeDnf, feasible, parseDnf, removeDtAlt, removeDtRow, replaceDtRow, setDtCell } from "./storyDecision";
import { parseClause } from "./conditionBuilder";
import type { Loose } from "./storyModel";

const branch = (arms: Array<{ id: string; code: string; expr: string | Record<string, unknown> }>, withElse = true): Loose => ({
  id: "b1", kind: "branch", description: "",
  branches: arms.map((a) => ({ id: a.id, code: a.code, condition: typeof a.expr === "string" ? { kind: "expression", expression: a.expr } : a.expr, steps: [{ id: `s-${a.id}`, kind: "log", description: "x" }] })),
  ...(withElse ? { elseBranch: { id: "e", code: "X", steps: [{ id: "se", kind: "log", description: "y" }] } } : {}),
}) as unknown as Loose;

describe("parseDnf / composeDnf", () => {
  it("かつ・または・括弧を、列に展開する", () => {
    const alts = parseDnf("@a == 1 && (@b == 2 || @c == 3)")!;
    expect(alts).toHaveLength(2);
    expect(composeDnf(alts)).toBe("@a == 1 && @b == 2 || @a == 1 && @c == 3");
  });
  it("単純な式は、そのまま戻る (=== / != true も保つ)", () => {
    for (const e of ["@a === 1", "@a != true", "@a == null && @b !== 'x'", "@a > 3 || @b <= 2"]) expect(composeDnf(parseDnf(e)!)).toBe(e);
  });
  it("三項演算子は、表にできない / 空は空", () => {
    expect(parseDnf("@a ? 1 : 2")).toBeNull();
    expect(parseDnf("")).toEqual([]);
  });
  it("部品にできない条件は、式のまま持つ。!@x は否定の式", () => {
    const alts = parseDnf("!@flag && fn(@x) > 3")!;
    expect(alts[0][0]).toMatchObject({ clause: null, raw: "@flag", neg: true });
    expect(alts[0][1]).toMatchObject({ clause: null, raw: "fn(@x) > 3", neg: false });
    expect(composeDnf(alts)).toBe("!@flag && fn(@x) > 3");
  });
  it("列が多すぎる式は表にしない", () => {
    const e = Array.from({ length: 5 }, (_, i) => `(@a${i} == 1 || @b${i} == 2)`).join(" && ");
    expect(parseDnf(e)).toBeNull();
  });
  it("反対の条件は同じ行", () => {
    expect(atomKey({ clause: parseClause("@a == 1"), raw: "", neg: false })).toBe(atomKey({ clause: parseClause("@a != 1"), raw: "", neg: false }));
    expect(atomKey({ clause: parseClause("@a == 1"), raw: "", neg: false })).not.toBe(atomKey({ clause: parseClause("@a == 2"), raw: "", neg: false }));
  });
});

describe("buildDecisionModel", () => {
  it("行 × 列の ○ × － を作る", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@inputs.type == 'x' && @inputs.amount > 100" },
      { id: "b", code: "B", expr: "@inputs.type == 'x' && @inputs.amount <= 100" },
    ]))!;
    expect(m.rows).toHaveLength(2);
    expect(m.columns.map((c) => c.cells)).toEqual([["yes", "yes"], ["yes", "no"], ["any", "any"]]);
    expect(m.columns[2].isElse).toBe(true);
  });
  it("または は列に分かれ、同じ道の列として数える", () => {
    const m = buildDecisionModel(branch([{ id: "a", code: "A", expr: "@a == 1 || @b == 2" }]))!;
    expect(m.columns.filter((c) => c.armId === "a").map((c) => [c.altIndex, c.altCount])).toEqual([[0, 2], [1, 2]]);
  });
  it("先に成り立つ道に隠れる道を指摘する", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@x == 1" },
      { id: "b", code: "B", expr: "@x == 1 && @y == 2" },
    ]))!;
    expect(m.issues.some((i) => i.level === "warn" && i.text.includes("実行されません"))).toBe(true);
  });
  it("同じ項目が別の値と等しい道は、重ならない", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@inputs.t == 'x'" },
      { id: "b", code: "B", expr: "@inputs.t == 'y'" },
    ]))!;
    expect(m.issues.find((i) => i.text.includes("同時に成り立つ"))).toBeUndefined();
  });
  it("別の項目の道は、重なりうるとして知らせる", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@inputs.t == 'x'" },
      { id: "b", code: "B", expr: "@inputs.u == 'y'" },
    ]))!;
    expect(m.issues.find((i) => i.text.includes("同時に成り立つ"))).toBeTruthy();
  });
  it("「それ以外」が無いと、どの道にも入らない組み合わせを例で出す", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@inputs.p == true && @inputs.q == true" },
      { id: "b", code: "B", expr: "@inputs.p == false" },
    ], false))!;
    const gap = m.issues.find((i) => i.level === "warn" && i.text.includes("どの道にも入りません"));
    expect(gap).toBeTruthy();
  });
  it("すべて覆っていれば、そう知らせる", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@inputs.p > 1" },
      { id: "b", code: "B", expr: "@inputs.p <= 1" },
    ], false))!;
    expect(m.issues.some((i) => i.text.includes("すべてどれかの道"))).toBe(true);
  });
  it("値の違う == だけの道は、「どれでもない」だけが抜けとして出る", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@inputs.t == 'x'" },
      { id: "b", code: "B", expr: "@inputs.t == 'y'" },
    ], false))!;
    const gap = m.issues.find((i) => i.text.includes("どの道にも入りません"))!;
    expect(gap.text).toContain("と違う");
    // 「x でも y でもある」という起こりえない組み合わせは、抜けに出さない
    expect(gap.text.split(" / ").length).toBe(1);
  });
  it("エラーを捕まえる道は、表にできない列として出る", () => {
    const m = buildDecisionModel(branch([{ id: "a", code: "A", expr: { kind: "tryCatch", errorCode: "DEADLOCK" } }, { id: "b", code: "B", expr: "@x == 1" }]))!;
    expect(m.columns[0].unparsed).toContain("DEADLOCK");
    expect(m.complete).toBe(false);
  });
  it("ガードは、「それ以外 = 次へ」の列を足し、抜けの指摘は出さない", () => {
    const m = buildDecisionModel(branch([{ id: "a", code: "A", expr: "@x == 1 || @y == 2" }], false), { implicitElse: true })!;
    expect(m.columns.at(-1)).toMatchObject({ isElse: true, implicit: true });
    expect(m.issues.find((i) => i.text.includes("どの道にも"))).toBeUndefined();
  });
  it("条件が空の道と、矛盾する列を指摘する", () => {
    const m = buildDecisionModel(branch([{ id: "a", code: "A", expr: "" }, { id: "b", code: "B", expr: "@x == 1 && @x != 1" }]))!;
    expect(m.issues.filter((i) => i.level === "warn").length).toBeGreaterThanOrEqual(2);
  });
});

describe("表から直す", () => {
  const steps = (): Step[] => [branch([
    { id: "a", code: "A", expr: "@inputs.t == 'x' && @inputs.amount > 100" },
    { id: "b", code: "B", expr: "@inputs.t == 'y'" },
  ]) as unknown as Step];
  const cond = (s: Step[], id: string) => ((s[0] as unknown as { branches: Array<{ id: string; condition: { expression: string } }> }).branches.find((b) => b.id === id)!).condition.expression;

  it("マスを ○ → × → － と変えると、その道の式だけが変わる", () => {
    const s = steps();
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    const row = m.rows[1];
    expect(setDtCell(s, "b1", "b", 0, row, "yes")).toBe(true);
    expect(cond(s, "b")).toBe("@inputs.t == 'y' && @inputs.amount > 100");
    expect(setDtCell(s, "b1", "b", 0, row, "no")).toBe(true);
    expect(cond(s, "b")).toBe("@inputs.t == 'y' && @inputs.amount <= 100");
    expect(setDtCell(s, "b1", "b", 0, row, "any")).toBe(true);
    expect(cond(s, "b")).toBe("@inputs.t == 'y'");
    expect(cond(s, "a")).toBe("@inputs.t == 'x' && @inputs.amount > 100");
  });
  it("「または」の列を足す", () => {
    const s = steps();
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    setDtCell(s, "b1", "b", 1, m.rows[1], "yes");
    expect(cond(s, "b")).toBe("@inputs.t == 'y' || @inputs.amount > 100");
  });
  it("最後の条件を外すと、式は空になる (どんなときも成り立つ式にはしない)", () => {
    const s = steps();
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    setDtCell(s, "b1", "b", 0, m.rows[2], "any");
    expect(cond(s, "b")).toBe("");
  });
  it("行の条件を置き換えると、× の列は反対の条件になる", () => {
    const s = steps();
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    setDtCell(s, "b1", "b", 0, m.rows[1], "no");
    const n = replaceDtRow(s, "b1", m.rows[1], { key: "x", clause: parseClause("@inputs.amount >= 500"), raw: "", negatable: true });
    expect(n).toBe(2);
    expect(cond(s, "a")).toBe("@inputs.t == 'x' && @inputs.amount >= 500");
    expect(cond(s, "b")).toBe("@inputs.t == 'y' && @inputs.amount < 500");
  });
  it("行を消す。条件が空になる道は、先に知らせられる", () => {
    const s = steps();
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    expect(armsEmptiedByRemoving(m, 2)).toEqual(["B"]);
    expect(armsEmptiedByRemoving(m, 1)).toEqual([]);
    expect(removeDtRow(s, "b1", m.rows[1])).toBe(1);
    expect(cond(s, "a")).toBe("@inputs.t == 'x'");
  });
  it("表にできない道は直さない", () => {
    const s: Step[] = [branch([{ id: "a", code: "A", expr: "@x ? 1 : 2" }]) as unknown as Step];
    expect(setDtCell(s, "b1", "a", 0, { key: "k", clause: parseClause("@x == 1"), raw: "", negatable: true }, "yes")).toBe(false);
    expect(cond(s, "a")).toBe("@x ? 1 : 2");
  });
});

describe("レビュー指摘の対応 (第 3 弾)", () => {
  const cond = (s: Step[], id: string) => ((s[0] as unknown as { branches: Array<{ id: string; condition: { expression: string } }> }).branches.find((b) => b.id === id)!).condition.expression;
  const mk = (arms: Array<{ id: string; expr: string }>, withElse = true): Step[] => [branch(arms.map((a, i) => ({ ...a, code: "ABC"[i] })), withElse) as unknown as Step];

  it("数の範囲が重ならない組み合わせは、起こらないものとして、抜けにも重なりにも出さない", () => {
    const m = buildDecisionModel(branch([
      { id: "a", code: "A", expr: "@n > 100 && @p" },
      { id: "b", code: "B", expr: "@n > 50 && !@p" },
    ], false))!;
    const gap = m.issues.find((i) => i.text.includes("どの道にも入りません"));
    expect(gap?.text ?? "").not.toMatch(/100 より大きい.*50 以下/);
    const m2 = buildDecisionModel(branch([{ id: "a", code: "A", expr: "@n > 5" }, { id: "b", code: "B", expr: "@n < 3" }]))!;
    expect(m2.issues.find((i) => i.text.includes("同時に成り立つ"))).toBeUndefined();
  });
  it("「すべて入る」には、空・未設定は調べていないと添える。起こらない道 (x == 1 かつ x == 2) は指摘する", () => {
    const m = buildDecisionModel(branch([{ id: "a", code: "A", expr: "@n > 5" }, { id: "b", code: "B", expr: "@n <= 5" }], false))!;
    expect(m.issues.some((i) => i.text.includes("空・未設定"))).toBe(true);
    const m2 = buildDecisionModel(branch([{ id: "a", code: "A", expr: "@x == 1 && @x == 2" }]))!;
    expect(m2.issues.some((i) => i.level === "warn" && i.text.includes("食い違"))).toBe(true);
  });
  it("feasible: ない と値の比べ・はい と いいえ", () => {
    const rows = [
      { key: "1", clause: parseClause("@x == null"), raw: "", negatable: true },
      { key: "2", clause: parseClause("@x == 1"), raw: "", negatable: true },
    ];
    expect(feasible(rows, ["yes", "yes"])).toBe(false);
    expect(feasible(rows, ["yes", "no"])).toBe(true);
  });
  it("「または」の 1 列が空になる操作は断る (道が黙って狭くならない)。列ごと外すのは別の操作", () => {
    const s = mk([{ id: "a", expr: "@x == 1 || @y == 2" }]);
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    expect(setDtCell(s, "b1", "a", 0, m.rows[0], "any")).toBe(false);
    expect(cond(s, "a")).toBe("@x == 1 || @y == 2");
    expect(armsEmptiedByRemoving(m, 0)).toEqual(["A"]);
    expect(removeDtRow(s, "b1", m.rows[0])).toBe(0);
    expect(removeDtAlt(s, "b1", "a", 0)).toBe(true);
    expect(cond(s, "a")).toBe("@y == 2");
    expect(removeDtAlt(s, "b1", "a", 0)).toBe(false);
  });
  it("表にできない道は、置き換えの数に入らない (呼び出し側が知らせられる)", () => {
    const s = mk([{ id: "a", expr: "@x == 1" }, { id: "b", expr: "@x == 1 ? 1 : 0" }, { id: "c", expr: "@x == 1 && @y == 2" }]);
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    expect(replaceDtRow(s, "b1", m.rows[0], { key: "z", clause: parseClause("@z == 9"), raw: "", negatable: true })).toBe(2);
    expect(cond(s, "b")).toBe("@x == 1 ? 1 : 0");
  });
  it("=== と == は別の行で、マスを触っても、もう一方の比べ方に変わらない", () => {
    const s = mk([{ id: "a", expr: "@x === 1" }, { id: "b", expr: "@x == 1 && @y == 2" }]);
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    expect(m.rows.filter((r) => r.clause?.subject === "@x")).toHaveLength(2);
    const bRow = m.rows.find((r) => r.clause && !r.clause.strict && r.clause.subject === "@x")!;
    setDtCell(s, "b1", "b", 0, bRow, "no");
    expect(cond(s, "b")).toBe("@x != 1 && @y == 2");
  });
  it("「～ がある」の条件は、その項目の中身を使う条件より前に入る", () => {
    const s = mk([{ id: "a", expr: "@x.y > 0" }, { id: "b", expr: "@z == 1" }]);
    const m = buildDecisionModel(s[0] as unknown as Loose)!;
    setDtCell(s, "b1", "b", 0, { key: "g", clause: parseClause("@x != null"), raw: "", negatable: true }, "yes");
    setDtCell(s, "b1", "a", 0, { key: "g", clause: parseClause("@x != null"), raw: "", negatable: true }, "yes");
    expect(cond(s, "a")).toBe("@x != null && @x.y > 0");
    expect(m.rows).toHaveLength(2);
  });
});
