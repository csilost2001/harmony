import { describe, it, expect } from "vitest";
import type { Step } from "../types/v3";
import { collectVariables } from "./stepVariables";

const st = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "compute", ...extra }) as unknown as Step;

const action = {
  inputs: [{ name: "note", label: "備考" }, { name: "address" }],
  steps: [
    st("s1", { kind: "dbAccess", sql: "SELECT * FROM cart", outputBinding: { name: "cartItems" } }),
    st("s2", { kind: "branch", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "@cartItems.length === 0" }, steps: [st("s2a", { description: "備考 @inputs.note を返す" })] }] }),
    st("s3", { kind: "loop", collectionSource: "@cartItems", collectionItemName: "cartItem", steps: [st("s3a", { expression: "@cartItem.price * 2", outputBinding: { name: "total" } })] }),
    st("s4", { description: "合計 @total と @totalAmount", expression: "@requestId" }),
  ],
};
const vars = collectVariables(action, ["@requestId", "unusedAmbient"]);
const get = (n: string) => vars.find((v) => v.name === n)!;

describe("collectVariables (続編 第 8 弾 #146)", () => {
  it("入力・工程の出力・繰り返しの 1 件・自動で入る変数を、種類つきで集める", () => {
    expect(get("inputs.note")).toMatchObject({ origin: "input", label: "備考" });
    expect(get("cartItems")).toMatchObject({ origin: "output", definedAt: "s1" });
    expect(get("cartItem")).toMatchObject({ origin: "loop", definedAt: "s3" });
    expect(get("total")).toMatchObject({ origin: "output", definedAt: "s3a" });
    expect(get("requestId").origin).toBe("ambient");
  });
  it("使っている工程を、入れ子の中も別々に数える (入れ子の親には数えない)", () => {
    expect(get("cartItems").uses).toEqual(["s2", "s3"]); // 分岐の条件は、分岐の工程 s2 の自身。繰り返しの collectionSource は s3
    expect(get("inputs.note").uses).toEqual(["s2a"]);
    expect(get("cartItem").uses).toEqual(["s3a"]);
  });
  it("名前の途中までの一致は、別の名前 (@total は @totalAmount ではない)", () => {
    expect(get("total").uses).toEqual(["s4"]);
    expect(vars.find((v) => v.name === "totalAmount")).toBeUndefined();
  });
  it("定義している工程の outputBinding は、使ったことにしない / 使われていない変数は uses が空", () => {
    expect(get("cartItems").uses).not.toContain("s1");
    expect(get("inputs.address").uses).toEqual([]);
    expect(get("unusedAmbient").uses).toEqual([]);
    expect(get("requestId").uses).toEqual(["s4"]);
  });
  it("同じ名前を重ねて定義しても、1 つにまとめる", () => {
    const v = collectVariables({ steps: [st("a", { outputBinding: { name: "x" } }), st("b", { outputBinding: { name: "x" } })] });
    expect(v.filter((x) => x.name === "x")).toHaveLength(1);
  });
});
