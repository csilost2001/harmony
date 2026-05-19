import { describe, it, expect } from "vitest";
import type { BranchCondition, ErrorCode, ExpressionString } from "../types/v3";
import {
  getBranchConditionText,
  isStructuredCondition,
  isTryCatchCondition,
} from "./branchCondition";

// #1016 follow-up (2026-05-20): v3 では BranchCondition は discriminated union のみ
// (string 形式は v1/v2 で廃止)。expression 形式は { kind: "expression", expression: ... } で表現。

describe("getBranchConditionText", () => {
  it("expression variant は expression 文字列を返す", () => {
    const cond: BranchCondition = { kind: "expression", expression: "@x > 0" as ExpressionString };
    expect(getBranchConditionText(cond)).toBe("@x > 0");
  });

  it("tryCatch variant は catch 記法の文字列に変換", () => {
    const cond: BranchCondition = { kind: "tryCatch", errorCode: "STOCK_SHORTAGE" as ErrorCode };
    expect(getBranchConditionText(cond)).toBe("catch STOCK_SHORTAGE");
  });

  it("tryCatch variant に description があれば併記", () => {
    const cond: BranchCondition = {
      kind: "tryCatch",
      errorCode: "STOCK_SHORTAGE" as ErrorCode,
      description: "在庫不足で TX rollback",
    };
    expect(getBranchConditionText(cond)).toBe("catch STOCK_SHORTAGE (在庫不足で TX rollback)");
  });

  it("undefined は空文字列", () => {
    expect(getBranchConditionText(undefined)).toBe("");
  });
});

describe("isTryCatchCondition", () => {
  it("expression variant は false", () => {
    const cond: BranchCondition = { kind: "expression", expression: "@x" as ExpressionString };
    expect(isTryCatchCondition(cond)).toBe(false);
  });

  it("tryCatch variant は true", () => {
    expect(isTryCatchCondition({ kind: "tryCatch", errorCode: "X" as ErrorCode })).toBe(true);
  });

  it("undefined は false", () => {
    expect(isTryCatchCondition(undefined)).toBe(false);
  });
});

describe("isStructuredCondition", () => {
  it("expression variant は true (構造化された discriminated union)", () => {
    const cond: BranchCondition = { kind: "expression", expression: "anything" as ExpressionString };
    expect(isStructuredCondition(cond)).toBe(true);
  });

  it("variant は true", () => {
    expect(isStructuredCondition({ kind: "tryCatch", errorCode: "X" as ErrorCode })).toBe(true);
  });

  it("undefined は false", () => {
    expect(isStructuredCondition(undefined)).toBe(false);
  });
});

describe("BranchCondition union の典型運用", () => {
  it("TX 失敗時の branch 定義 (StockShortageError catch)", () => {
    const cond: BranchCondition = {
      kind: "tryCatch",
      errorCode: "STOCK_SHORTAGE" as ErrorCode,
      description: "在庫不足",
    };
    expect(isTryCatchCondition(cond)).toBe(true);
    expect(getBranchConditionText(cond)).toContain("STOCK_SHORTAGE");
  });

  it("通常の式ベース分岐 (expression variant)", () => {
    const cond: BranchCondition = {
      kind: "expression",
      expression: "@shortageList.length > 0" as ExpressionString,
    };
    expect(isStructuredCondition(cond)).toBe(true);
    expect(getBranchConditionText(cond)).toBe("@shortageList.length > 0");
  });
});
