/**
 * branchCondition.ts
 * Branch.condition (BranchCondition discriminated union) を扱うヘルパー。
 *
 * docs/spec, #151 (B) / #176
 * #1016 follow-up (2026-05-20): v3 schema 整合化 — string 形式 (legacy v1/v2) サポート除去、
 * `BranchConditionVariant` 別 alias 廃止し `BranchCondition` 直接使用。
 */
import type { BranchCondition } from "../types/v3";

/** condition を人間可読な文字列に変換 (UI 表示・description ログ用) */
export function getBranchConditionText(cond: BranchCondition | undefined): string {
  if (cond == null) return "";
  switch (cond.kind) {
    case "expression":
      return cond.expression;
    case "tryCatch":
      return `catch ${cond.errorCode}${cond.description ? ` (${cond.description})` : ""}`;
    case "affectedRowsZero":
      return `affectedRowsZero${cond.stepId ? ` (@${cond.stepId})` : ""}`;
    case "externalOutcome":
      return `${cond.outcome}${cond.stepId ? ` (@${cond.stepId})` : ""}`;
    default:
      return "";
  }
}

/** 型ガード: tryCatch variant か */
export function isTryCatchCondition(
  cond: BranchCondition | undefined,
): cond is Extract<BranchCondition, { kind: "tryCatch" }> {
  return cond != null && cond.kind === "tryCatch";
}

/** 型ガード: 構造化された variant か (v3 では全て構造化、`null` でなければ true) */
export function isStructuredCondition(
  cond: BranchCondition | undefined,
): cond is BranchCondition {
  return cond != null;
}
