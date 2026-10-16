import { describe, it, expect } from "vitest";
import { analyzeExpression, analyzeReferences, describeCondition, editDistance, nearestName } from "./referenceHints";
import type { Resolver } from "./reference-completer/types";

describe("editDistance / nearestName", () => {
  it("1 文字の違い・入れ替えを近いとみなす", () => {
    expect(editDistance("cart", "crat")).toBe(1);
    expect(editDistance("cart", "carts")).toBe(1);
    expect(editDistance("abc", "xyz")).toBe(3);
  });
  it("近い名前を返す。一致があれば null。短すぎる・遠いものは null", () => {
    expect(nearestName("crat", ["cart", "customer", "order"])).toBe("cart");
    expect(nearestName("cart", ["cart", "carts"])).toBeNull();
    expect(nearestName("ab", ["abc"])).toBeNull();
    expect(nearestName("shipmnt", ["shipment", "order"])).toBe("shipment");
    expect(nearestName("zzzzzz", ["cart", "order"])).toBeNull();
  });
});

const fake: Resolver = {
  id: "fake",
  match(value, pos) {
    const before = value.slice(0, pos);
    const m = /@screen\.$/.exec(before);
    if (!m) return null;
    return { phase: "active", resolverId: "fake", prefix: "", replaceLen: 0, candidates: [{ value: "cart" }, { value: "order-list" }, { value: "customer-master" }] };
  },
};

describe("analyzeReferences", () => {
  it("打ち間違いに、近い名前と、直した全文を返す", () => {
    const h = analyzeReferences("@screen.crat === 1", [fake], {});
    expect(h).toHaveLength(1);
    expect(h[0].message).toContain("近い名前: cart");
    expect(h[0].fix).toBe("@screen.cart === 1");
  });
  it("存在する参照・近い名前が無い参照・参照でない文字は、指摘しない", () => {
    expect(analyzeReferences("@screen.cart", [fake], {})).toEqual([]);
    expect(analyzeReferences("@screen.unrelatedname", [fake], {})).toEqual([]);
    expect(analyzeReferences("plain text", [fake], {})).toEqual([]);
  });
});

describe("analyzeExpression", () => {
  const msgs = (s: string) => analyzeExpression(s).map((h) => h.message);
  it("正しい式は、指摘なし", () => {
    expect(msgs("@inputs.amount >= 10000 && @inputs.status !== 'locked'")).toEqual([]);
    expect(msgs("(@a.b > 1) || !@c.d")).toEqual([]);
    expect(msgs("")).toEqual([]);
  });
  it("括弧・引用符の閉じ忘れ", () => {
    expect(msgs("(@a.b > 1")[0]).toContain("括弧が閉じていません");
    expect(msgs("@a.b > 1)")[0]).toContain("対応する開き括弧がありません");
    expect(msgs("@a.b === 'x")[0]).toContain("引用符 ' が閉じていません");
    expect(msgs("(@a.b]")[0]).toContain("括弧が対応していません");
  });
  it("演算子の並びの間違い", () => {
    expect(msgs("@a.b >")[0]).toContain("演算子 > の後に値がありません");
    expect(msgs("&& @a.b")[0]).toContain("演算子 && の前に値がありません");
    expect(msgs("@a.b >= && @c.d")[0]).toContain("のあとに、演算子 && が続いています");
  });
  it("「=」は代入。AND / OR は && / ||", () => {
    expect(msgs("@a.b = 1")[0]).toContain("「===」");
    expect(msgs("@a.b === 1 AND @c.d === 2")[0]).toContain("「&&」「||」");
  });
});

describe("describeCondition", () => {
  it("単純な比較を、平文にする", () => {
    expect(describeCondition("@inputs.amount >= 10000")).toBe("inputs.amount が 10000 以上 のとき");
    expect(describeCondition("@inputs.status !== 'locked'")).toBe("inputs.status が locked と異なる のとき");
  });
  it("&& / || を、かつ / または にする。真偽だけの参照も", () => {
    expect(describeCondition("@a.b > 1 && !@c.d")).toBe("a.b が 1 より大きい、かつ c.d が偽 (空) のとき");
    expect(describeCondition("@a.b === 1 || @a.c")).toBe("a.b が 1 と等しい、または a.c が真 (値がある) のとき");
  });
  it("複雑な式 (括弧・三項) は、言い直さない", () => {
    expect(describeCondition("(@a.b > 1)")).toBeNull();
    expect(describeCondition("@a.b ? 1 : 2")).toBeNull();
    expect(describeCondition("")).toBeNull();
  });
});
