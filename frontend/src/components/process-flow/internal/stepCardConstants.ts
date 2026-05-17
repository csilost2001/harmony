import type { DbOperation, StepType } from "../../../types/action";

/**
 * ProcessFlowEditor のパレット (toolbar) に表示する全 step kind。
 * 元: components/process-flow/ProcessFlowEditor.tsx (#1145 Phase-3 で分離)。
 * v3 schema 全 kind (componentCall / aiCall / aiAgent 含む) を登録 (#1145 完遂 follow-up)。
 */
export const ALL_STEP_TYPES: StepType[] = [
  "validation",
  "dbAccess",
  "externalSystem",
  "componentCall",
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
  "aiCall",
  "aiAgent",
];

/**
 * StepCard のサブステップ追加メニューに表示する全 step kind。
 * 元: components/process-flow/StepCard.tsx (#1145 で分離)
 */
export const ALL_SUB_STEP_TYPES: StepType[] = [
  "validation",
  "dbAccess",
  "externalSystem",
  "componentCall",
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
  "aiCall",
  "aiAgent",
];

/** DB 操作の選択肢。元: StepCard.tsx (#1145) */
export const DB_OPS: DbOperation[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** 空白だけの入力を undefined に丸める。元: StepCard.tsx (#1145) */
export const trimToUndefined = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};
