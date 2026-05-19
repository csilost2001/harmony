/**
 * outputBinding.ts
 * Step.outputBinding を扱うヘルパー。
 *
 * docs/spec, #151 (B)
 * #1016 follow-up (2026-05-20): v3 strict 整合 — string 形式 (v1/v2 短縮形) の OutputBinding を廃止、
 * object 形式 (`{ name, operation? }`) のみ扱う。
 */
import type { OutputBinding } from "../types/v3";

type OutputBindingOperation = "assign" | "accumulate" | "push";

/** outputBinding の変数名を取得 (v3: object 形式の .name のみ、空白は undefined 扱い) */
export function getBindingName(ob: OutputBinding | undefined): string | undefined {
  if (ob == null) return undefined;
  return ob.name.trim() || undefined;
}

/** outputBinding の代入方式を取得 (未指定時は "assign" 既定) */
export function getBindingOperation(
  ob: OutputBinding | undefined,
): OutputBindingOperation {
  if (ob == null) return "assign";
  return ob.operation ?? "assign";
}

/** 型ガード: 構造化された OutputBinding か (v3 では string 形式廃止、object のみ) */
export function isStructuredBinding(
  ob: OutputBinding | undefined,
): ob is OutputBinding {
  return ob != null;
}
