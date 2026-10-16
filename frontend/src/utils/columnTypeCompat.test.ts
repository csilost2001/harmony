import { describe, it, expect } from "vitest";
import { columnTypeMismatch, typeFamily } from "./columnTypeCompat";

describe("typeFamily", () => {
  it("型を仲間に分ける", () => {
    expect(["INTEGER", "BIGINT", "smallint", "SERIAL"].map(typeFamily)).toEqual(Array(4).fill("integer"));
    expect(["VARCHAR", "CHAR", "TEXT"].map(typeFamily)).toEqual(Array(3).fill("string"));
    expect(["DATE", "TIMESTAMP", "TIME"].map(typeFamily)).toEqual(Array(3).fill("datetime"));
    expect(typeFamily("DECIMAL")).toBe("decimal");
    expect(typeFamily("GEOMETRY")).toBe("other");
  });
});

describe("columnTypeMismatch", () => {
  const c = (physicalName: string, dataType: string) => ({ physicalName, dataType });
  it("同じ仲間 (整数どうしなど) は、合っている", () => {
    expect(columnTypeMismatch(c("a", "INTEGER"), c("b", "BIGINT"))).toBeNull();
    expect(columnTypeMismatch(c("a", "VARCHAR"), c("b", "CHAR"))).toBeNull();
  });
  it("仲間が違えば、どの型かを添えて知らせる", () => {
    expect(columnTypeMismatch(c("customer_id", "BIGINT"), c("code", "VARCHAR"))).toBe("型が違います: customer_id は BIGINT、code は VARCHAR");
  });
  it("知らない型どうしは、同じ名前のときだけ合っている", () => {
    expect(columnTypeMismatch(c("a", "GEOMETRY"), c("b", "GEOMETRY"))).toBeNull();
    expect(columnTypeMismatch(c("a", "GEOMETRY"), c("b", "POINT"))).not.toBeNull();
  });
});
