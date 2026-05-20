import type { Step } from "../../../types/v3";
// #1186 Phase 2-D: constants は processFlowMetadata から
import { DB_OPERATION_LABELS, WORKFLOW_PATTERN_LABELS } from "../../../utils/processFlowMetadata";
import { resolveJumpLabel, isExtensionStep } from "../../../utils/actionUtils";
import { getBranchConditionText } from "../../../utils/branchCondition";

/**
 * StepCard の summary 表示文字列を生成。
 * 元: components/process-flow/StepCard.tsx の summaryText() (#1145 で分離)
 */
export function stepSummaryText(step: Step, allSteps: Step[]): string {
  if (isExtensionStep(step)) return step.description || "拡張ステップ";
  switch (step.kind) {
    case "validation":
      return step.conditions || step.description || "バリデーション";
    case "dbAccess":
      return `${step.tableId || "?"} ${DB_OPERATION_LABELS[step.operation] ?? step.operation}${step.description ? ` - ${step.description}` : ""}`;
    case "externalSystem":
      // silent bug: step.protocol は v3 schema に存在しない (#1233)
      return `${step.systemRef || "?"}${step.httpCall?.method ? ` (${step.httpCall.method})` : ""}${step.description ? ` - ${step.description}` : ""}`;
    case "commonProcess":
      return step.refId || step.description || "共通処理";
    case "screenTransition":
      return `${step.targetScreenId || "?"}${step.description ? ` - ${step.description}` : ""}`;
    case "displayUpdate":
      return step.target || step.description || "表示更新";
    case "branch":
      return step.description || getBranchConditionText(step.branches[0]?.condition) || "条件分岐";
    case "loop":
      if (step.loopKind === "count") return step.countExpression || step.description || "ループ";
      if (step.loopKind === "condition") return step.conditionExpression || step.description || "ループ";
      return `${step.collectionSource || "コレクション"}${step.collectionItemName ? ` [${step.collectionItemName}]` : ""}`;
    case "loopBreak":
      return step.description || "ループ終了";
    case "loopContinue":
      return step.description || "次のループへ";
    case "jump": {
      const jumpLabel = resolveJumpLabel(step.jumpTo, allSteps);
      return `[${jumpLabel}] へ${step.description ? ` - ${step.description}` : ""}`;
    }
    case "workflow":
      return `${WORKFLOW_PATTERN_LABELS[step.pattern]} / 承認者 ${step.approvers.length}件${step.description ? ` - ${step.description}` : ""}`;
    case "transactionScope": {
      const n = step.steps.length;
      const iso = step.isolationLevel ?? "READ_COMMITTED";
      return `TX (${iso}, ${n} ステップ)${step.description ? ` - ${step.description}` : ""}`;
    }
    default:
      return step.description || "その他";
  }
}
