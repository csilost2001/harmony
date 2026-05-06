/**
 * @conv.msg.* / @conv.regex.* / @conv.limit.* 参照の検証 (#151-A / #261 残)。
 *
 * 処理フロー JSON 内の式・メッセージ中に現れる @conv.<category>.<key> が
 * conventions-catalog.json に存在するかを検査。
 * Screen.items の pattern / errorMessages.* も対象 (#351)。
 */
import type { ScreenItemsDocument } from "../store/screenItemsStore";
import type {
  ProcessFlow,
  Step,
  ActionDefinition,
  Conventions,
} from "../types/v3";
import { isBuiltinStep } from "./stepGuards";

/**
 * 既存呼び出し側互換のため `ConventionsCatalog` 名で v3 `Conventions` を再エクスポート。
 * 新規コードは `Conventions` (v3) を直接使うことを推奨。
 */
export type ConventionsCatalog = Conventions;

export interface ConventionIssue {
  path: string;
  code:
    | "UNKNOWN_CONV_MSG"
    | "UNKNOWN_CONV_REGEX"
    | "UNKNOWN_CONV_LIMIT"
    | "UNKNOWN_CONV_SCOPE"
    | "UNKNOWN_CONV_CURRENCY"
    | "UNKNOWN_CONV_TAX"
    | "UNKNOWN_CONV_AUTH"
    | "UNKNOWN_CONV_ROLE"
    | "UNKNOWN_CONV_PERMISSION"
    | "UNKNOWN_CONV_DB"
    | "UNKNOWN_CONV_NUMBERING"
    | "UNKNOWN_CONV_TX"
    | "UNKNOWN_CONV_EXTERNAL_OUTCOME_DEFAULTS"
    | "UNKNOWN_CONV_CATEGORY"
    | "ROLE_INHERITS_CYCLE"
    | "UNKNOWN_CONV_ROLE_PERMISSION"
    | "UNKNOWN_CONV_ROLE_INHERITS"
    | "INVALID_DEFAULT_LOCALE"
    | "UNKNOWN_MSG_LOCALE";
  value: string;
  message: string;
}

/** @conv.CAT.KEY にマッチ。KEY は order.approve のような dot 含みも許可する。 */
const CONV_RE = /@conv\.([a-zA-Z_][\w-]*)\.([a-zA-Z_][\w-]*(?:\.[a-zA-Z_][\w-]*)*)/g;

/** 1 文字列から @conv 参照を抽出 */
function extractConvRefs(src: string): Array<{ category: string; key: string }> {
  const results: Array<{ category: string; key: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = CONV_RE.exec(src)) !== null) {
    results.push({ category: m[1], key: m[2] });
  }
  return results;
}

function codeFor(category: string): ConventionIssue["code"] {
  switch (category) {
    case "msg": return "UNKNOWN_CONV_MSG";
    case "regex": return "UNKNOWN_CONV_REGEX";
    case "limit": return "UNKNOWN_CONV_LIMIT";
    case "scope": return "UNKNOWN_CONV_SCOPE";
    case "currency": return "UNKNOWN_CONV_CURRENCY";
    case "tax": return "UNKNOWN_CONV_TAX";
    case "auth": return "UNKNOWN_CONV_AUTH";
    case "role": return "UNKNOWN_CONV_ROLE";
    case "permission": return "UNKNOWN_CONV_PERMISSION";
    case "db": return "UNKNOWN_CONV_DB";
    case "numbering": return "UNKNOWN_CONV_NUMBERING";
    case "tx": return "UNKNOWN_CONV_TX";
    case "externalOutcomeDefaults": return "UNKNOWN_CONV_EXTERNAL_OUTCOME_DEFAULTS";
    default: return "UNKNOWN_CONV_CATEGORY";
  }
}

