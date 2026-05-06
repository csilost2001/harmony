/**
 * Step union 型 guard helper。
 *
 * v3 schema の `Step` union は組み込み 21 variant + ExtensionStep の計 22 variant。
 * ExtensionStep は `kind: string` (namespace:Name 形式) のため、構造的サブタイピング下で
 * `Exclude<Step, ExtensionStep>` は never に潰れてしまう。
 * 代わりに、組み込み kind の literal union を `Extract<Step, { kind: BuiltinStepKind }>` で
 * 取り出して narrow する。
 *
 * 拡張 step の固有 property は config 内に閉じる仕様 (process-flow.v3.schema §extensionStep) のため、
 * フレームワーク横断 validator は組み込み step に対してのみ structural な検査を行う。
 */
import type { Step } from "../types/v3";

export const BUILTIN_STEP_KINDS = [
  "validation",
  "dbAccess",
  "externalSystem",
  "commonProcess",
  "screenTransition",
  "displayUpdate",
  "branch",
  "loop",
  "loopBreak",
  "loopContinue",
  "jump",
  "compute",
  "return",
  "log",
  "audit",
  "workflow",
  "transactionScope",
  "eventPublish",
  "eventSubscribe",
  "closing",
  "cdc",
] as const;

export type BuiltinStepKind = typeof BUILTIN_STEP_KINDS[number];
export type BuiltinStep = Extract<Step, { kind: BuiltinStepKind }>;

export function isBuiltinStep(s: Step): s is BuiltinStep {
  return (BUILTIN_STEP_KINDS as readonly string[]).includes(s.kind);
}
