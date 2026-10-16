import { describe, it, expect } from "vitest";
import { identifierHint, isValidIdentifier, suggestIdentifier } from "./identifierHints";

describe("isValidIdentifier", () => {
  it("camelCase / snake_case の形式 (schema どおり)", () => {
    expect(isValidIdentifier("customerId", "camel")).toBe(true);
    expect(isValidIdentifier("CustomerId", "camel")).toBe(false);
    expect(isValidIdentifier("customer_id", "camel")).toBe(false);
    expect(isValidIdentifier("customer_id", "snake")).toBe(true);
    expect(isValidIdentifier("customerId", "snake")).toBe(false);
    expect(isValidIdentifier("a".repeat(64), "snake")).toBe(false);
  });
});

describe("suggestIdentifier", () => {
  it("区切り・大文字・全角・空白を直した案を作る", () => {
    expect(suggestIdentifier("Customer Id", "camel")).toBe("customerId");
    expect(suggestIdentifier("customer_id", "camel")).toBe("customerId");
    expect(suggestIdentifier("CustomerId", "snake")).toBe("customer_id");
    expect(suggestIdentifier("ｏｒｄｅｒ－ｉｔｅｍ", "snake")).toBe("order_item");
    expect(suggestIdentifier("1st-item", "camel")).toBe("stItem");
  });
  it("英数字が無ければ、案は出せない", () => {
    expect(suggestIdentifier("顧客", "camel")).toBeNull();
    expect(suggestIdentifier("", "snake")).toBeNull();
  });
});

describe("identifierHint", () => {
  it("合っていれば null。空欄は必須 (required=false なら null)", () => {
    expect(identifierHint("customerId", "camel")).toBeNull();
    expect(identifierHint("", "camel")?.message).toContain("必須です");
    expect(identifierHint("", "camel", false)).toBeNull();
  });
  it("違うときは、理由と、直した値の案を返す", () => {
    const h = identifierHint("Customer Id", "camel")!;
    expect(h.message).toContain("使えない文字");
    expect(h.fix).toBe("customerId");
    expect(identifierHint("9abc", "snake")?.message).toContain("先頭は英小文字");
    expect(identifierHint("顧客", "camel")?.fix).toBeUndefined();
  });
});
