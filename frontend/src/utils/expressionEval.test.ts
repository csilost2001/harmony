import { describe, it, expect } from "vitest";
import { evaluateExpression, formatValue, referencedRoots } from "./expressionEval";

const ev = (s: string, vars: Record<string, unknown> = {}) => evaluateExpression(s, vars);
const val = (s: string, vars: Record<string, unknown> = {}) => { const r = ev(s, vars); if (!r.ok) throw new Error(r.error); return r.value; };

describe("evaluateExpression (続編 第 8 弾 #150)", () => {
  it("設計書の式: @ の参照・比較・論理", () => {
    expect(val("@cartItems == null || @cartItems.length === 0", { cartItems: [] })).toBe(true);
    expect(val("@cartItems == null || @cartItems.length === 0", { cartItems: [1] })).toBe(false);
    expect(val("@cartItems == null || @cartItems.length === 0", {})).toBe(true); // 未定義 == null
    expect(val("@inputs.note != null && @inputs.note.length > 3", { inputs: { note: "abcd" } })).toBe(true);
  });
  it("四則・比較・三項・括弧・単項", () => {
    expect(val("1 + 2 * 3")).toBe(7);
    expect(val("(1 + 2) * 3")).toBe(9);
    expect(val("10 % 4 - -1")).toBe(3);
    expect(val("@a > 10 ? 'big' : 'small'", { a: 11 })).toBe("big");
    expect(val("!@flag", { flag: false })).toBe(true);
    expect(val("'a' + 'b'")).toBe("ab");
  });
  it("参照: 配列の添字・文字列の length・null の先は未定義", () => {
    expect(val("@items[1].name", { items: [{ name: "x" }, { name: "y" }] })).toBe("y");
    expect(val("@s.length", { s: "abc" })).toBe(3);
    expect(val("@x.y.z", { x: null })).toBeUndefined();
    expect(val("@x.__proto__", { x: {} })).toBeUndefined();
  });
  it("許した文字列・配列の操作", () => {
    expect(val("@s.includes('b')", { s: "abc" })).toBe(true);
    expect(val("@s.trim().toUpperCase()", { s: " ab " })).toBe("AB");
    expect(val("@list.join('-')", { list: [1, 2] })).toBe("1-2");
    expect(val("@list.includes(2)", { list: [1, 2] })).toBe(true);
  });
  it("範囲外の書き方は、試せません (アロー関数・関数呼び出し・代入・見知らぬ名前)", () => {
    expect(ev("@items.reduce((s, i) => s + i, 0)").ok).toBe(false);
    expect(ev("alert(1)").ok).toBe(false);
    expect(ev("process.env").ok).toBe(false);
    expect(ev("@a = 1").ok).toBe(false);
    expect(ev("constructor").ok).toBe(false);
    expect((ev("@s.constructor('x')", { s: "a" }) as { error: string }).error).toContain("試せません");
    expect((ev("@items.map(x)") as { error: string }).error).toContain("map()");
  });
  it("文法の誤りは、理由つきで返す", () => {
    expect((ev("1 +") as { ok: false }).ok).toBe(false);
    expect(ev("(1 + 2").ok).toBe(false);
    expect(ev("'abc").ok).toBe(false);
    expect(ev("1 2").ok).toBe(false);
    expect(ev("@a ? 1").ok).toBe(false);
  });
  it("長すぎる式・深すぎる入れ子は止める", () => {
    expect(ev("1".repeat(2001)).ok).toBe(false);
    expect(ev("(".repeat(100) + "1" + ")".repeat(100)).ok).toBe(false);
  });
  it("参照の名前の一覧と、結果の表示", () => {
    expect(referencedRoots("@inputs.a == @cartItems.length && @inputs.b")).toEqual(["inputs", "cartItems"]);
    expect(formatValue(undefined)).toContain("未定義");
    expect(formatValue("x")).toBe('"x"');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(true)).toBe("true");
  });
});

import { collectExpressions } from "./expressionEval";
describe("collectExpressions", () => {
  it("分岐の条件・実行条件・式を、入れ子の中も含めて集める", () => {
    const steps = [
      { id: "a", kind: "compute", expression: "@x + 1" },
      { id: "b", kind: "branch", branches: [{ code: "A", condition: { kind: "expression", expression: "@x > 1" }, steps: [{ id: "c", kind: "return", bodyExpression: "{ ok: true }", runIf: "@y" }] }, { code: "B", condition: { kind: "tryCatch", errorCode: "E" }, steps: [] }], elseBranch: { steps: [{ id: "d", kind: "compute", expression: "1" }] } },
      { id: "e", kind: "loop", steps: [{ id: "f", kind: "compute", expression: " " }] },
    ];
    const r = collectExpressions(steps);
    expect(r.map((x) => `${x.stepId}:${x.where}`)).toEqual(["a:式", "b:分岐 A の条件", "c:実行条件", "c:返す内容", "d:式"]);
    expect(r[1].text).toBe("@x > 1");
  });
});
