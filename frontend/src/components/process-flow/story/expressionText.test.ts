import { describe, expect, it } from "vitest";
import { expressionSegments, parseVarRef, segsToText, splitTopLevel } from "./expressionText";

const label = (name: string, path: string[]) => [name, ...path].join(".");
const text = (e: string) => segsToText(expressionSegments(e), label);

describe("parseVarRef", () => {
  it("名前と、その後ろの道すじに分ける", () => {
    expect(parseVarRef("@customer.isActive")).toEqual({ name: "customer", path: ["isActive"], raw: "@customer.isActive" });
    expect(parseVarRef("@stock[0].available")).toEqual({ name: "stock", path: ["[0]", "available"], raw: "@stock[0].available" });
  });
  it("@var.action.<名前> は、その名前の変数として読む", () => {
    expect(parseVarRef("@var.action.txResult.committed")).toEqual({ name: "txResult", path: ["committed"], raw: "@var.action.txResult.committed" });
  });
  it("参照の範囲の前置き (var.loop / var.step.<工程> / 暗黙) も、その名前の変数として読む", () => {
    expect(parseVarRef("@var.loop.cartItem.qty")).toMatchObject({ name: "cartItem", path: ["qty"] });
    expect(parseVarRef("@var.step.s1.cartItems.length")).toMatchObject({ name: "cartItems", path: ["length"] });
    expect(parseVarRef("@var.caughtError.message")).toMatchObject({ name: "caughtError", path: ["message"] });
  });
  it("変数でなければ null", () => {
    expect(parseVarRef("customer")).toBeNull();
    expect(parseVarRef("@a + @b")).toBeNull();
  });
});

describe("splitTopLevel", () => {
  it("引用符や括弧の中の && || では分けない", () => {
    expect(splitTopLevel("@a == 'x && y' && (@b || @c)", "&&")).toEqual(["@a == 'x && y'", "(@b || @c)"]);
    expect(splitTopLevel("(@a || @b)", "||")).toBeNull();
  });
});

describe("expressionSegments (条件を言葉に)", () => {
  it("null との比較", () => {
    expect(text("@customer == null")).toBe("customer が ない");
    expect(text("@customer != null")).toBe("customer が ある");
  });
  it("真偽値との比較", () => {
    expect(text("@customer.isActive == false")).toBe("customer.isActive が「いいえ」");
    expect(text("@x == true")).toBe("x が「はい」");
    expect(text("@x != false")).toBe("x が「はい」");
  });
  it("大小・等しい", () => {
    expect(text("@problems.length > 0")).toBe("problems.length が 0 より大きい");
    expect(text("@a >= @b")).toBe("a が b 以上");
    expect(text("@inputs.paymentTerm == 'prepaid'")).toBe("inputs.paymentTerm が 「prepaid」 と等しい");
  });
  it("かつ / または", () => {
    expect(text("@a == null || @b == null")).toBe("a が ない または b が ない");
    expect(text("@inputs.paymentTerm == 'cod' && @orderTotal > @conv.limit.codMax")).toContain(" かつ ");
  });
  it("「かつ」の中の「または」は、括弧でまとまりを残す (意味を変えない)", () => {
    expect(text("(@a == 1 || @b == 2) && @c == 3")).toBe("（a が 1 と等しい または b が 2 と等しい） かつ c が 3 と等しい");
    expect(text("@a == 1 && (@b == 2 || @c == 3)")).toBe("a が 1 と等しい かつ （b が 2 と等しい または c が 3 と等しい）");
    expect(text("@a == 1 && @b == 2 || @c == 3")).toBe("a が 1 と等しい かつ b が 2 と等しい または c が 3 と等しい");
  });
  it("変数だけの式は、真偽値とは限らないので、言葉にしない", () => {
    expect(expressionSegments("@customer")).toEqual([{ k: "code", v: "@customer" }]);
    expect(expressionSegments("!@items.length")).toEqual([{ k: "code", v: "!@items.length" }]);
  });
  it("三項演算子・?? を含む式は、全体を式のまま出す", () => {
    expect(expressionSegments("@a && @b ? 1 : 2")).toEqual([{ k: "code", v: "@a && @b ? 1 : 2" }]);
    expect(expressionSegments("@a ?? 0 > 1")).toEqual([{ k: "code", v: "@a ?? 0 > 1" }]);
  });
  it("外側の括弧は外す", () => {
    expect(text("(@a == null)")).toBe("a が ない");
  });
  it("読めない式は、そのまま式として返す", () => {
    const segs = expressionSegments("@orderTotal >= 1000000 || (@a == 'x' && @r + @t > @c.limit * 0.8)");
    expect(segs.some((s) => s.k === "code")).toBe(true);
    expect(expressionSegments("fn(@a) > 0")).toEqual([{ k: "code", v: "fn(@a) > 0" }]);
  });
  it("空の式は空", () => {
    expect(expressionSegments("")).toEqual([]);
    expect(expressionSegments(undefined)).toEqual([]);
  });
  it("変数は var の部品になる (クリックで光らせるため)", () => {
    const segs = expressionSegments("@customer == null");
    expect(segs[0]).toMatchObject({ k: "var", name: "customer", path: [] });
  });
});
