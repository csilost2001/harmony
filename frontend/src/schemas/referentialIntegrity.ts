/**
 * 処理フロー JSON のクロスリファレンス検証 (#253)。
 *
 * JSON Schema 2020-12 では cross-reference (別フィールドに存在する値への参照検証) は
 * $dynamicRef を駆使しても読みにくくなるため、スキーマ外のバリデータとして実装する。
 *
 * 検証する観点:
 * 1. ReturnStep.responseId は action.responses[].id に存在すること
 * 2. ValidationStep.inlineBranch.ngResponseId は action.responses[].id に存在すること
 * 3. BranchConditionVariant.errorCode は context.catalogs.errors のキーに存在すること
 *    (context.catalogs.errors が定義されている場合のみ)
 * 4. DbAccessStep.affectedRowsCheck.errorCode も同上
 * 5. ErrorCatalogEntry.responseId は action.responses[].id に存在すること
 *    (context.catalogs.errors → responses の逆参照)
 */
import type { ProcessFlow, Step } from "../types/v3";
import type { LoadedExtensions } from "./loadExtensions";
import { isBuiltinStep } from "./stepGuards";

export interface IntegrityIssue {
  /** ドットパス (例: "actions[0].steps[2].responseRef") */
  path: string;
  /** 問題の識別子 */
  code:
    | "UNKNOWN_RESPONSE_REF"
    | "UNKNOWN_ERROR_CODE"
    | "UNKNOWN_SYSTEM_REF"
    | "UNKNOWN_TYPE_REF"
    | "UNKNOWN_SECRET_REF";
  /** 参照しようとした値 */
  value: string;
  /** エラーメッセージ */
  message: string;
}

/** @secret.KEY にマッチ */
const SECRET_RE = /@secret\.([a-zA-Z_][\w-]*)/g;

/** ProcessFlow 全体のクロスリファレンス検証。空配列なら OK */
export function checkReferentialIntegrity(
  group: ProcessFlow,
  extensions?: LoadedExtensions,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const errorCodes = new Set(Object.keys(group.context?.catalogs?.errors ?? {}));
  const hasErrorCatalog = errorCodes.size > 0;
  const systemIds = new Set(Object.keys(group.context?.catalogs?.externalSystems ?? {}));
  const hasSystemCatalog = systemIds.size > 0;
  const typeIds = new Set(Object.keys(extensions?.responseTypes ?? {}));
  const hasExtensions = extensions !== undefined && typeIds.size > 0;
  const secretKeys = new Set(Object.keys(group.context?.catalogs?.secrets ?? {}));
  const hasSecretsCatalog = secretKeys.size > 0;

  // context.catalogs.externalSystems.*.auth.tokenRef 内の @secret.* 参照を検査
  if (hasSecretsCatalog) {
    Object.entries(group.context?.catalogs?.externalSystems ?? {}).forEach(([k, entry]) => {
      const tok = entry.auth?.tokenRef;
      if (tok) {
        let m: RegExpExecArray | null;
        while ((m = SECRET_RE.exec(tok)) !== null) {
          if (!secretKeys.has(m[1])) {
            issues.push({
              path: `context.catalogs.externalSystems.${k}.auth.tokenRef`,
              code: "UNKNOWN_SECRET_REF",
              value: `@secret.${m[1]}`,
              message: `@secret.${m[1]} が context.catalogs.secrets に存在しません`,
            });
          }
        }
      }
    });
  }

  group.actions.forEach((action, ai) => {
    // r.id は v3 で LocalId brand 型のため、Set<string> として比較するため cast
    const responseIds = new Set<string>(
      (action.responses ?? [])
        .map((r) => r.id as string | undefined)
        .filter((x): x is string => !!x),
    );
    // bodySchema.typeRef の参照検査 (v3 BodySchema discriminated union: { typeRef } | { schema })
    (action.responses ?? []).forEach((resp, ri) => {
      const bs = resp.bodySchema;
      const typeRef =
        bs && typeof bs === "object" && "typeRef" in bs
          ? (bs as { typeRef?: string }).typeRef
          : undefined;
      if (typeRef && hasExtensions && !typeIds.has(typeRef)) {
        issues.push({
          path: `actions[${ai}].responses[${ri}].bodySchema.typeRef`,
          code: "UNKNOWN_TYPE_REF",
          value: typeRef,
          message: `bodySchema.typeRef "${typeRef}" がグローバル extensions responseTypes に存在しません`,
        });
      }
    });
    walkSteps(action.steps ?? [], `actions[${ai}].steps`, (step, path) => {
      checkStep(step, path, responseIds, errorCodes, hasErrorCatalog, systemIds, hasSystemCatalog, issues, secretKeys, hasSecretsCatalog);
    });

    // context.catalogs.errors -> responses 参照
    Object.entries(group.context?.catalogs?.errors ?? {}).forEach(([key, entry]) => {
      const ref = entry.responseId;
      if (ref && !responseIds.has(ref)) {
        issues.push({
          path: `context.catalogs.errors.${key}.responseId (actions[${ai}])`,
          code: "UNKNOWN_RESPONSE_REF",
          value: ref,
          message: `context.catalogs.errors.${key}.responseId "${ref}" が action "${action.name}" の responses[].id に存在しません`,
        });
      }
    });
  });

  return issues;
}

