/**
 * genericDefinitionValidator.ts — Generic Definition Catalog の AJV バリデーション (#1079)
 *
 * draft-state-policy §6 に基づき、AJV で schema 検証 + kind 固有 semantic warning を提供する。
 * validateHarmony.ts のキャッシュパターンに倣い、singleton AJV + 初回呼び出し時 compile。
 *
 * #1263 Phase X2 (#1267 Opus Round 4 Should-fix #1): 全 17 kind に固有 schema が存在する。
 * #1310: global kind 追加 (全 18 kind)。
 * 旧 8 kind (data-contract / domain-type / exception-type / application-rule / ui-behavior /
 *   runtime-policy / ui-fragment) + 新 7 kind (component-definition / validation-rule /
 *   constants / message / domain-event / log-event / log-config) すべて KIND_SCHEMAS に登録。
 * #1303: 新 3 kind (dialog / message-area / options) を追加 (全 17 kind)。
 * #1310: global kind 追加 (全 18 kind)。
 * #1318: messageArea → message-area kebab-case 統一 (kind は kebab-case 統一規約、
 *   prefix `@messageArea.<name>` は log-event/logEvent 前例と同様に camelCase 維持)。
 */

import type Ajv2020 from "ajv/dist/2020";
import type { GenericDefinition, GenericDefinitionKind } from "../types/v3";
import { buildHarmonyAjv } from "../utils/buildHarmonyAjv";

import parentSchema from "../../../schemas/v3/generic-definition.v3.schema.json";
import dataContractSchema from "../../../schemas/v3/generic-definitions/data-contract.v3.schema.json";
import exceptionTypeSchema from "../../../schemas/v3/generic-definitions/exception-type.v3.schema.json";
import domainTypeSchema from "../../../schemas/v3/generic-definitions/domain-type.v3.schema.json";
import applicationRuleSchema from "../../../schemas/v3/generic-definitions/application-rule.v3.schema.json";
import uiBehaviorSchema from "../../../schemas/v3/generic-definitions/ui-behavior.v3.schema.json";
import runtimePolicySchema from "../../../schemas/v3/generic-definitions/runtime-policy.v3.schema.json";
import uiFragmentSchema from "../../../schemas/v3/generic-definitions/ui-fragment.v3.schema.json";
// #1263 Phase X2 — 7 新規 sub-schema
import componentDefinitionSchema from "../../../schemas/v3/generic-definitions/component-definition.v3.schema.json";
import validationRuleSchema from "../../../schemas/v3/generic-definitions/validation-rule.v3.schema.json";
import constantsSchema from "../../../schemas/v3/generic-definitions/constants.v3.schema.json";
import messageSchema from "../../../schemas/v3/generic-definitions/message.v3.schema.json";
import domainEventSchema from "../../../schemas/v3/generic-definitions/domain-event.v3.schema.json";
import logEventSchema from "../../../schemas/v3/generic-definitions/log-event.v3.schema.json";
import logConfigSchema from "../../../schemas/v3/generic-definitions/log-config.v3.schema.json";
// #1303 — 3 新規 sub-schema (dialog / message-area / options、#1318 で messageArea → message-area kebab-case 統一)
import dialogSchema from "../../../schemas/v3/generic-definitions/dialog.v3.schema.json";
import messageAreaSchema from "../../../schemas/v3/generic-definitions/message-area.v3.schema.json";
import optionsSchema from "../../../schemas/v3/generic-definitions/options.v3.schema.json";
// #1310 — global kind
import globalSchema from "../../../schemas/v3/generic-definitions/global.v3.schema.json";

export interface GenericDefinitionIssue {
  kind: GenericDefinitionKind;
  name: string;
  path: string;       // ex "fields[0].name", "purpose"
  message: string;
  severity: "error" | "warning";
}

// kind → 固有 schema の $id (#1263 Phase X2: 14 kind 全件 + #1303: 3 新規 kind = 全 17 kind + #1310: global = 全 18 kind)
const KIND_SCHEMAS: Partial<Record<GenericDefinitionKind, object>> = {
  "data-contract": dataContractSchema as object,
  "exception-type": exceptionTypeSchema as object,
  "domain-type": domainTypeSchema as object,
  "application-rule": applicationRuleSchema as object,
  "ui-behavior": uiBehaviorSchema as object,
  "runtime-policy": runtimePolicySchema as object,
  "ui-fragment": uiFragmentSchema as object,
  // #1263 Phase X2 — 7 新規 kind
  "component-definition": componentDefinitionSchema as object,
  "validation-rule": validationRuleSchema as object,
  constants: constantsSchema as object,
  message: messageSchema as object,
  "domain-event": domainEventSchema as object,
  "log-event": logEventSchema as object,
  "log-config": logConfigSchema as object,
  // #1303 — 3 新規 kind (#1318 で messageArea → message-area kebab-case 統一)
  dialog: dialogSchema as object,
  "message-area": messageAreaSchema as object,
  options: optionsSchema as object,
  // #1310 — global
  global: globalSchema as object,
};

type ValidateFn = ReturnType<InstanceType<typeof Ajv2020>["compile"]>;
type ValidatorMap = Map<string, ValidateFn>; // key: kind | "parent"

let _validators: ValidatorMap | null = null;

