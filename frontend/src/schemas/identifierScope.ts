/**
 * 処理フロー @ 参照の識別子スコープ検証 (#261 残タスク)。
 *
 * 全ての @identifier が以下のいずれかに存在するかを検査:
 * - ActionDefinition.inputs[].name
 * - ActionDefinition.outputs[].name
 * - ProcessFlow.context.ambientVariables[].name
 * - 先行ステップの StepBase.outputBinding.name
 * - LoopStep.collectionItemName / collectionIndexName (ループ配下のスコープのみ)
 * - ValidationStep.fieldErrorsVar の宣言
 * - BranchCondition.tryCatch.errorVar (catch block 内のみ)
 * - BUILTIN_AMBIENTS (組み込み関数・グローバル識別子)
 *
 * #1289: @var.<scope>.<name> grammar-aware check 追加 (RFC #1264 verdict 実装)。
 * `@var` 系参照は path[0] で 6 scope (flowParameter / action / loop / global / step / tx) に
 * 分岐して semantic 検証する。shorthand `@var.<name>` は lexical chain auto-infer。
 *
 * 単純な regex ベースの識別子抽出 + スコープ走査。
 * 式の完全パースや型推論は今は行わない (path 部分は scope keyword と最初の name のみ検査)。
 */
import { mergeCatalogsForFlow, type ProjectCatalogs } from "./projectCatalogs";
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
 * **組み込み関数 / グローバル**:
 * - fn    : @fn.calcXxx(...) 形式の業務関数呼び出し
 * - now   : @now  現在時刻 (Timestamp)
 * - uuid  : @uuid 新規 UUID 生成
 * - secret: @secret.* secretsCatalog 参照
 * - conv  : @conv.* conventions 参照 (conventionsValidator でカバー)
 * - ambient: @ambient.* 旧形式の ambient 参照
 *
 * **Generic Definition Catalog 参照** (docs/spec/process-flow-prefix-system.md §3、
 * #1285 で追加、14 kind 全件 + #1303 追加 3 kind + #1310 追加 1 kind (global) = 18 kind → #1436 ui-fragment 廃止で 17 kind): broken-ref 検証は
 * processFlowAntipatternValidator Check 31 が担うため identifierScope は変数 scope 検査の対象外として skip する。
 * - msg        : @msg.<Name> generic-definitions/message
 * - validation : @validation.<Name> generic-definitions/validation-rule (inline boolean return)
 * - rule       : @rule.<Name> generic-definitions/application-rule
 * - const      : @const.<Name>.<key> generic-definitions/constants
 * - event      : @event.<topic> generic-definitions/domain-event (catalogs.events と兼用)
 * - logEvent   : @logEvent.<Name> generic-definitions/log-event
 * - logConfig  : @logConfig.<Name> generic-definitions/log-config
 * - behavior   : @behavior.<Name> generic-definitions/ui-behavior
 * - contract   : @contract.<Name> generic-definitions/data-contract
 * - type       : @type.<Name> generic-definitions/domain-type
 * - exception  : @exception.<Name> generic-definitions/exception-type
 * - policy     : @policy.<Name> generic-definitions/runtime-policy
 * - component  : @component.<Name> generic-definitions/component-definition
 * - dialog     : @dialog.<Name> generic-definitions/dialog (#1303)
 * - messageArea: @messageArea.<Name> generic-definitions/message-area (#1303、#1318 で kind=kebab `message-area` / prefix=camelCase `messageArea` に分離、BUILTIN_AMBIENTS は prefix-keyed)
 * - options    : @options.<Name> generic-definitions/options (#1303)
 *
 * **Top-level entity 階層参照** (process-flow-prefix-system.md §3、#1285 で追加):
 * - screen : @screen.<id>.item.<id>.<field> Screen entity 参照
 * - table  : @table.<id>.field.<id>.<field> Table entity 参照
 * - view   : @view.<id>.field.<col> View entity 参照
 * - viewer : @viewer.<id> ViewDefinition 参照
 * - layout : @layout.<id> PageLayout 参照
 * - seq    : @seq.<id> Sequence entity 参照
 * - flow   : @flow.<id> ProcessFlow entity 参照 (inline 禁止、副作用 invocation)
 * - system : @system.<id> ExternalSystem catalog 参照 (context.catalogs.externalSystems)
 * - ext    : @ext.<namespace> Extension namespace 参照
 *
 * @env.* は special-case として checkStep 内で context.catalogs.envVars と突合するため
 * ここには含めない (下記 root === "env" ブランチを参照)。
 *
 * @var.* も special-case として root === "var" ブランチで grammar-aware 検査 (#1289)。
 * BUILTIN_AMBIENTS には含めない。
 */
const BUILTIN_AMBIENTS = new Set<string>([
  // Built-in functions / globals
  "fn",
  "now",
  "uuid",
  "secret",
  "conv",
  "ambient",
  // Generic Definition Catalog refs (#1285 14 kind + #1303 3 kind + #1310 1 kind = 18 kind → #1436 ui-fragment 廃止で 17 kind)
  "msg",
  "validation",
  "rule",
  "const",
  "event",
  "logEvent",
  "logConfig",
  "behavior",
  "contract",
  "type",
  "exception",
  "policy",
  "component",
  "dialog",
  "messageArea",
  "options",
  // Top-level entity / catalog refs (#1285)
  "screen",
  "table",
  "view",
  "viewer",
  "layout",
  "seq",
  "flow",
  "system",
  "ext",
]);

/**
 * `@var.<scope>.<name>` の明示 scope 6 値 (RFC #1264 verdict / process-flow-variables.md §3.6)。
 * `step` / `tx` は後続に step-id が続く (`@var.step.<step-id>.<name>`)。
 */
const VAR_EXPLICIT_SCOPES = new Set<string>([
  "flowParameter",
  "action",
  "loop",
  "global",
  "step",
  "tx",
]);

/**
 * TransactionScopeStep の `@var.tx.<step-id>.<name>` で常時参照可能な予約値
 * (process-flow-variables.md §3.7、`expose` 列挙不要)。
 */
const TX_RESERVED_VALUES = new Set<string>(["committed", "error", "diagnostics"]);

/**
 * 任意の文字列から @identifier と property path を抽出。
 *
 * #1289: path 部のセグメントに hyphen を許容するよう更新 (`@var.step.<step-id>.<name>` の
 * step-id が LocalId 形式で hyphen を含むため、例: `step-01-validate`)。root 部 (Identifier、
 * camelCase 強制) は従来通り hyphen 不許可。
 *
 * #1289 独立レビュー follow-up: path 部のセグメント先頭文字に digit (0-9) も許容
 * (LocalId は `[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?` で digit-start を許容
 * するため、`response-id: '404-not-found'` 等の参照 `@var.step.<stepId>.404-not-found`
 * を拾えるようにする)。これにより processFlowAntipatternValidator.ts:426 の REF_RE
 * と非対称が解消する。root 部は引き続き Identifier (camelCase / letter-start) のみ。
 */
function extractReferences(src: string): Array<{ root: string; path: string[] }> {
  const result: Array<{ root: string; path: string[] }> = [];
  const re = /@([a-zA-Z_][\w]*)(?:\.([a-zA-Z0-9_][\w-]*(?:\.[a-zA-Z0-9_][\w-]*)*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    result.push({ root: m[1], path: m[2]?.split(".") ?? [] });
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
 * action 内の全 step を id 一意 index に flatten (#1289 で `@var.step.<id>.<name>` /
 * `@var.tx.<id>.<name>` の存在検証用)。ネスト構造 (branch / loop / transactionScope /
 * workflow / validation.inlineBranch / externalSystem.outcomes.sideEffects) も walk する。
 */
function buildStepIndex(steps: Step[]): Map<string, Step> {
  const index = new Map<string, Step>();
  function walk(stepList: Step[]): void {
    for (const step of stepList) {
      if (step.id) index.set(step.id, step);
      if (!isBuiltinStep(step)) continue;
      if (step.kind === "branch") {
        step.branches.forEach((b) => walk(b.steps));
        if (step.elseBranch) walk(step.elseBranch.steps);
      }
      if (step.kind === "loop") walk(step.steps);
      if (step.kind === "transactionScope") {
        walk(step.steps);
        if (step.onCommit) walk(step.onCommit);
        if (step.onRollback) walk(step.onRollback);
      }
      if (step.kind === "workflow") {
        if (step.onApproved) walk(step.onApproved);
        if (step.onRejected) walk(step.onRejected);
        if (step.onTimeout) walk(step.onTimeout);
      }
      if (step.kind === "validation" && step.inlineBranch) {
        walk(step.inlineBranch.ok);
        walk(step.inlineBranch.ng);
      }
      if (step.kind === "externalSystem") {
        Object.values(step.errorHandling?.outcomes ?? {}).forEach((spec) => {
          if (spec?.sideEffects) walk(spec.sideEffects);
        });
      }
    }
  }
  walk(steps);
  return index;
}

/**
 * 全 @ 参照の識別子スコープ検証。
 * 空配列なら問題なし。
 */
export function checkIdentifierScopes(
  group: ProcessFlow,
  projectCatalogs?: ProjectCatalogs,
): IdentifierIssue[] {
  const issues: IdentifierIssue[] = [];
  const ambientFields = group.context?.ambientVariables;
  const ambientNames = new Set(fieldNames(ambientFields));
  // #939 提案 C: project-level catalogs と flow-level の envVars を merge して検査
  const merged = mergeCatalogsForFlow(group, projectCatalogs);
  const envVarNames = new Set(Object.keys(merged.envVars ?? {}));

  group.actions.forEach((action, ai) => {
    const knownInAction = new Set<string>(ambientNames);
    const actionInputs = new Set<string>(fieldNames(action.inputs));
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

    // #1289: action 全体の step index を事前構築 (`@var.step.<id>` / `@var.tx.<id>` の存在検証用)
    const stepIndex = buildStepIndex(action.steps ?? []);

    walkSteps(
      action.steps ?? [],
      `actions[${ai}].steps`,
      knownInAction,
      [],
      envVarNames,
      actionInputs,
      stepIndex,
      issues,
    );
  });

  return issues;
}

/**
 * ステップ列を走査。
 * @param known  このスコープで参照可能な識別子の set (mutable: outputBinding で add)
 * @param loopItems 包含ループの collectionItemName / collectionIndexName 列 (ネスト可)
 * @param actionInputs action.inputs[].name の set (#1289、`@var.flowParameter.<name>` 検証用)
 * @param stepIndex action 内の全 step を id-indexed (#1289、`@var.step` / `@var.tx` 検証用)
 */
function walkSteps(
  steps: Step[],
  basePath: string,
  known: Set<string>,
  loopItems: string[],
  envVarNames: Set<string>,
  actionInputs: Set<string>,
  stepIndex: Map<string, Step>,
  issues: IdentifierIssue[],
): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    const available = new Set<string>([...known, ...loopItems]);
    checkStep(step, path, available, known, new Set(loopItems), actionInputs, stepIndex, envVarNames, issues);

    // outputBinding は StepBaseProps 共通フィールド。拡張 step も継承するため kind 関係なく known に追加
    const bindName = getBindingName(step.outputBinding);
    if (bindName) known.add(bindName);

    // 以下は組み込み step variant 固有の処理 (拡張 step は config 内の固有プロパティを持つため除外)
    if (!isBuiltinStep(step)) return;

    // ValidationStep の fieldErrorsVar も known に。#1221 で必須化済のため非 undefined と仮定する
    // (schema-level required ガード後、レガシー JSON は migrateProcessFlow で 'fieldErrors' を補完)。
    if (step.kind === "validation" && step.fieldErrorsVar) {
      known.add(step.fieldErrorsVar);
    }
    // ReturnStep は新変数を作らない

    // ネスト構造。known は共有 (ループ/ブランチ/sideEffects 内で宣言された
    // outputBinding は親スコープからも参照可能とする -- accumulate/push を
    // ループ外で参照するパターンを許容するため、現時点では permissive)。
    // loopItems はループ配下のみ有効 (ループ外に leak させない)。
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) => {
        // #1289 / #1264 verdict 観点 3: tryCatch.errorVar は catch block 内 named binding
        // として導入される。enclosing scope には漏らさない (branch-local known に注入)。
        let branchKnown = known;
        if (b.condition.kind === "tryCatch" && b.condition.errorVar) {
          branchKnown = new Set([...known, b.condition.errorVar]);
        }
        walkSteps(b.steps, `${path}.branches[${bi}].steps`, branchKnown, loopItems, envVarNames, actionInputs, stepIndex, issues);
      });
      if (step.elseBranch) {
        walkSteps(step.elseBranch.steps, `${path}.elseBranch.steps`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
      }
    }
    if (step.kind === "loop") {
      // #1289 / #1264 verdict 観点 3: collection loop の collectionIndexName も loopItems に注入
      const childLoopItems = [...loopItems];
      if (step.collectionItemName) childLoopItems.push(step.collectionItemName);
      if (step.collectionIndexName) childLoopItems.push(step.collectionIndexName);
      walkSteps(step.steps, `${path}.steps`, known, childLoopItems, envVarNames, actionInputs, stepIndex, issues);
    }
    if (step.kind === "transactionScope") {
      // #1289 独立レビュー follow-up: TX inner var leak 防止 (spec process-flow-variables.md
      // §3.7「TX 外参照は expose 経由のみ」)。TX body / onCommit / onRollback 内で宣言された
      // outputBinding は parent scope に leak しない設計とする。
      //
      // 実装: known の snapshot (txKnown) を clone して TX body に渡す。inner step が
      // outputBinding で txKnown を mutate しても、parent の known は影響を受けない。
      // TX 完了後の parent は、TX wrapper 自体の outputBinding.name (既に上の `known.add(bindName)`
      // で追加済) と予約値 / expose 列挙を `@var.action.<txWrapperName>.<accessor>` 経由で
      // 参照する形になり、shorthand `@<innerVarName>` 直接参照は別 validator (Check 32) が
      // 静的検出する。
      //
      // onCommit / onRollback は TX body の continuation で inner bindings (commit 後の値 /
      // rollback context) を見られる必要があるため、同じ txKnown を渡す (parent への leak は
      // 引き続き起こらない)。
      const txKnown = new Set(known);
      walkSteps(step.steps, `${path}.steps`, txKnown, loopItems, envVarNames, actionInputs, stepIndex, issues);
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, txKnown, loopItems, envVarNames, actionInputs, stepIndex, issues);
      if (step.onRollback) {
        const onRollbackKnown = new Set([...txKnown, "error"]);
        walkSteps(step.onRollback, `${path}.onRollback`, onRollbackKnown, loopItems, envVarNames, actionInputs, stepIndex, issues);
      }
    }
    if (step.kind === "workflow") {
      if (step.onApproved) walkSteps(step.onApproved, `${path}.onApproved`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
      if (step.onRejected) walkSteps(step.onRejected, `${path}.onRejected`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
      if (step.onTimeout) walkSteps(step.onTimeout, `${path}.onTimeout`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
    }
    if (step.kind === "validation" && step.inlineBranch) {
      walkSteps(step.inlineBranch.ok, `${path}.inlineBranch.ok`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
      walkSteps(step.inlineBranch.ng, `${path}.inlineBranch.ng`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.errorHandling?.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) {
          walkSteps(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, known, loopItems, envVarNames, actionInputs, stepIndex, issues);
        }
      });
    }
  });
}

/**
 * `@var.<scope>.<name>` / `@var.<name>` (shorthand) の grammar-aware 検証 (#1289)。
 * RFC #1264 verdict / process-flow-variables.md §3.6 の 6 scope 仕様に従う。
 *
 * - 明示 scope (path[0] が VAR_EXPLICIT_SCOPES の値):
 *   - flowParameter / action / loop: path[1] が対応 scope set に存在
 *   - step / tx: path[1]=stepId が stepIndex に存在 + path[2]=name が当該 step の binding と一致
 *   - global: silent pass (project-level、#1310 で generic-definitions/global catalog 化済、catalog 突合は別 PR で連動予定)
 * - shorthand (path[0] が 6 scope keyword 以外): path[0] を lexical chain (known + loopItems) で検索
 */
function checkVarReference(
  refPath: string[],
  fieldPath: string,
  known: Set<string>,
  loopItems: Set<string>,
  actionInputs: Set<string>,
  stepIndex: Map<string, Step>,
  issues: IdentifierIssue[],
): void {
  if (refPath.length === 0) {
    issues.push({
      path: fieldPath,
      code: "UNKNOWN_IDENTIFIER",
      identifier: "var",
      message: "@var は単独では参照不可。`@var.<scope>.<name>` または shorthand `@var.<name>` で指定してください",
    });
    return;
  }
  const scope = refPath[0];

  // shorthand `@var.<name>` — path[0] が 6 scope keyword でなければ name 扱い
  if (!VAR_EXPLICIT_SCOPES.has(scope)) {
    if (!known.has(scope) && !loopItems.has(scope)) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.${scope}`,
        message: `@var.${scope} (shorthand): ${scope} がこのスコープで宣言されていません (inputs / outputs / outputBinding / ambientVariables / loop item のいずれにも無い)`,
      });
    }
    return;
  }

  // 明示 scope: path[1] が name (step/tx の場合は path[1]=stepId、path[2]=name)
  if (scope === "global") return; // silent pass、project-level は別 validator

  if (scope === "flowParameter") {
    const name = refPath[1];
    if (!name) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: "var.flowParameter",
        message: "@var.flowParameter.<name> の <name> 部分が欠落",
      });
      return;
    }
    if (!actionInputs.has(name)) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.flowParameter.${name}`,
        message: `@var.flowParameter.${name}: ${name} は action.inputs に宣言されていません`,
      });
    }
    return;
  }

  if (scope === "action") {
    const name = refPath[1];
    if (!name) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: "var.action",
        message: "@var.action.<name> の <name> 部分が欠落",
      });
      return;
    }
    if (!known.has(name)) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.action.${name}`,
        message: `@var.action.${name}: ${name} は action scope (inputs / outputs / outputBinding) に宣言されていません`,
      });
    }
    return;
  }

  if (scope === "loop") {
    const name = refPath[1];
    if (!name) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: "var.loop",
        message: "@var.loop.<name> の <name> 部分が欠落",
      });
      return;
    }
    if (!loopItems.has(name)) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.loop.${name}`,
        message: `@var.loop.${name}: ${name} は enclosing loop の collectionItemName / collectionIndexName に宣言されていません`,
      });
    }
    return;
  }

  if (scope === "step") {
    const stepId = refPath[1];
    const name = refPath[2];
    if (!stepId || !name) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.step.${refPath.slice(1).join(".") || "(missing)"}`,
        message: "@var.step.<step-id>.<name> の step-id または <name> 部分が欠落",
      });
      return;
    }
    const step = stepIndex.get(stepId);
    if (!step) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.step.${stepId}`,
        message: `@var.step.${stepId}: step-id "${stepId}" が action 内に存在しません`,
      });
      return;
    }
    // #1289 独立レビュー follow-up: step scope name validation policy
    //
    // canonical 仕様 (process-flow-variables.md §3.6) は `@var.step.<step-id>.<name>` で
    // `<name>` が step の outputBinding.name と一致することを要求する。それ以降の path
    // segment (`<name>.<field>` 以降) は binding object の field access であり、本 validator
    // では型解析を行わず free-form として受容する (例: dbAccess の SELECT 結果 row の各列、
    // transformations で変換された各 field、object 型 outputBinding の sub-field 等は
    // 全て name 以降の path として扱う)。
    //
    // outputBinding を持たない step (例: ReturnStep / LogStep / displayUpdate 等) への
    // `@var.step.<id>.<anything>` 参照は silent pass (検証 skip)。理由: 一部の step は
    // 暗黙的に値を産み出す可能性があり (例: ReturnStep の response object)、厳密 error 化は
    // 過剰検出になり得るため、本 PR ではそれらを許容する保守的方針を採用。
    const bindName = step.outputBinding?.name;
    if (bindName && bindName !== name) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.step.${stepId}.${name}`,
        message: `@var.step.${stepId}.${name}: step "${stepId}" の outputBinding.name は "${bindName}" であり "${name}" と一致しません`,
      });
    }
    return;
  }

  if (scope === "tx") {
    const stepId = refPath[1];
    const name = refPath[2];
    if (!stepId || !name) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.tx.${refPath.slice(1).join(".") || "(missing)"}`,
        message: "@var.tx.<step-id>.<name> の step-id または <name> 部分が欠落",
      });
      return;
    }
    const step = stepIndex.get(stepId);
    if (!step) {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.tx.${stepId}`,
        message: `@var.tx.${stepId}: step-id "${stepId}" が action 内に存在しません`,
      });
      return;
    }
    if (!isBuiltinStep(step) || step.kind !== "transactionScope") {
      issues.push({
        path: fieldPath,
        code: "UNKNOWN_IDENTIFIER",
        identifier: `var.tx.${stepId}`,
        message: `@var.tx.${stepId}: step "${stepId}" は transactionScope ではありません (kind=${(step as { kind?: string }).kind})`,
      });
      return;
    }
    // 予約値 (committed / error / diagnostics) は常時参照可
    if (TX_RESERVED_VALUES.has(name)) return;
    // expose で明示宣言された inner var は OK
    const exposed = step.outputBinding?.expose ?? [];
    if (Array.isArray(exposed) && exposed.includes(name)) return;
    // expose 未宣言: TX scope 越境禁止 (process-flow-variables.md §3.7 / Check 32 で別途厳密検出)
    // identifierScope は silent pass (Check 32 が detect 担当)
    return;
  }
}

/** 1 step の式フィールドを全走査、@ 識別子を known と突合 */
function checkStep(
  step: Step,
  path: string,
  availableIn: Set<string>,
  known: Set<string>,
  loopItems: Set<string>,
  actionInputs: Set<string>,
  stepIndex: Map<string, Step>,
  envVarNames: Set<string>,
  issues: IdentifierIssue[],
): void {
  // 拡張 step の固有 property は config に閉じるため、組み込み step に絞って検査
  if (!isBuiltinStep(step)) return;
  // ValidationStep は自分自身の rules[] 評価結果を同じ step の ngBodyExpression
  // で使う (同時に可視) ので、available に足してから式チェック。
  // #1221: fieldErrorsVar は schema-level で必須宣言されるため null fallback はしない。
  const available = new Set(availableIn);
  if (step.kind === "validation" && step.fieldErrorsVar) {
    available.add(step.fieldErrorsVar);
  }
  const knownForVar = new Set(known);
  if (step.kind === "validation" && step.fieldErrorsVar) {
    knownForVar.add(step.fieldErrorsVar);
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
    const refs = extractReferences(src);
    for (const { root, path: refPath } of refs) {
      if (root === "env") {
        const [key, subfield] = refPath;
        if (key && !subfield && envVarNames.has(key)) continue;
        issues.push({
          path: `${path}.${field}`,
          code: "UNKNOWN_IDENTIFIER",
          identifier: key ? `env.${refPath.join(".")}` : "env",
          message: `@env.${refPath.join(".")} が envVars catalog (project + flow merged) で宣言されていません`,
        });
        continue;
      }
      // #1289: @var.<scope>.<name> grammar-aware check
      if (root === "var") {
        checkVarReference(refPath, `${path}.${field}`, knownForVar, loopItems, actionInputs, stepIndex, issues);
        continue;
      }
      // 組み込み関数・グローバル識別子は宣言不要
      if (BUILTIN_AMBIENTS.has(root)) continue;
      if (!available.has(root)) {
        issues.push({
          path: `${path}.${field}`,
          code: "UNKNOWN_IDENTIFIER",
          identifier: root,
          message: `@${root} がこのスコープで宣言されていません (inputs / outputs / outputBinding / ambientVariables / loop item のいずれにも無い)`,
        });
      }
    }
  }
}
