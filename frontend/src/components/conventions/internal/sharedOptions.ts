/**
 * Conventions catalog editor — 共通 option 配列 (#1145 Phase-5)
 *
 * Category panel 横断で使う select の選択肢。Phase-5 前は ConventionsCatalogView.tsx 内に
 * inline 定義されていた。
 */
import type { ExternalOutcomeEntry } from "../../../types/v3";

export const ROUNDING_OPTIONS = ["", "floor", "ceil", "round"] as const;

export const SCOPE_OPTIONS = ["", "all", "own", "department"] as const;

export const OUTCOME_OPTIONS: ExternalOutcomeEntry["outcome"][] = [
  "success",
  "failure",
  "timeout",
];

export const ACTION_OPTIONS: ExternalOutcomeEntry["action"][] = [
  "continue",
  "abort",
  "compensate",
];

export const RETRY_OPTIONS = ["", "none", "fixed", "exponential"] as const;