function walkSteps(
  steps: Step[],
  basePath: string,
  visit: (step: Step, path: string) => void,
): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    visit(step, path);
    // 拡張 step は nested 走査スキップ (固有プロパティは config 内に閉じる仕様)
    if (!isBuiltinStep(step)) return;
    // ネストした steps を持つ variant
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) => {
        walkSteps(b.steps, `${path}.branches[${bi}].steps`, visit);
      });
      if (step.elseBranch) {
        walkSteps(step.elseBranch.steps, `${path}.elseBranch.steps`, visit);
      }
    }
    if (step.kind === "loop") {
      walkSteps(step.steps, `${path}.steps`, visit);
    }
    if (step.kind === "transactionScope") {
      walkSteps(step.steps, `${path}.steps`, visit);
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, visit);
      if (step.onRollback) walkSteps(step.onRollback, `${path}.onRollback`, visit);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) {
          walkSteps(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, visit);
        }
      });
    }
  });
}

function checkStep(
  step: Step,
  path: string,
  responseIds: Set<string>,
  errorCodes: Set<string>,
  hasErrorCatalog: boolean,
  systemIds: Set<string>,
  hasSystemCatalog: boolean,
  issues: IntegrityIssue[],
  secretKeys?: Set<string>,
  hasSecretsCatalog?: boolean,
): void {
  // 拡張 step の固有 property は config に閉じるため、組み込み step に絞って検査
  if (!isBuiltinStep(step)) return;
  if (step.kind === "externalSystem" && step.systemRef && hasSystemCatalog) {
    // systemRef に @ を含む場合は動的式 (@identifier による切替) のためスキップ
    if (!step.systemRef.includes("@") && !systemIds.has(step.systemRef)) {
      issues.push({
        path: `${path}.systemRef`,
        code: "UNKNOWN_SYSTEM_REF",
        value: step.systemRef,
        message: `ExternalSystemStep.systemRef "${step.systemRef}" が context.catalogs.externalSystems に存在しません`,
      });
    }
  }
  // step 側 auth.tokenRef の @secret.* 参照を検査
  if (step.kind === "externalSystem" && step.auth?.tokenRef && hasSecretsCatalog && secretKeys) {
    const tok = step.auth.tokenRef;
    const re = /@secret\.([a-zA-Z_][\w-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tok)) !== null) {
      if (!secretKeys.has(m[1])) {
        issues.push({
          path: `${path}.auth.tokenRef`,
          code: "UNKNOWN_SECRET_REF",
          value: `@secret.${m[1]}`,
          message: `@secret.${m[1]} が context.catalogs.secrets に存在しません`,
        });
      }
    }
  }
  if (step.kind === "return") {
    const ref = step.responseId;
    if (ref && !responseIds.has(ref)) {
      issues.push({
        path: `${path}.responseId`,
        code: "UNKNOWN_RESPONSE_REF",
        value: ref,
        message: `ReturnStep.responseId "${ref}" が action.responses[].id に存在しません`,
      });
    }
  }
  if (step.kind === "validation" && step.inlineBranch) {
    const ref = step.inlineBranch.ngResponseId;
    if (ref && !responseIds.has(ref)) {
      issues.push({
        path: `${path}.inlineBranch.ngResponseId`,
        code: "UNKNOWN_RESPONSE_REF",
        value: ref,
        message: `ValidationStep.inlineBranch.ngResponseId "${ref}" が action.responses[].id に存在しません`,
      });
    }
  }
  if (step.kind === "dbAccess" && step.affectedRowsCheck?.errorCode && hasErrorCatalog) {
    const e = step.affectedRowsCheck.errorCode;
    if (!errorCodes.has(e)) {
      issues.push({
        path: `${path}.affectedRowsCheck.errorCode`,
        code: "UNKNOWN_ERROR_CODE",
        value: e,
        message: `DbAccessStep.affectedRowsCheck.errorCode "${e}" が context.catalogs.errors に存在しません`,
      });
    }
  }
  if (step.kind === "branch") {
    step.branches.forEach((b, bi) => {
      const c = b.condition;
      if (typeof c === "object" && c.kind === "tryCatch" && hasErrorCatalog) {
        if (!errorCodes.has(c.errorCode)) {
          issues.push({
            path: `${path}.branches[${bi}].condition.errorCode`,
            code: "UNKNOWN_ERROR_CODE",
            value: c.errorCode,
            message: `BranchConditionVariant.errorCode "${c.errorCode}" が context.catalogs.errors に存在しません`,
          });
        }
      }
    });
  }
  if (step.kind === "transactionScope" && step.rollbackOn && hasErrorCatalog) {
    step.rollbackOn.forEach((code, ci) => {
      if (!errorCodes.has(code)) {
        issues.push({
          path: `${path}.rollbackOn[${ci}]`,
          code: "UNKNOWN_ERROR_CODE",
          value: code,
          message: `TransactionScopeStep.rollbackOn[${ci}] "${code}" が context.catalogs.errors に存在しません`,
        });
      }
    });
  }
}