function resolveCategory(catalog: ConventionsCatalog, category: string): Record<string, unknown> | null {
  switch (category) {
    case "msg": return catalog.msg ?? null;
    case "regex": return catalog.regex ?? null;
    case "limit": return catalog.limit ?? null;
    case "scope": return catalog.scope ?? null;
    case "currency": return catalog.currency ?? null;
    case "tax": return catalog.tax ?? null;
    case "auth": return catalog.auth ?? null;
    case "role": return catalog.role ?? null;
    case "permission": return catalog.permission ?? null;
    case "db": return catalog.db ?? null;
    case "numbering": return catalog.numbering ?? null;
    case "tx": return catalog.tx ?? null;
    case "externalOutcomeDefaults": return catalog.externalOutcomeDefaults ?? null;
    default: return null;
  }
}

/** @conv.category.key.subpath 形式では、catalog key 部分だけを既存カテゴリから解決する。 */
function hasConventionKey(category: string, cat: Record<string, unknown>, key: string): boolean {
  if (key in cat) return true;
  if (category === "permission" || category === "role") return false;

  const parts = key.split(".");
  while (parts.length > 1) {
    parts.pop();
    if (parts.join(".") in cat) return true;
  }
  return false;
}

export function checkConventionsCatalogIntegrity(catalog: ConventionsCatalog | null): ConventionIssue[] {
  if (!catalog) return [];

  const issues: ConventionIssue[] = [];
  checkRolePermissionReferences(catalog, issues);
  checkRoleInheritsReferences(catalog, issues);
  checkRoleInheritanceCycles(catalog, issues);
  checkI18nCatalog(catalog, issues);
  return issues;
}

function checkI18nCatalog(catalog: ConventionsCatalog, issues: ConventionIssue[]): void {
  if (!catalog.i18n) return;

  const supportedLocales = new Set(catalog.i18n.supportedLocales);
  if (!supportedLocales.has(catalog.i18n.defaultLocale)) {
    issues.push({
      path: "i18n.defaultLocale",
      code: "INVALID_DEFAULT_LOCALE",
      value: catalog.i18n.defaultLocale,
      message: `i18n.defaultLocale ${catalog.i18n.defaultLocale} is not included in i18n.supportedLocales`,
    });
  }

  Object.entries(catalog.msg ?? {}).forEach(([msgKey, template]) => {
    Object.keys(template.locales ?? {}).forEach((locale) => {
      if (!supportedLocales.has(locale)) {
        issues.push({
          path: `msg.${msgKey}.locales.${locale}`,
          code: "UNKNOWN_MSG_LOCALE",
          value: locale,
          message: `msg.${msgKey}.locales.${locale} is not included in i18n.supportedLocales`,
        });
      }
    });
  });
}

function checkRolePermissionReferences(catalog: ConventionsCatalog, issues: ConventionIssue[]): void {
  const roles = catalog.role ?? {};
  const permissions = catalog.permission ?? {};

  Object.entries(roles).forEach(([roleKey, role]) => {
    (role.permissions ?? []).forEach((permissionKey, i) => {
      if (!(permissionKey in permissions)) {
        issues.push({
          path: `role.${roleKey}.permissions[${i}]`,
          code: "UNKNOWN_CONV_ROLE_PERMISSION",
          value: permissionKey,
          message: `role.${roleKey} が存在しない permission.${permissionKey} を参照しています`,
        });
      }
    });
  });
}

function checkRoleInheritsReferences(catalog: ConventionsCatalog, issues: ConventionIssue[]): void {
  const roles = catalog.role ?? {};

  Object.entries(roles).forEach(([roleKey, role]) => {
    (role.inherits ?? []).forEach((parentKey, i) => {
      if (!(parentKey in roles)) {
        issues.push({
          path: `role.${roleKey}.inherits[${i}]`,
          code: "UNKNOWN_CONV_ROLE_INHERITS",
          value: parentKey,
          message: `role.${roleKey} が存在しない role.${parentKey} を参照しています`,
        });
      }
    });
  });
}

