/**
 * ProcessFlow に対する全バリデータの集約 (#261 UI 統合)。
 *
 * validateProcessFlow (既存の構造ルール) に加え、以下の scheme-external バリデータを統合:
 * - checkReferentialIntegrity (responseRef / errorCode / systemRef / typeRef / secretRef)
 * - checkIdentifierScopes (@identifier が inputs/outputBinding/ambient/loop item に存在)
 *
 * SQL 列検査 (要 TableDefinition) と conventions 検査 (要 conventions-catalog) は
 * 依存データが必要なため optional パラメータで受け取る。未指定時は skip。
 */
import type { ProcessFlow, Step } from "../types/v3";
import { validateProcessFlow, type ValidationError } from "./actionValidation";
import { checkReferentialIntegrity } from "../schemas/referentialIntegrity";
import { checkIdentifierScopes } from "../schemas/identifierScope";
import { checkSqlColumns, type TableDefinition } from "../schemas/sqlColumnValidator";
import { checkConventionReferences, type ConventionsCatalog } from "../schemas/conventionsValidator";
import { isBuiltinStep } from "../schemas/stepGuards";
import type { LoadedExtensions } from "../schemas/loadExtensions";

export interface AggregatedValidationOptions {
  /** テーブル定義。渡された場合は DbAccessStep.sql の列参照を検査 */
  tables?: TableDefinition[];
  /** 規約カタログ。渡された場合は @conv.* 参照を検査 */
  conventions?: ConventionsCatalog | null;
  extensions?: LoadedExtensions;
}

/**
 * ProcessFlow に対する全バリデータを実行し、ValidationError[] 形式で返す。
 * 構造的エラー (validateProcessFlow) は既存の severity を維持、
 * scheme-external issues は全て severity="warning" として扱う。
 */
export function aggregateValidation(
  group: ProcessFlow,
  options: AggregatedValidationOptions = {},
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. 既存の構造バリデータ (loopBreak スコープ、branch 空 等)
  errors.push(...validateProcessFlow(group));

  // 2. 参照整合性 (responseId / errorCode / systemRef / typeRef / secretRef)
  for (const issue of checkReferentialIntegrity(group, options.extensions)) {
    errors.push({
      stepId: stepIdFromPath(issue.path, group) ?? "",
      severity: "warning",
      message: issue.message,
      path: issue.path,
      code: issue.code,
    });
  }

  // 3. 識別子スコープ (@identifier)
  for (const issue of checkIdentifierScopes(group)) {
    errors.push({
      stepId: stepIdFromPath(issue.path, group) ?? "",
      severity: "warning",
      message: issue.message,
      path: issue.path,
      code: issue.code,
    });
  }

  // 4. SQL 列検査 (tables 提供時のみ)
  if (options.tables && options.tables.length > 0) {
    for (const issue of checkSqlColumns(group, options.tables)) {
      errors.push({
        stepId: stepIdFromPath(issue.path, group) ?? "",
        severity: "warning",
        message: issue.message,
        path: issue.path,
        code: issue.code,
      });
    }
  }

  // 5. @conv.* 参照 (catalog 提供時のみ)
  if (options.conventions) {
    for (const issue of checkConventionReferences(group, options.conventions)) {
      errors.push({
        stepId: stepIdFromPath(issue.path, group) ?? "",
        severity: "warning",
        message: issue.message,
        path: issue.path,
        code: issue.code,
      });
    }
  }

  return errors;
}

/**
 * JSON path ("actions[0].steps[2]..." 等) から該当 step の ID を解決。
 * 深くネストしたパス (branches / elseBranch / loop / transactionScope / sideEffects) も辿る。
 * 解決できない場合 (catalog レベルの issue 等) は null。
 */
function stepIdFromPath(path: string, group: ProcessFlow): string | null {
  const m = path.match(/^actions\[(\d+)\]\.steps\[(\d+)\]/);
  if (!m) return null;
  const action = group.actions[+m[1]];
  if (!action) return null;
  const topStep = action.steps[+m[2]];
  if (!topStep) return null;

  let currentStep: Step = topStep;
  let rest = path.slice(m[0].length);

  // ネストしたセグメントを順次辿る
  // 例: ".branches[0].steps[1].outcomes.failure.sideEffects[0]"
  const segmentRe = /^(?:\.branches\[(\d+)\]\.steps\[(\d+)\]|\.elseBranch\.steps\[(\d+)\]|\.steps\[(\d+)\]|\.outcomes\.(success|failure|timeout)\.sideEffects\[(\d+)\])/;

  while (true) {
    const sm = rest.match(segmentRe);
    if (!sm) break;
    if (sm[1] !== undefined && sm[2] !== undefined) {
      if (!isBuiltinStep(currentStep) || currentStep.kind !== "branch") return currentStep.id;
      const branch = currentStep.branches[+sm[1]];
      if (!branch) return currentStep.id;
      const next = branch.steps[+sm[2]];
      if (!next) return currentStep.id;
      currentStep = next;
    } else if (sm[3] !== undefined) {
      if (!isBuiltinStep(currentStep) || currentStep.kind !== "branch" || !currentStep.elseBranch) return currentStep.id;
      const next = currentStep.elseBranch.steps[+sm[3]];
      if (!next) return currentStep.id;
      currentStep = next;
    } else if (sm[4] !== undefined) {
      // .steps[N]: loop / transactionScope の nested steps
      if (!isBuiltinStep(currentStep)) return currentStep.id;
      if (currentStep.kind === "loop" || currentStep.kind === "transactionScope") {
        const next = currentStep.steps[+sm[4]];
        if (!next) return currentStep.id;
        currentStep = next;
      } else {
        return currentStep.id;
      }
    } else if (sm[5] !== undefined && sm[6] !== undefined) {
      if (!isBuiltinStep(currentStep) || currentStep.kind !== "externalSystem") return currentStep.id;
      const outcome = currentStep.outcomes?.[sm[5] as "success" | "failure" | "timeout"];
      if (!outcome?.sideEffects) return currentStep.id;
      const next = outcome.sideEffects[+sm[6]];
      if (!next) return currentStep.id;
      currentStep = next;
    }
    rest = rest.slice(sm[0].length);
  }

  return currentStep.id as string;
}
