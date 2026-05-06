import { describe, it, expect } from "vitest";
import type { BranchCondition } from "../types/action";
import {
  getBranchConditionText,
  isStructuredCondition,
  isTryCatchCondition,
} from "./branchCondition";

describe("getBranchConditionText", () => {
  it("string はそのまま返す", () => {
    expect(getBranchConditionText("@x > 0")).toBe("@x > 0");
  });

  it("tryCatch variant は catch 記法の文字列に変換", () => {
    const cond: BranchCondition = { kind: "tryCatch", errorCode: "STOCK_SHORTAGE" };
    expect(getBranchConditionText(cond)).toBe("catch STOCK_SHORTAGE");
  });

  it("tryCatch variant に description があれば併記", () => {
    const cond: BranchCondition = {
      kind: "tryCatch",
      errorCode: "STOCK_SHORTAGE",
      description: "在庫不足で TX rollback",
    };
    expect(getBranchConditionText(cond)).toBe("catch STOCK_SHORTAGE (在庫不足で TX rollback)");
  });

  it("undefined は空文字列", () => {
    expect(getBranchConditionText(undefined)).toBe("");
  });
});

describe("isTryCatchCondition", () => {
  it("string は false", () => {
    expect(isTryCatchCondition("text")).toBe(false);
  });

  it("tryCatch variant は true", () => {
    expect(isTryCatchCondition({ kind: "tryCatch", errorCode: "X" })).toBe(true);
  });

  it("undefined は false", () => {
    expect(isTryCatchCondition(undefined)).toBe(false);
  });
});

describe("isStructuredCondition", () => {
  it("string は false (構造化でない)", () => {
    expect(isStructuredCondition("anything")).toBe(false);
  });

  it("variant は true", () => {
    expect(isStructuredCondition({ kind: "tryCatch", errorCode: "X" })).toBe(true);
  });

  it("undefined は false", () => {
    expect(isStructuredCondition(undefined)).toBe(false);
  });
});

describe("BranchCondition union の典型運用", () => {
  it("TX 失敗時の branch 定義 (StockShortageError catch)", () => {
    const cond: BranchCondition = {
      kind: "tryCatch",
      errorCode: "STOCK_SHORTAGE",
      description: "在庫不足",
    };
    expect(isTryCatchCondition(cond)).toBe(true);
    expect(getBranchConditionText(cond)).toContain("STOCK_SHORTAGE");
  });

  it("通常の式ベース分岐 (string)", () => {
    const cond: BranchCondition = "@shortageList.length > 0";
    expect(isStructuredCondition(cond)).toBe(false);
    expect(getBranchConditionText(cond)).toBe("@shortageList.length > 0");
  });
});