function checkRoleInheritanceCycles(catalog: ConventionsCatalog, issues: ConventionIssue[]): void {
  const roles = catalog.role ?? {};
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const stack: string[] = [];

  const visit = (roleKey: string): void => {
    if (!(roleKey in roles)) return;
    if (visiting.has(roleKey)) {
      const start = stack.indexOf(roleKey);
      const cycle = [...stack.slice(start), roleKey];
      const signature = cycle.join(">");
      if (!reported.has(signature)) {
        reported.add(signature);
        issues.push({
          path: `role.${roleKey}.inherits`,
          code: "ROLE_INHERITS_CYCLE",
          value: cycle.join(" -> "),
          message: `role.inherits に循環参照があります: ${cycle.join(" -> ")}`,
        });
      }
      return;
    }
    if (visited.has(roleKey)) return;

    visiting.add(roleKey);
    stack.push(roleKey);
    for (const parentKey of roles[roleKey].inherits ?? []) {
      visit(parentKey);
    }
    stack.pop();
    visiting.delete(roleKey);
    visited.add(roleKey);
  };

  Object.keys(roles).forEach(visit);
}

/** ProcessFlow 全体で @conv.* 参照を検査。catalog が null なら検査 skip */
export function checkConventionReferences(
  group: ProcessFlow,
  catalog: ConventionsCatalog | null,
): ConventionIssue[] {
  if (!catalog) return [];
  const issues: ConventionIssue[] = [];

  group.actions.forEach((action, ai) => {
    walkStepsInAction(action, `actions[${ai}]`, catalog, issues);
  });

  // context.catalogs.domains の constraints[].patternRef / *Ref を検査 (#783)
  const domains = group.context?.catalogs?.domains;
  if (domains) {
    Object.entries(domains).forEach(([domainKey, entry]) => {
      (entry.constraints ?? []).forEach((rule, ri) => {
        const base = `context.catalogs.domains.${domainKey}.constraints[${ri}]`;
        if (rule.patternRef) checkValue(rule.patternRef, `${base}.patternRef`, catalog, issues);
        if (rule.minRef) checkValue(rule.minRef, `${base}.minRef`, catalog, issues);
        if (rule.maxRef) checkValue(rule.maxRef, `${base}.maxRef`, catalog, issues);
        if (rule.lengthRef) checkValue(rule.lengthRef, `${base}.lengthRef`, catalog, issues);
        if (rule.condition) checkValue(rule.condition, `${base}.condition`, catalog, issues);
        if (rule.message) checkValue(rule.message, `${base}.message`, catalog, issues);
      });
    });
  }

  return issues;
}

function walkStepsInAction(
  action: ActionDefinition,
  basePath: string,
  catalog: ConventionsCatalog,
  issues: ConventionIssue[],
): void {
  walkSteps(action.steps ?? [], `${basePath}.steps`, catalog, issues);
}

function walkSteps(
  steps: Step[],
  basePath: string,
  catalog: ConventionsCatalog,
  issues: ConventionIssue[],
): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    checkStep(step, path, catalog, issues);

    // 拡張 step は nested 走査スキップ (固有プロパティは config 内に閉じる仕様)
    if (!isBuiltinStep(step)) return;
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) => walkSteps(b.steps, `${path}.branches[${bi}].steps`, catalog, issues));
      if (step.elseBranch) walkSteps(step.elseBranch.steps, `${path}.elseBranch.steps`, catalog, issues);
    }
    if (step.kind === "loop") walkSteps(step.steps, `${path}.steps`, catalog, issues);
    if (step.kind === "transactionScope") {
      walkSteps(step.steps, `${path}.steps`, catalog, issues);
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, catalog, issues);
      if (step.onRollback) walkSteps(step.onRollback, `${path}.onRollback`, catalog, issues);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) walkSteps(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, catalog, issues);
      });
    }
  });
}

