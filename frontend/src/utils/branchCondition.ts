// @ts-nocheck
/**
 * branchCondition.ts
 * Branch.condition の union (string | BranchConditionVariant) を扱うヘルパー。
 *
 * docs/spec, #151 (B) / #176
 */
import type { BranchCondition, BranchConditionVariant } from "../types/action";

/** condition を人間可読な文字列に変換 (UI 表示・description ログ用) */
export function getBranchConditionText(cond: BranchCondition | undefined): string {
  if (cond == null) return "";
  if (typeof cond === "string") return cond;
  switch (cond.kind) {
    case "tryCatch":
      return `catch ${cond.errorCode}${cond.description ? ` (${cond.description})` : ""}`;
    default:
      return "";
  }
}

/** 型ガード: tryCatch variant か */
export function isTryCatchCondition(
  cond: BranchCondition | undefined,
): cond is Extract<BranchConditionVariant, { kind: "tryCatch" }> {
  return cond != null && typeof cond === "object" && (cond as BranchConditionVariant).kind === "tryCatch";
}

/** 型ガード: 構造化された variant か (string でないか) */
export function isStructuredCondition(
  cond: BranchCondition | undefined,
): cond is BranchConditionVariant {
  return cond != null && typeof cond === "object";
}
