import type { DbOperation, StepType } from "../../../types/action";

/**
 * StepCard のサブステップ追加メニューに表示する全 step kind。
 * 元: components/process-flow/StepCard.tsx (#1145 で分離)
 */
export const ALL_SUB_STEP_TYPES: StepType[] = [
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
  "other",
  "log",
  "audit",
  "workflow",
  "transactionScope",
  "eventPublish",
  "eventSubscribe",
  "closing",
  "cdc",
];

/** DB 操作の選択肢。元: StepCard.tsx (#1145) */
export const DB_OPS: DbOperation[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** 空白だけの入力を undefined に丸める。元: StepCard.tsx (#1145) */
export const trimToUndefined = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};
