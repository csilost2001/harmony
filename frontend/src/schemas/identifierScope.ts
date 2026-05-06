/**
 * 処理フロー @ 参照の識別子スコープ検証 (#261 残タスク)。
 *
 * 全ての @identifier が以下のいずれかに存在するかを検査:
 * - ActionDefinition.inputs[].name
 * - ActionDefinition.outputs[].name
 * - ProcessFlow.context.ambientVariables[].name
 * - 先行ステップの StepBase.outputBinding.name
 * - LoopStep.collectionItemName (ループ配下のスコープのみ)
 * - ValidationStep.fieldErrorsVar の宣言
 * - BUILTIN_AMBIENTS (組み込み関数・グローバル識別子)
 *
 * 単純な regex ベースの識別子抽出 + スコープ走査。
 * 式の完全パースや型推論は今は行わない (path 部分は無視、root 識別子のみ検査)。
 */
import type {
  ProcessFlow,
  Step,
  OutputBinding,
  StructuredField,
} from "../types/v3";
import { isBuiltinStep } from "./stepGuards";

export interface IdentifierIssue {
  path: string;
  code: "UNKNOWN_IDENTIFIER";
  identifier: string;
  message: string;
}

/**
 * 組み込み関数・グローバル識別子。
 * これらは宣言なしで常に参照可能なため、スコープ検査から除外する。
 *
 * - fn    : @fn.calcXxx(...) 形式の業務関数呼び出し
 * - now   : @now  現在時刻 (Timestamp)
 * - uuid  : @uuid 新規 UUID 生成
 * - secret: @secret.* secretsCatalog 参照
 * - conv  : @conv.* conventions 参照 (conventionsValidator でカバー)
 * - ambient: @ambient.* 旧形式の ambient 参照
 */
const BUILTIN_AMBIENTS = new Set<string>([
  "fn",
  "now",
  "uuid",
  "secret",
  "conv",
  "ambient",
]);

/** 任意の文字列から @identifier の root 部分を抽出 (property path は無視) */
function extractIdentifiers(src: string): string[] {
  const result: string[] = [];
  const re = /@([a-zA-Z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    result.push(m[1]);
  }
  return result;
}

function getBindingName(binding: OutputBinding | undefined): string | null {
  return binding?.name ?? null;
}

function fieldNames(fields: StructuredField[] | undefined): string[] {
  return fields?.map((f) => f.name as string) ?? [];
}

/**
 * 全 @ 参照の識別子スコープ検証。
 * 空配列なら問題なし。
 */
export function checkIdentifierScopes(group: ProcessFlow): IdentifierIssue[] {
  const issues: IdentifierIssue[] = [];
  const ambientFields = group.context?.ambientVariables;
  const ambientNames = new Set(fieldNames(ambientFields));

  group.actions.forEach((action, ai) => {
    const knownInAction = new Set<string>(ambientNames);
    // inputs: 個別フィールド名 + "inputs" 全体 (@inputs.field 参照を許容)
    if (Array.isArray(action.inputs)) {
      knownInAction.add("inputs");
      for (const f of action.inputs) knownInAction.add(f.name);
    }
    // outputs: 個別フィールド名 + "outputs" 全体
    if (Array.isArray(action.outputs)) {
      knownInAction.add("outputs");
      for (const f of action.outputs) knownInAction.add(f.name);
    }

    walkSteps(
      action.steps ?? [],
      `actions[${ai}].steps`,
      knownInAction,
      [],
      issues,
    );
  });

  return issues;
}

/**
 * ステップ列を走査。
 * @param known  このスコープで参照可能な識別子の set (mutable: outputBinding で add)
 * @param loopItems 包含ループの collectionItemName 列 (ネスト可)
 */
function walkSteps(
  steps: Step[],
  basePath: string,
  known: Set<string>,
  loopItems: string[],
  issues: IdentifierIssue[],
): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    const available = new Set<string>([...known, ...loopItems]);
    checkStep(step, path, available, issues);

    // outputBinding は StepBaseProps 共通フィールド。拡張 step も継承するため kind 関係なく known に追加
    const bindName = getBindingName(step.outputBinding);
    if (bindName) known.add(bindName);

    // 以下は組み込み step variant 固有の処理 (拡張 step は config 内の固有プロパティを持つため除外)
    if (!isBuiltinStep(step)) return;

    // ValidationStep の fieldErrorsVar も known に
    if (step.kind === "validation") {
      if (step.fieldErrorsVar) known.add(step.fieldErrorsVar);
      else known.add("fieldErrors"); // 既定
    }
    // ReturnStep は新変数を作らない

    // ネスト構造。known は共有 (ループ/ブランチ/sideEffects 内で宣言された
    // outputBinding は親スコープからも参照可能とする -- accumulate/push を
    // ループ外で参照するパターンを許容するため、現時点では permissive)。
    // loopItems はループ配下のみ有効 (ループ外に leak させない)。
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) => {
        walkSteps(b.steps, `${path}.branches[${bi}].steps`, known, loopItems, issues);
      });
      if (step.elseBranch) {
        walkSteps(step.elseBranch.steps, `${path}.elseBranch.steps`, known, loopItems, issues);
      }
    }
    if (step.kind === "loop") {
      const childLoopItems = step.collectionItemName
        ? [...loopItems, step.collectionItemName]
        : loopItems;
      walkSteps(step.steps, `${path}.steps`, known, childLoopItems, issues);
    }
    if (step.kind === "transactionScope") {
      walkSteps(step.steps, `${path}.steps`, known, loopItems, issues);
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, known, loopItems, issues);
      if (step.onRollback) {
        const onRollbackKnown = new Set([...known, "error"]);
        walkSteps(step.onRollback, `${path}.onRollback`, onRollbackKnown, loopItems, issues);
      }
    }
    if (step.kind === "workflow") {
      if (step.onApproved) walkSteps(step.onApproved, `${path}.onApproved`, known, loopItems, issues);
      if (step.onRejected) walkSteps(step.onRejected, `${path}.onRejected`, known, loopItems, issues);
      if (step.onTimeout) walkSteps(step.onTimeout, `${path}.onTimeout`, known, loopItems, issues);
    }
    if (step.kind === "validation" && step.inlineBranch) {
      walkSteps(step.inlineBranch.ok, `${path}.inlineBranch.ok`, known, loopItems, issues);
      walkSteps(step.inlineBranch.ng, `${path}.inlineBranch.ng`, known, loopItems, issues);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) {
          walkSteps(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, known, loopItems, issues);
        }
      });
    }
  });
}

