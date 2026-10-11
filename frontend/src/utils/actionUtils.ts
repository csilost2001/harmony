/**
 * actionUtils.ts
 * 処理フローの自動採番・ジャンプ参照解決ユーティリティ
 */
import type {
  Step,
  BranchStep,
  LoopStep,
  TransactionScopeStep,
  JumpStep,
  ValidationStep,
  ExtensionStep,
  LocalId,
} from "../types/v3";

// ── Type guards ─────────────────────────────────────────────────────────

export function isBranchStep(step: Step): step is BranchStep {
  return step.kind === "branch";
}

export function isLoopStep(step: Step): step is LoopStep {
  return step.kind === "loop";
}

export function isTransactionScopeStep(step: Step): step is TransactionScopeStep {
  return step.kind === "transactionScope";
}

export function isJumpStep(step: Step): step is JumpStep {
  return step.kind === "jump";
}

export function isValidationStep(step: Step): step is ValidationStep {
  return step.kind === "validation";
}

/**
 * ExtensionStep は kind が "namespace:StepName" pattern (例: "retail:OrderConfirmStep")。
 * 組み込み 25 種の kind (#1322 Phase B-3e で setGlobal 追加) には ":" を含むものは存在しないため、判定として安全。
 * 将来 built-in kind に ":" を含むものが追加された場合、本判定を見直すこと。
 */
export function isExtensionStep(s: Step): s is ExtensionStep {
  return typeof s.kind === "string" && s.kind.includes(":");
}

/**
 * subSteps は StepBaseProps の共通項目 (docs/spec/process-flow-substeps.md)。
 * 既存コードが使う別名として残している (Step と同じ)。
 */
export type StepWithSubSteps = Step & { subSteps?: Step[] };

/**
 * ステップの表示ラベルを生成（1, 2, 3... / 1-1, 1-2...）
 */
export function getStepLabel(stepIndex: number, subStepIndex?: number): string {
  const major = stepIndex + 1;
  if (subStepIndex === undefined) return `${major}`;
  return `${major}-S-${subStepIndex + 1}`;
}

/**
 * ステップIDから表示ラベルを解決するマップを作成
 */
export function buildStepLabelMap(steps: Step[]): Map<string, string> {
  const map = new Map<string, string>();
  // 配下の工程 (subSteps) は、親の番号に「-S-n」を続ける (1 → 1-S-1 → 1-S-1-S-1)。繰り返しなどの本体の番号 (1-1) とは混ざらない。設計書の番号と同じ
  const walk = (list: Step[], prefix: string) => {
    list.forEach((step, i) => {
      const label = prefix ? `${prefix}-S-${i + 1}` : String(i + 1);
      map.set(step.id, label);
      if (step.subSteps?.length) walk(step.subSteps, label);
    });
  };
  walk(steps, "");
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
    const s = step as StepWithSubSteps;
    if (s.subSteps) walkSteps(s.subSteps, visit);
    if (isBranchStep(step)) {
      for (const br of step.branches) walkSteps(br.steps, visit);
      if (step.elseBranch) walkSteps(step.elseBranch.steps, visit);
    }
    if (isLoopStep(step)) walkSteps(step.steps, visit);
    if (isTransactionScopeStep(step)) {
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
    if (isJumpStep(step) && step.jumpTo === oldId) {
      step.jumpTo = newId as LocalId;
    }
    if (isValidationStep(step) && step.inlineBranch?.ngJumpTo === oldId) {
      step.inlineBranch.ngJumpTo = newId as LocalId;
    }
  });
}

/**
 * 削除されたステップへのジャンプ参照をクリア
 */
export function clearJumpReferences(steps: Step[], deletedId: string): void {
  walkSteps(steps, (step) => {
    if (isJumpStep(step) && step.jumpTo === deletedId) {
      step.jumpTo = "" as LocalId;
    }
    if (isValidationStep(step) && step.inlineBranch?.ngJumpTo === deletedId) {
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
