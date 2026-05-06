/**
 * outputBinding.ts
 * StepBase.outputBinding の union (string | OutputBindingObject) を透過的に扱うヘルパー。
 *
 * docs/spec, #151 (B)
 */
import type { OutputBinding, OutputBindingOperation } from "../types/action";

/** outputBinding の変数名を取得 (string 形式はそのまま、object 形式は .name) */
export function getBindingName(ob: OutputBinding | undefined): string | undefined {
  if (ob == null) return undefined;
  if (typeof ob === "string") return ob.trim() || undefined;
  return ob.name.trim() || undefined;
}

/** outputBinding の代入方式を取得 (未指定や string 形式は "assign" 既定) */
export function getBindingOperation(
  ob: OutputBinding | undefined,
): OutputBindingOperation {
  if (ob == null) return "assign";
  if (typeof ob === "string") return "assign";
  return ob.operation ?? "assign";
}

/** 型ガード: object 形式か */
export function isStructuredBinding(
  ob: OutputBinding | undefined,
): ob is Exclude<OutputBinding, string> {
  return ob != null && typeof ob === "object";
}