/** 1 step の式フィールドを全走査、@ 識別子を known と突合 */
function checkStep(step: Step, path: string, availableIn: Set<string>, issues: IdentifierIssue[]): void {
  // 拡張 step の固有 property は config に閉じるため、組み込み step に絞って検査
  if (!isBuiltinStep(step)) return;
  // ValidationStep は自分自身の rules[] 評価結果 fieldErrors を同じ step の ngBodyExpression
  // で使う (同時に可視) ので、available に足してから式チェック
  const available = new Set(availableIn);
  if (step.kind === "validation") {
    available.add(step.fieldErrorsVar ?? "fieldErrors");
  }

  const expressions: Array<{ src: string; field: string }> = [];

  if (step.runIf) expressions.push({ src: step.runIf, field: "runIf" });

  if (step.kind === "compute") {
    expressions.push({ src: step.expression, field: "expression" });
  }
  if (step.kind === "return") {
    if (step.bodyExpression) expressions.push({ src: step.bodyExpression, field: "bodyExpression" });
  }
  if (step.kind === "validation") {
    if (step.conditions) expressions.push({ src: step.conditions, field: "conditions" });
    (step.rules ?? []).forEach((r, ri) => {
      if (r.condition) expressions.push({ src: r.condition, field: `rules[${ri}].condition` });
      if (r.message) expressions.push({ src: r.message, field: `rules[${ri}].message` });
    });
    if (step.inlineBranch?.ngBodyExpression) {
      expressions.push({ src: step.inlineBranch.ngBodyExpression, field: "inlineBranch.ngBodyExpression" });
    }
  }
  if (step.kind === "branch") {
    step.branches.forEach((b, bi) => {
      if (b.condition.kind === "expression") {
        expressions.push({ src: b.condition.expression, field: `branches[${bi}].condition.expression` });
      }
    });
  }
  if (step.kind === "loop") {
    if (step.countExpression) expressions.push({ src: step.countExpression, field: "countExpression" });
    if (step.conditionExpression) expressions.push({ src: step.conditionExpression, field: "conditionExpression" });
    if (step.collectionSource) expressions.push({ src: step.collectionSource, field: "collectionSource" });
  }
  if (step.kind === "dbAccess") {
    if (step.sql) expressions.push({ src: step.sql, field: "sql" });
    if (step.fields) expressions.push({ src: step.fields, field: "fields" });
  }
  if (step.kind === "externalSystem") {
    if (step.idempotencyKey) expressions.push({ src: step.idempotencyKey, field: "idempotencyKey" });
    if (step.httpCall?.path) expressions.push({ src: step.httpCall.path, field: "httpCall.path" });
    if (step.httpCall?.body) expressions.push({ src: step.httpCall.body, field: "httpCall.body" });
    Object.entries(step.httpCall?.query ?? {}).forEach(([k, v]) => {
      expressions.push({ src: v, field: `httpCall.query.${k}` });
    });
    Object.entries(step.headers ?? {}).forEach(([k, v]) => {
      expressions.push({ src: v, field: `headers.${k}` });
    });
  }
  if (step.kind === "commonProcess" && step.argumentMapping) {
    Object.entries(step.argumentMapping).forEach(([k, v]) => {
      expressions.push({ src: v, field: `argumentMapping.${k}` });
    });
  }

  // outputBinding.initialValue: 文字列式のみ識別子検査 (JSON 値なら skip)
  const initialValue = step.outputBinding?.initialValue;
  if (typeof initialValue === "string" && initialValue) {
    expressions.push({ src: initialValue, field: "outputBinding.initialValue" });
  }

  for (const { src, field } of expressions) {
    const ids = extractIdentifiers(src);
    for (const id of ids) {
      // 組み込み関数・グローバル識別子は宣言不要
      if (BUILTIN_AMBIENTS.has(id)) continue;
      if (!available.has(id)) {
        issues.push({
          path: `${path}.${field}`,
          code: "UNKNOWN_IDENTIFIER",
          identifier: id,
          message: `@${id} がこのスコープで宣言されていません (inputs / outputs / outputBinding / ambientVariables / loop item のいずれにも無い)`,
        });
      }
    }
  }
}
