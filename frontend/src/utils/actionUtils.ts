/**
 * actionUtils.ts
 * 処理フローの自動採番・ジャンプ参照解決ユーティリティ
 */
import type { Step } from "../types/action";

/**
 * ステップの表示ラベルを生成（1, 2, 3... / 1-1, 1-2...）
 */
export function getStepLabel(stepIndex: number, subStepIndex?: number): string {
  const major = stepIndex + 1;
  if (subStepIndex === undefined) return `${major}`;
  return `${major}-${subStepIndex + 1}`;
}

/**
 * ステップIDから表示ラベルを解決するマップを作成
 */
export function buildStepLabelMap(steps: Step[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    map.set(step.id, getStepLabel(i));
    if (step.subSteps) {
      for (let j = 0; j < step.subSteps.length; j++) {
        map.set(step.subSteps[j].id, getStepLabel(i, j));
      }
    }
  }
  return map;
}

/**
 * ジャンプ参照先のラベルを解決
 */
export function resolveJumpLabel(
  jumpTo: string,
  steps: Step[],
): string {
  const labelMap = buildStepLabelMap(steps);
  return labelMap.get(jumpTo) ?? "?";
}

/**
 * ステップ配列を再帰的に走査（subSteps・branches[].steps・elseBranch.steps・loop.steps を含む）
 */
function walkSteps(steps: Step[], visit: (step: Step) => void): void {
  for (const step of steps) {
    visit(step);
    if (step.subSteps) walkSteps(step.subSteps, visit);
    if (step.kind === "branch") {
      for (const br of step.branches) walkSteps(br.steps, visit);
      if (step.elseBranch) walkSteps(step.elseBranch.steps, visit);
    }
    if (step.kind === "loop") walkSteps(step.steps, visit);
    if (step.kind === "transactionScope") {
      walkSteps(step.steps, visit);
      if (step.onCommit) walkSteps(step.onCommit, visit);
      if (step.onRollback) walkSteps(step.onRollback, visit);
    }
  }
}

/**
 * ステップ内のジャンプ参照を更新
 * oldId → newId に置換
 */
export function updateJumpReferences(
  steps: Step[],
  oldId: string,
  newId: string,
): void {
  walkSteps(steps, (step) => {
    if (step.kind === "jump" && step.jumpTo === oldId) {
      step.jumpTo = newId;
    }
    if (step.kind === "validation" && step.inlineBranch?.ngJumpTo === oldId) {
      step.inlineBranch.ngJumpTo = newId;
    }
  });
}

/**
 * 削除されたステップへのジャンプ参照をクリア
 */
export function clearJumpReferences(steps: Step[], deletedId: string): void {
  walkSteps(steps, (step) => {
    if (step.kind === "jump" && step.jumpTo === deletedId) {
      step.jumpTo = "";
    }
    if (step.kind === "validation" && step.inlineBranch?.ngJumpTo === deletedId) {
      step.inlineBranch.ngJumpTo = undefined;
    }
  });
}

/**
 * ステップ一覧からジャンプ先候補を取得（自分自身は除く）
 */
export function getJumpTargetOptions(
  steps: Step[],
  excludeStepId: string,
): { id: string; label: string; description: string }[] {
  const labelMap = buildStepLabelMap(steps);
  const options: { id: string; label: string; description: string }[] = [];
  for (const step of steps) {
    if (step.id === excludeStepId) continue;
    options.push({
      id: step.id,
      label: `[${labelMap.get(step.id) ?? "?"}]`,
      description: step.description || step.kind,
    });
  }
  return options;
}
