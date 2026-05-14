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
 * 6. ComponentCallStep.componentRef は Generic Definition Catalog (#1090):
 *    `generic-definitions/component-definition/<Name>` の <Name> が catalog に存在すること
 * 7. ErrorCatalogEntry.exceptionTypeRef / ValidationRule.exceptionTypeRef も同様に
 *    `generic-definitions/exception-type/<Name>` の <Name> が catalog に存在すること
 */
import type { ProcessFlow, Step, ValidationRule } from "../types/v3";
import type { LoadedExtensions } from "./loadExtensions";
import { mergeCatalogsForFlow, type ProjectCatalogs } from "./projectCatalogs";
import { isBuiltinStep } from "./stepGuards";

/**
 * Generic Definition Catalog 参照検証で使う name set (kind 別、#1090)。
 * 渡された kind の Set が undefined の場合、その kind の参照は検証しない (catalog がロード
 * できなかったケースに silent pass させる)。空 Set を渡せば「何も catalog に存在しない」
 * 状態として検証される。
 */
export interface GenericDefinitionNames {
  "component-definition"?: Set<string>;
  "exception-type"?: Set<string>;
  // ui-fragment は Screen 側で扱うため本ファイルには含めない (#1090 Phase 2 で追加予定)
}

export interface IntegrityIssue {
  /** ドットパス (例: "actions[0].steps[2].responseRef") */
  path: string;
  /** 問題の識別子 */
  code:
    | "UNKNOWN_RESPONSE_REF"
    | "UNKNOWN_ERROR_CODE"
    | "UNKNOWN_SYSTEM_REF"
    | "UNKNOWN_TYPE_REF"
    | "UNKNOWN_SECRET_REF"
    | "UNKNOWN_MODEL_REF"
    | "UNKNOWN_COMPONENT_REF"
    | "UNKNOWN_EXCEPTION_TYPE_REF";
  /** 参照しようとした値 */
  value: string;
  /** エラーメッセージ */
  message: string;
}

/**
 * `generic-definitions/<kind>/<Name>` 形式の参照から <Name> 部を抽出する (#1090)。
 * AJV pattern gate で形式は担保される前提だが、防御的に regex 一致を確認する。
 * 形式不一致の場合は null (= AJV 側で error 報告される領域なので本検証は skip)。
 */
function extractGenericDefName(
  ref: string,
  kind: "component-definition" | "exception-type",
): string | null {
  const re = new RegExp(`^generic-definitions/${kind}/([A-Za-z][A-Za-z0-9_]*)$`);
  const m = ref.match(re);
  return m ? m[1] : null;
}

/** @secret.KEY にマッチ */
const SECRET_RE = /@secret\.([a-zA-Z_][\w-]*)/g;

/** ProcessFlow 全体のクロスリファレンス検証。空配列なら OK */
export function checkReferentialIntegrity(
  group: ProcessFlow,
  extensions?: LoadedExtensions,
  projectCatalogs?: ProjectCatalogs,
  genericDefinitionNames?: GenericDefinitionNames,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  // #939 提案 C: project-level catalogs と flow-level catalogs を merge する。
  // flow-level が同名キーで override する semantics。
  const merged = mergeCatalogsForFlow(group, projectCatalogs);
  const errorCodes = new Set(Object.keys(group.context?.catalogs?.errors ?? {}));
  const hasErrorCatalog = errorCodes.size > 0;
  const systemIds = new Set(Object.keys(merged.externalSystems ?? {}));
  const hasSystemCatalog = systemIds.size > 0;
  const typeIds = new Set(Object.keys(extensions?.responseTypes ?? {}));
  const hasExtensions = extensions !== undefined && typeIds.size > 0;
  const secretKeys = new Set(Object.keys(merged.secrets ?? {}));
  const hasSecretsCatalog = secretKeys.size > 0;
  const modelEndpointKeys = new Set(Object.keys(merged.modelEndpoints ?? {}));

  // externalSystems (merged: project + flow level).*.auth.tokenRef 内の @secret.* 参照を検査
  if (hasSecretsCatalog) {
    type ExtSysEntry = { auth?: { tokenRef?: string } };
    Object.entries(merged.externalSystems ?? {}).forEach(([k, rawEntry]) => {
      const entry = rawEntry as ExtSysEntry;
      const tok = entry.auth?.tokenRef;
      if (tok) {
        let m: RegExpExecArray | null;
        while ((m = SECRET_RE.exec(tok)) !== null) {
          if (!secretKeys.has(m[1])) {
            issues.push({
              path: `context.catalogs.externalSystems.${k}.auth.tokenRef`,
              code: "UNKNOWN_SECRET_REF",
              value: `@secret.${m[1]}`,
              message: `@secret.${m[1]} が secrets catalog (project + flow merged) に存在しません`,
            });
          }
        }
      }
    });
  }

  // 全 action の responseId を統合 (flow-level catalog 検査用、#1019 multi-action 対応)
  const allResponseIds = new Set<string>();
  group.actions.forEach((action) => {
    (action.responses ?? []).forEach((r) => {
      const id = r.id as string | undefined;
      if (id) allResponseIds.add(id);
    });
  });

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
      checkStep(step, path, responseIds, errorCodes, hasErrorCatalog, systemIds, hasSystemCatalog, issues, secretKeys, hasSecretsCatalog, genericDefinitionNames);
      checkAiModelRef(step, path, modelEndpointKeys, issues);
    });
  });

  // context.catalogs.errors -> responses 参照 (#1019: flow-level なのでいずれかの action に存在すれば OK)
  // + ErrorCatalogEntry.exceptionTypeRef -> generic-definitions/exception-type 参照 (#1090)
  const exceptionTypeNames = genericDefinitionNames?.["exception-type"];
  Object.entries(group.context?.catalogs?.errors ?? {}).forEach(([key, entry]) => {
    const ref = entry.responseId;
    if (ref && !allResponseIds.has(ref)) {
      issues.push({
        path: `context.catalogs.errors.${key}.responseId`,
        code: "UNKNOWN_RESPONSE_REF",
        value: ref,
        message: `context.catalogs.errors.${key}.responseId "${ref}" がいずれの action.responses[].id にも存在しません`,
      });
    }
    const excRef = entry.exceptionTypeRef;
    if (excRef && exceptionTypeNames) {
      const name = extractGenericDefName(excRef, "exception-type");
      if (name && !exceptionTypeNames.has(name)) {
        issues.push({
          path: `context.catalogs.errors.${key}.exceptionTypeRef`,
          code: "UNKNOWN_EXCEPTION_TYPE_REF",
          value: excRef,
          message: `context.catalogs.errors.${key}.exceptionTypeRef "${excRef}" の <Name> が generic-definitions/exception-type catalog に存在しません`,
        });
      }
    }
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
  genericDefinitionNames?: GenericDefinitionNames,
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

  // ComponentCallStep.componentRef → generic-definitions/component-definition (#1090)
  if (step.kind === "componentCall") {
    const componentNames = genericDefinitionNames?.["component-definition"];
    const ref = step.componentRef;
    if (ref && componentNames) {
      const name = extractGenericDefName(ref, "component-definition");
      if (name && !componentNames.has(name)) {
        issues.push({
          path: `${path}.componentRef`,
          code: "UNKNOWN_COMPONENT_REF",
          value: ref,
          message: `ComponentCallStep.componentRef "${ref}" の <Name> が generic-definitions/component-definition catalog に存在しません`,
        });
      }
    }
  }

  // ValidationStep.rules[].exceptionTypeRef → generic-definitions/exception-type (#1090)
  if (step.kind === "validation" && step.rules) {
    const exceptionTypeNames = genericDefinitionNames?.["exception-type"];
    if (exceptionTypeNames) {
      step.rules.forEach((rule: ValidationRule, ri: number) => {
        const ref = rule.exceptionTypeRef;
        if (ref) {
          const name = extractGenericDefName(ref, "exception-type");
          if (name && !exceptionTypeNames.has(name)) {
            issues.push({
              path: `${path}.rules[${ri}].exceptionTypeRef`,
              code: "UNKNOWN_EXCEPTION_TYPE_REF",
              value: ref,
              message: `ValidationStep.rules[${ri}].exceptionTypeRef "${ref}" の <Name> が generic-definitions/exception-type catalog に存在しません`,
            });
          }
        }
      });
    }
  }
}

// aiCall / aiAgent は v3 TypeScript Step union に未追加のため (stepGuards.ts の BUILTIN_STEP_KINDS を参照)、
// kind 判定は string 比較で行い modelRef を構造的に取り出す。schema 上は AiCallStep / AiAgentStep の
// 必須フィールドとして定義済み。
function checkAiModelRef(
  step: Step,
  path: string,
  modelEndpointKeys: Set<string>,
  issues: IntegrityIssue[],
): void {
  const s = step as { kind: string; modelRef?: string };
  if (s.kind !== "aiCall" && s.kind !== "aiAgent") return;
  if (!s.modelRef) return;
  if (modelEndpointKeys.has(s.modelRef)) return;
  issues.push({
    path: `${path}.modelRef`,
    code: "UNKNOWN_MODEL_REF",
    value: s.modelRef,
    message: `aiCall/aiAgent.modelRef "${s.modelRef}" が modelEndpoints catalog (project + flow merged) に存在しません`,
  });
}