/** 1 文字列値の @conv.* 参照を検査し issues に追記する */
function checkValue(src: string, path: string, catalog: ConventionsCatalog, issues: ConventionIssue[]): void {
  for (const { category, key } of extractConvRefs(src)) {
    const cat = resolveCategory(catalog, category);
    if (cat === null) {
      issues.push({
        path,
        code: "UNKNOWN_CONV_CATEGORY",
        value: `@conv.${category}.${key}`,
        message: `@conv.${category}.* カテゴリは規約カタログに存在しません`,
      });
    } else if (!hasConventionKey(category, cat, key)) {
      issues.push({
        path,
        code: codeFor(category),
        value: `@conv.${category}.${key}`,
        message: `@conv.${category}.${key} が規約カタログに存在しません`,
      });
    }
  }
}

function checkStep(step: Step, path: string, catalog: ConventionsCatalog, issues: ConventionIssue[]): void {
  const texts: Array<{ src: string; field: string }> = [];

  // StepBaseProps 共通フィールド: kind に関係なく全 step variant で検査 (拡張 step / v1 fixture も含む)
  if (step.description) texts.push({ src: step.description, field: "description" });
  if (step.runIf) texts.push({ src: step.runIf, field: "runIf" });

  // kind 固有フィールドは組み込み step に絞る (拡張 step の固有 property は config 内に閉じる仕様)
  if (isBuiltinStep(step)) {
    if (step.kind === "compute") texts.push({ src: step.expression, field: "expression" });
    if (step.kind === "return" && step.bodyExpression) texts.push({ src: step.bodyExpression, field: "bodyExpression" });
    if (step.kind === "validation") {
      if (step.conditions) texts.push({ src: step.conditions, field: "conditions" });
      (step.rules ?? []).forEach((r, ri) => {
        if (r.condition) texts.push({ src: r.condition, field: `rules[${ri}].condition` });
        if (r.message) texts.push({ src: r.message, field: `rules[${ri}].message` });
        if (r.pattern) texts.push({ src: r.pattern, field: `rules[${ri}].pattern` });
        if (r.minRef) texts.push({ src: r.minRef, field: `rules[${ri}].minRef` });
        if (r.maxRef) texts.push({ src: r.maxRef, field: `rules[${ri}].maxRef` });
        if (r.lengthRef) texts.push({ src: r.lengthRef, field: `rules[${ri}].lengthRef` });
        if (r.patternRef) texts.push({ src: r.patternRef, field: `rules[${ri}].patternRef` });
      });
      if (step.inlineBranch?.ngBodyExpression) {
        texts.push({ src: step.inlineBranch.ngBodyExpression, field: "inlineBranch.ngBodyExpression" });
      }
    }
    if (step.kind === "dbAccess") {
      if (step.sql) texts.push({ src: step.sql, field: "sql" });
    }
    if (step.kind === "externalSystem") {
      if (step.httpCall?.body) texts.push({ src: step.httpCall.body, field: "httpCall.body" });
    }
  }

  for (const { src, field } of texts) {
    checkValue(src, `${path}.${field}`, catalog, issues);
  }
}

/** 画面項目定義ファイル全体で @conv.* 参照を検査 (#351)。catalog が null なら skip */
export function checkScreenItemConventionReferences(
  file: ScreenItemsDocument,
  catalog: ConventionsCatalog | null,
): ConventionIssue[] {
  if (!catalog) return [];
  const issues: ConventionIssue[] = [];

  file.items.forEach((item, i) => {
    if (item.pattern) {
      checkValue(item.pattern, `items[${i}].pattern`, catalog, issues);
    }
    if (item.errorMessages) {
      Object.entries(item.errorMessages).forEach(([key, val]) => {
        if (val) checkValue(val, `items[${i}].errorMessages.${key}`, catalog, issues);
      });
    }
    // #734: *Ref フィールドの @conv.limit.<key> 参照存在を検査
    if (item.minLengthRef) checkValue(item.minLengthRef, `items[${i}].minLengthRef`, catalog, issues);
    if (item.maxLengthRef) checkValue(item.maxLengthRef, `items[${i}].maxLengthRef`, catalog, issues);
    if (item.minRef) checkValue(item.minRef, `items[${i}].minRef`, catalog, issues);
    if (item.maxRef) checkValue(item.maxRef, `items[${i}].maxRef`, catalog, issues);
  });

  return issues;
}
