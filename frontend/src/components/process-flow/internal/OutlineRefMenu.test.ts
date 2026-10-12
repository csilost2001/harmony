import { describe, it, expect } from "vitest";
import { filterRefCandidates } from "./OutlineRefMenu";

describe("filterRefCandidates", () => {
  const list = [{ id: "orders", label: "注文" }, { id: "order-items", label: "注文明細" }, { id: "customers", label: "顧客" }];
  it("空なら全部、語は ID・名前の両方に、全角半角・かなの差を無視して、すべて合うものだけ", () => {
    expect(filterRefCandidates(list, "")).toHaveLength(3);
    expect(filterRefCandidates(list, "ＯＲＤＥＲ").map((c) => c.id)).toEqual(["orders", "order-items"]);
    expect(filterRefCandidates(list, "注文 明細").map((c) => c.id)).toEqual(["order-items"]);
    expect(filterRefCandidates(list, "なし")).toEqual([]);
  });
});
