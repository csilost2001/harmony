import type { ProcessFlow, Step } from "../types/v3";
import { isBuiltinStep } from "../schemas/stepGuards";

export type ValidationSeverity = "error" | "warning";

export interface ValidationError {
  stepId: string;
  severity: ValidationSeverity;
  message: string;
  /** 追加バリデータ由来の JSON path (例: "actions[0].steps[2].sql") */
  path?: string;
  /** バリデータ固有のコード (例: "UNKNOWN_RESPONSE_REF", "UNKNOWN_IDENTIFIER") */
  code?: string;
}

function collectAllIds(steps: Step[], ids: Set<string>): void {
  for (const step of steps) {
    ids.add(step.id as string);
    if (!isBuiltinStep(step)) continue;
    if (step.kind === "branch") {
      for (const b of step.branches) collectAllIds(b.steps, ids);
      if (step.elseBranch) collectAllIds(step.elseBranch.steps, ids);
    }
    if (step.kind === "loop") collectAllIds(step.steps, ids);
    if (step.kind === "transactionScope") {
      collectAllIds(step.steps, ids);
      if (step.onCommit) collectAllIds(step.onCommit, ids);
      if (step.onRollback) collectAllIds(step.onRollback, ids);
    }
  }
}

function validateSteps(
  steps: Step[],
  loopDepth: number,
  errors: ValidationError[],
  allIds: Set<string>,
): void {
  for (const step of steps) {
    if (!isBuiltinStep(step)) continue;
    switch (step.kind) {
      case "loopBreak":
      case "loopContinue":
        if (loopDepth === 0) {
          errors.push({
            stepId: step.id as string,
            severity: "error",
            message: step.kind === "loopBreak"
              ? "ループ終了 はループの中にのみ置けます"
              : "次のループへ はループの中にのみ置けます",
          });
        }
        break;
      case "branch":
        if (step.branches.length === 0) {
          errors.push({ stepId: step.id as string, severity: "error", message: "分岐が1つもありません" });
        }
        for (const b of step.branches) validateSteps(b.steps, loopDepth, errors, allIds);
        if (step.elseBranch) validateSteps(step.elseBranch.steps, loopDepth, errors, allIds);
        break;
      case "loop":
        if (step.loopKind === "condition" && !step.conditionExpression) {
          errors.push({ stepId: step.id as string, severity: "warning", message: "条件式が未入力です" });
        }
        if (step.loopKind === "collection" && !step.collectionSource) {
          errors.push({ stepId: step.id as string, severity: "warning", message: "コレクションが未入力です" });
        }
        validateSteps(step.steps, loopDepth + 1, errors, allIds);
        break;
      case "transactionScope":
        if (step.steps.length === 0) {
          errors.push({ stepId: step.id as string, severity: "warning", message: "TX スコープに 1 つ以上のステップを配置してください" });
        }
        validateSteps(step.steps, loopDepth, errors, allIds);
        if (step.onCommit) validateSteps(step.onCommit, loopDepth, errors, allIds);
        if (step.onRollback) validateSteps(step.onRollback, loopDepth, errors, allIds);
        break;
      case "jump":
        if (!step.jumpTo) {
          errors.push({ stepId: step.id as string, severity: "warning", message: "ジャンプ先が未設定です" });
        } else if (!allIds.has(step.jumpTo as string)) {
          errors.push({ stepId: step.id as string, severity: "warning", message: "ジャンプ先が見つかりません" });
        }
        break;
    }
  }
}

export function validateProcessFlow(group: ProcessFlow): ValidationError[] {
  const allIds = new Set<string>();
  for (const action of group.actions) collectAllIds(action.steps, allIds);

  const errors: ValidationError[] = [];
  for (const action of group.actions) validateSteps(action.steps, 0, errors, allIds);
  return errors;
}

export function hasBlockingErrors(errors: ValidationError[]): boolean {
  return errors.some((e) => e.severity === "error");
}