function getValidators(): ValidatorMap {
  if (_validators) return _validators;

  const ajv = buildHarmonyAjv();

  // 親 schema を先に登録して $ref 解決できるようにする
  ajv.addSchema(parentSchema as object);

  const validators = new Map<string, ValidateFn>();

  // 親 schema コンパイル
  validators.set("parent", ajv.compile(parentSchema as object));

  // kind 別 schema を登録 + コンパイル
  for (const [kind, schema] of Object.entries(KIND_SCHEMAS)) {
    ajv.addSchema(schema);
    validators.set(kind, ajv.compile(schema));
  }

  _validators = validators;
  return _validators;
}

/**
 * AJV の instancePath を人間が読みやすい path 文字列に変換する。
 * "/fields/0/name" → "fields[0].name"
 *
 * S-2 fix: AJV の `required` keyword は instancePath="" + params.missingProperty で
 * 親オブジェクト上の欠落を報告するため、Editor の section 単位 issue 表示で
 * prefix 一致しない問題があった。`required` の場合は missingProperty を path として返し、
 * 該当 section にひも付くようにする。
 */
function instancePathToReadable(
  instancePath: string,
  keyword?: string,
  params?: Record<string, unknown>,
): string {
  if (!instancePath || instancePath === "/") {
    if (keyword === "required") {
      const missingProp = params?.["missingProperty"] as string | undefined;
      if (missingProp) return missingProp;
    }
    return "(root)";
  }
  const readable = instancePath
    .replace(/^\//, "")
    .replace(/\/(\d+)\//g, "[$1].")
    .replace(/\/(\d+)$/, "[$1]")
    .replace(/\//g, ".");
  // 配列要素以下で発生した required は section 振り分けのため要素 path も維持しつつ
  // missingProperty を付与する (例: "fields[0].name" は instancePath="/fields/0" + missing="name")
  if (keyword === "required") {
    const missingProp = params?.["missingProperty"] as string | undefined;
    if (missingProp) return `${readable}.${missingProp}`;
  }
  return readable;
}

/**
 * AJV error keyword から message を生成する。
 */
function buildMessage(
  keyword: string,
  params: Record<string, unknown>,
  instancePath: string,
  message: string | undefined,
): string {
  switch (keyword) {
    case "required": {
      const missingProp = params["missingProperty"] as string | undefined;
      return `必須フィールド ${missingProp ?? ""} が欠落しています`;
    }
    case "type": {
      const expected = params["type"] as string | undefined;
      return `型が ${expected ?? "不明"} ではありません`;
    }
    case "pattern": {
      const pattern = params["pattern"] as string | undefined;
      return `パターン ${pattern ?? ""} に一致しません`;
    }
    case "minLength": {
      const limit = params["limit"] as number | undefined;
      return `最低 ${limit ?? 1} 文字必要です`;
    }
    case "maxLength": {
      const limit = params["limit"] as number | undefined;
      return `最大 ${limit ?? 0} 文字を超えています`;
    }
    case "minItems": {
      const limit = params["limit"] as number | undefined;
      return `最低 ${limit ?? 1} 件必要です`;
    }
    case "uniqueItems": {
      return "重複する項目があります";
    }
    case "const": {
      if (instancePath.endsWith("/kind") || instancePath === "/kind") {
        return `kind の値が不正です`;
      }
      return `値が定数制約に違反しています`;
    }
    case "enum": {
      const allowedValues = params["allowedValues"] as unknown[] | undefined;
      if (allowedValues) {
        return `許可された値は ${allowedValues.join(", ")} のいずれかです`;
      }
      return `許可された値ではありません`;
    }
    default:
      return message ?? `${keyword} 制約に違反しています`;
  }
}

/**
 * 単一 GenericDefinition を AJV + semantic でバリデーションする。
 */
export function validateGenericDefinition(def: GenericDefinition): GenericDefinitionIssue[] {
  const validators = getValidators();
  const issues: GenericDefinitionIssue[] = [];
  const kind = def.kind;
  const name = def.name ?? "(unknown)";

  // AJV バリデーション: kind 固有 schema がある場合はそれを使う、なければ親 schema
  const validateFn = validators.get(kind) ?? validators.get("parent")!;
  const valid = validateFn(def) as boolean;

  if (!valid) {
    const errors = validateFn.errors ?? [];
    for (const err of errors) {
      const path = instancePathToReadable(
        err.instancePath ?? "",
        err.keyword,
        (err.params ?? {}) as Record<string, unknown>,
      );
      const message = buildMessage(
        err.keyword ?? "",
        (err.params ?? {}) as Record<string, unknown>,
        err.instancePath ?? "",
        err.message,
      );
      issues.push({
        kind,
        name,
        path,
        message,
        severity: "error",
      });
    }
  }

  // kind 固有 semantic warning (MVP: 最小限)
  if (kind === "data-contract") {
    const fields = def.fields ?? [];
    if (fields.length === 0) {
      issues.push({
        kind,
        name,
        path: "fields",
        message: "データ契約に fields が定義されていません",
        severity: "warning",
      });
    }
  }

  if (kind === "exception-type") {
    const responsibilities = def.responsibilities ?? [];
    if (responsibilities.length > 0 && responsibilities.every((r) => r.trim().length < 10)) {
      issues.push({
        kind,
        name,
        path: "responsibilities",
        message: "責務記述が抽象的すぎる可能性があります (各 10 文字未満)",
        severity: "warning",
      });
    }
  }

  if (kind === "component-definition") {
    const operations = def.operations ?? [];
    if (operations.length === 0) {
      issues.push({
        kind,
        name,
        path: "operations",
        message: "コンポーネント定義に operations が定義されていません",
        severity: "warning",
      });
    }
  }

  return issues;
}
