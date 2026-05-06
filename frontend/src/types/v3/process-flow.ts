/**
 * v3 ProcessFlow 型定義 (`schemas/v3/process-flow.v3.schema.json` と 1:1 対応)
 *
 * - root 4 セクション: meta / context / actions / authoring
 * - 22 step variants (validation / dbAccess / externalSystem / commonProcess / screenTransition /
 *   displayUpdate / branch / loop / loopBreak / loopContinue / jump / compute / return / log /
 *   audit / workflow / transactionScope / eventPublish / eventSubscribe / closing / cdc / extension)
 * - WorkflowApprover.order semantics (#539 R5-2) を JSDoc で明示
 * - datetime 算術 duration() 推奨 (#539 R5-3) を JSDoc で明示
 *
 * 参考: schemas/v3/process-flow.v3.schema.json
 */

import type {
  Authoring,
  Description,
  DisplayName,
  ErrorCode,
  EventTopic,
  ExpressionString,
  FieldType,
  Identifier,
  LocalId,
  Maturity,
  Mode,
  Note,
  ProcessFlowId,
  ScreenId,
  StructuredField,
  TableColumnRef,
  TableId,
  Timestamp,
} from "./common";

// ─── ProcessFlowKind ───────────────────────────────────────────────────────

/** ProcessFlow の組み込み種別。 */
export type BuiltinProcessFlowKind = "screen" | "batch" | "scheduled" | "system" | "common" | "other";

/**
 * ProcessFlow の種別。組み込み + 拡張 (namespace:kindName)。
 * 拡張パターン: `^[a-z][a-z0-9_-]*:[a-z][a-zA-Z0-9]*$`
 */
export type ProcessFlowKind = BuiltinProcessFlowKind | string;

// ─── Sla ──────────────────────────────────────────────────────────────────

/** SLA / Timeout 設定。ProcessFlow / Action / Step の 3 レベルで使用可。 */
export interface Sla {
  timeoutMs?: number;
  onTimeout?: "throw" | "continue" | "compensate" | "log";
  errorCode?: ErrorCode;
  warningThresholdMs?: number;
  p95LatencyMs?: number;
}

// ─── Meta ─────────────────────────────────────────────────────────────────

/** ProcessFlow の identity と運用設定。EntityMeta + ProcessFlow 固有。 */
export interface ProcessFlowMeta {
  // EntityMeta inherited
  id: ProcessFlowId;
  name: DisplayName;
  description?: Description;
  version?: string;
  maturity?: Maturity;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // ProcessFlow 固有
  kind: ProcessFlowKind;
  /** kind='screen' の場合に紐付く Screen の Uuid。 */
  screenId?: ScreenId;
  /** ProcessFlow が公開する API のバージョン (例: `v1`, `2026-04-25`)。 */
  apiVersion?: string;
  mode?: Mode;
  sla?: Sla;
  /** 主たる呼び出し元 (#624、任意、designer 補完精度向上用)。 */
  primaryInvoker?: PrimaryInvoker;
}

/**
 * 処理フローの主たる呼び出し元 (#624)。任意メタ情報、実行時には参照されない。
 * 副次的呼び出し (他画面 / batch / 他フロー) は宣言不要 — 画面項目側 events[].handlerFlowId
 * のみで成立する。現状は kind='screen-item-event' のみ対応 (将来拡張余地あり)。
 */
export type PrimaryInvoker = {
  kind: "screen-item-event";
  screenId: ScreenId;
  itemId: string;
  eventId: string;
};

// ─── Context (catalogs / ambientVariables / health / readiness / resources) ──

/** エラーコード catalog エントリ。 */
export interface ErrorCatalogEntry {
  httpStatus?: number;
  defaultMessage?: string;
  /** Action.responses[].id 参照。 */
  responseId?: LocalId;
  description?: Description;
}

/** 外部システム認証定義 (旧 ENV: / SECRET: 形式は v3 廃止、@secret.<key> 推奨)。 */
export interface ExternalAuth {
  kind: "bearer" | "basic" | "apiKey" | "oauth2" | "none";
  /** `@secret.<key>` 推奨。 */
  tokenRef?: string;
  headerName?: string;
}

/** リトライポリシー。 */
export interface RetryPolicy {
  maxAttempts: number;
  backoff?: "fixed" | "exponential";
  initialDelayMs?: number;
}

/** 外部システム catalog エントリ。 */
export interface ExternalSystemCatalogEntry {
  name: DisplayName;
  baseUrl?: string;
  /** OpenAPI spec への URL または相対パス。 */
  openApiSpec?: string;
  auth?: ExternalAuth;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  headers?: Record<string, string>;
  description?: Description;
}

/** Secrets catalog エントリ。 */
export interface SecretEntry {
  source: "env" | "vault" | "file";
  /** source ごとの参照名 (env=環境変数名 / vault=path / file=パス)。 */
  name: string;
  description?: Description;
  rotationDays?: number;
  lastRotatedAt?: Timestamp;
  /** 環境別の参照式 (vault://... / env://... 等)。実値は含まない。 */
  values?: Record<string, string>;
}

/** 環境変数 catalog エントリ。 */
export interface EnvVarEntry {
  type: "string" | "number" | "boolean";
  description?: Description;
  /** 環境別の値 (キー: dev/staging/prod 等)。 */
  values?: Record<string, unknown>;
  default?: unknown;
}

/** バリデーションルール (DomainEntry.constraints / ValidationStep.rules で使用)。 */
export interface ValidationRule {
  /** 対象フィールドパス (例: `email`, `items[*].quantity`)。 */
  field: string;
  type: "required" | "regex" | "maxLength" | "minLength" | "range" | "enum" | "custom";
  /**
   * 違反時の振る舞い。`Step.kind` 等の discriminator と多義性回避のため `severity` と命名 (旧 `kind` から rename)。
   * - `error`: エラー表示しブロック
   * - `msg`: メッセージのみ表示続行可
   * - `noaccept`: 値を受け付けない
   * - `default`: 既定値設定
   */
  severity?: "error" | "msg" | "noaccept" | "default";
  pattern?: string;
  /** `@conv.regex.<key>` 参照。 */
  patternRef?: string;
  length?: number;
  min?: number;
  max?: number;
  /** `@conv.limit.<key>` 参照。 */
  minRef?: string;
  /** `@conv.limit.<key>` 参照。 */
  maxRef?: string;
  /** `@conv.limit.<key>` 参照 (length の代替)。loader 段階で integer 値に展開される。 */
  lengthRef?: string;
  values?: string[];
  condition?: ExpressionString;
  /** 違反メッセージ (`@conv.msg.<key>` 推奨)。 */
  message?: string;
}

/** ドメイン型 catalog エントリ。 */
export interface DomainEntry {
  type: FieldType;
  constraints?: ValidationRule[];
  /** UI 表示ヒント (例: `email`, `tel`, `textarea`)。 */
  uiHint?: string;
  description?: Description;
}

/** 組み込み関数 catalog エントリ。 */
export interface FunctionEntry {
  /** 関数シグネチャ (例: `formatCurrency(amount: number, currency: string): string`)。 */
  signature: string;
  returnType: string;
  description: Description;
  examples?: string[];
}

/** イベント pub/sub catalog エントリ。 */
export interface EventEntry {
  description?: Description;
  /** ペイロードの JSON Schema (draft 2020-12)。 */
  payload?: Record<string, unknown>;
}

/** ProcessFlow 内 catalog 群を階層化集約。 */
export interface Catalogs {
  /** エラーコード catalog。キー: ErrorCode (UPPER_SNAKE)。 */
  errors?: Record<string, ErrorCatalogEntry>;
  /** 外部システム catalog。キー: systemId (Identifier / camelCase)。 */
  externalSystems?: Record<string, ExternalSystemCatalogEntry>;
  /** Secrets catalog。キー: secretKey (Identifier / camelCase)。 */
  secrets?: Record<string, SecretEntry>;
  /** 環境変数 catalog。キー: EnvVarKey (UPPER_SNAKE)。 */
  envVars?: Record<string, EnvVarEntry>;
  /** ドメイン型 catalog。キー: ドメイン名 (PascalCase)。 */
  domains?: Record<string, DomainEntry>;
  /** 組み込み関数 catalog。キー: 関数名 (Identifier / camelCase)。 */
  functions?: Record<string, FunctionEntry>;
  /** イベント catalog。キー: EventTopic (dot.lowercase + underscore)。 */
  events?: Record<string, EventEntry>;
}

/** 健全性チェック 1 件。 */
export interface HealthCheck {
  name: DisplayName;
  kind: "db" | "http" | "custom";
  target?: string;
  timeout?: number;
}

/** 健全性チェックグループ。 */
export interface HealthCheckGroup {
  checks: HealthCheck[];
}

/** Readiness チェックグループ。 */
export interface ReadinessCheckGroup {
  checks: HealthCheck[];
  minimumPassCount?: number;
}

/** リソース割当 (CPU / Memory)。 */
export interface ResourceQuota {
  request?: string;
  limit?: string;
}

/** リソース要件。 */
export interface ResourceRequirements {
  cpu?: ResourceQuota;
  memory?: ResourceQuota;
  dbConnections?: number;
  timeout?: number;
}

/** 実行に必要な参照情報 (catalog 群 / ambient / 健全性 / リソース)。 */
export interface Context {
  catalogs?: Catalogs;
  /** ミドルウェア由来の自動注入変数 (`@requestId` / `@traceId` / `@fieldErrors` 等)。 */
  ambientVariables?: StructuredField[];
  /** 規約カタログ defaults の本フロー固有 override。 */
  ambientOverrides?: Record<string, string>;
  health?: HealthCheckGroup;
  readiness?: ReadinessCheckGroup;
  resources?: ResourceRequirements;
}

// ─── ActionDefinition / HttpRoute / HttpResponseSpec ────────────────────

/** Action の HTTP route。 */
export interface HttpRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** URL パターン。例: `/api/orders`, `/api/orders/:id` */
  path: string;
  auth?: "required" | "optional" | "none";
}

/** Action.trigger (組み込み + 拡張)。 */
export type ActionTrigger =
  | "click"
  | "submit"
  | "select"
  | "change"
  | "load"
  | "timer"
  | "auto"
  | "other"
  | string; // namespace:kind 形式の拡張

/** Response body schema (typeRef または inline schema の oneOf)。 */
export type BodySchema =
  | { typeRef: string; schema?: never }
  | { schema: Record<string, unknown>; typeRef?: never };

/** HTTP response 仕様。 */
export interface HttpResponseSpec {
  /** Response ID (例: `201-created`, `400-validation`)。 */
  id: LocalId;
  status: number;
  contentType?: string;
  bodySchema?: BodySchema;
  description?: Description;
  /** 発生条件 (人間向け説明)。 */
  when?: string;
}

/** Action 1 件の定義。 */
export interface ActionDefinition {
  id: LocalId;
  name: DisplayName;
  trigger: ActionTrigger;
  /** GrapesJS の DOM 要素 ID (画面側からの紐付け用)。 */
  elementRef?: string;
  description?: Description;
  inputs?: StructuredField[];
  outputs?: StructuredField[];
  maturity?: Maturity;
  sla?: Sla;
  /** `@conv.permission.<key>` または permission キー名。 */
  requiredPermissions?: string[];
  httpRoute?: HttpRoute;
  responses?: HttpResponseSpec[];
  steps: Step[];
}

// ─── StepBaseProps (全 Step variant 共通) ──────────────────────────────

/** outputBinding.transformations の 1 エントリ。SELECT 結果列の型変換指示。 */
export interface OutputBindingTransformation {
  /** 変換対象の column 名 (SELECT alias 名)。例: "itemCount"、"totalAmount"。 */
  field: string;
  /**
   * 変換後の型。
   * - integer: parseInt
   * - float: parseFloat
   * - boolean: truthy 判定
   * - date: new Date
   * - json: JSON.parse
   */
  type: "integer" | "float" | "boolean" | "date" | "json";
}

/** Step 結果の outputBinding (構造化のみ、v3 で string 短縮形廃止)。 */
export interface OutputBinding {
  /** 結果変数名 (Identifier / camelCase)。 */
  name: Identifier;
  /** 代入方式。assign=上書き / accumulate=数値加算 / push=配列追加。既定: assign。 */
  operation?: "assign" | "accumulate" | "push";
  /** accumulate / push 時の初期値。JSON 値 (例: 0, []) または式文字列。 */
  initialValue?: unknown;
  /**
   * 結果列の型変換指示。runtime が SELECT 結果を binding に格納する前に各 field の型を変換する。
   * SQL 方言 (PG COUNT(*)→bigint→string、SUM(...)→decimal→string 等) を吸収する責務を
   * フレームワーク側に持たせ、SQL を DB 中立に保つ。SQL 側に CAST(...) を書く必要がなくなる。
   */
  transformations?: OutputBindingTransformation[];
}

/** TX 境界宣言。txId 単位で begin/member/end を結合。 */
export interface TxBoundary {
  role: "begin" | "member" | "end";
  txId: LocalId;
}

/** 外部呼び出しチェーン (multi-phase external system call)。 */
export interface ExternalChain {
  chainId: LocalId;
  phase: "authorize" | "capture" | "cancel" | "other";
}

/** DataLineage 1 エントリ。 */
export interface LineageEntry {
  tableId: TableId;
  /** 読み取り/書き込みの目的 (例: `lookup`, `lock`, `audit`, `snapshot`, `soft-delete`)。 */
  purpose?: string;
  description?: Description;
}

/** DbAccess (および任意の step) のデータ系譜。 */
export interface DataLineage {
  reads?: LineageEntry[];
  writes?: LineageEntry[];
}

/**
 * 全 Step variant 共通のプロパティ集合。
 * 各 variant は本定義を allOf でマージし、固有プロパティを追加 + unevaluatedProperties: false で閉じる。
 * #525 R3 fix: lineage を StepBaseProps に集約 (全 22 step variant で利用可能)。
 */
export interface StepBaseProps {
  id: LocalId;
  description?: Description;
  notes?: Note[];
  maturity?: Maturity;
  sla?: Sla;
  /** 実行条件式。false なら本 step を skip。 */
  runIf?: ExpressionString;
  requiredPermissions?: string[];
  outputBinding?: OutputBinding;
  /** TX 境界宣言。簡易フラグの transactional は v3 で廃止 (txBoundary に統一)。 */
  txBoundary?: TxBoundary;
  /** Saga 補償対象の Step.id 参照。 */
  compensatesFor?: LocalId;
  externalChain?: ExternalChain;
  /**
   * 本 step が読み書きするデータ系譜 (CDC / 監査 / 影響範囲分析用)。
   * #525 F-2 で StepBaseProps に集約、全 step variant で宣言可能。
   */
  lineage?: DataLineage;
}

// ─── ValidationStep ─────────────────────────────────────────────────────

/** ValidationStep 内インライン分岐。 */
export interface ValidationInlineBranch {
  /** OK 時の後続 step 列。 */
  ok: Step[];
  /** NG 時の後続 step 列。 */
  ng: Step[];
  ngJumpTo?: LocalId;
  /** NG 時の Response.id 参照。 */
  ngResponseId?: LocalId;
  ngBodyExpression?: ExpressionString;
  /** NG 時に eventPublish を実行してから ngResponseId を返す。 */
  ngEventPublish?: {
    topic: EventTopic;
    payload: ExpressionString;
  };
}

export interface ValidationStep extends StepBaseProps {
  kind: "validation";
  description: Description;
  /** 人間向けバリデーション概要。 */
  conditions?: string;
  rules?: ValidationRule[];
  /** rules[] 結果格納変数名。既定: `fieldErrors`。 */
  fieldErrorsVar?: Identifier;
  inlineBranch?: ValidationInlineBranch;
}

// ─── DbAccessStep ───────────────────────────────────────────────────────

/** DB 操作。組み込み + 拡張 (namespace:UPPER_SNAKE)。 */
export type DbOperation =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "MERGE"
  | "LOCK"
  | string; // namespace:UPPER_SNAKE

/** 影響行数チェック。 */
export interface AffectedRowsCheck {
  operator: ">" | ">=" | "=" | "<" | "<=";
  expected: number;
  onViolation: "throw" | "abort" | "log" | "continue";
  errorCode?: ErrorCode;
  description?: Description;
}

/** キャッシュヒント。 */
export interface CacheHint {
  ttlSeconds: number;
  key?: ExpressionString;
  invalidateOn?: EventTopic[];
  description?: Description;
}

export interface DbAccessStep extends StepBaseProps {
  kind: "dbAccess";
  description: Description;
  /** 対象 Table の Uuid (物理名直書きは v3 廃止)。 */
  tableId: TableId;
  operation: DbOperation;
  /** 対象フィールド (人間向け簡易表記)。 */
  fields?: string;
  /** 完全 SQL 文 (式補間は @<var> / @conv.* / @env.* 等)。 */
  sql?: string;
  /** 一括 INSERT 時に VALUES に展開する配列変数の式。 */
  bulkValues?: ExpressionString;
  affectedRowsCheck?: AffectedRowsCheck;
  cache?: CacheHint;
}

// ─── ExternalSystemStep ─────────────────────────────────────────────────

/** Arazzo 互換の成功判定条件。 */
export interface Criterion {
  type: "simple" | "regex" | "jsonpath" | "xpath";
  /** Arazzo Runtime Expression ($ 記法) 推奨。 */
  expression: string;
  context?: string;
}

/** 外部 HTTP 呼び出しの記述。 */
export interface ExternalHttpCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: ExpressionString;
}

/** 外部呼び出しの結果分岐定義。 */
export interface ExternalCallOutcomeSpec {
  action: "continue" | "abort" | "compensate";
  description?: Description;
  jumpTo?: LocalId;
  sideEffects?: NonReturnStep[];
  sameAs?: "success" | "failure" | "timeout";
}

/** 外部呼び出し結果の 3 分岐 (success / failure / timeout)。 */
export interface ExternalCallOutcomes {
  success?: ExternalCallOutcomeSpec;
  failure?: ExternalCallOutcomeSpec;
  timeout?: ExternalCallOutcomeSpec;
}

/** Circuit breaker config。 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  timeout: number;
  halfOpenMaxCalls?: number;
}

/** Bulkhead config。 */
export interface BulkheadConfig {
  maxConcurrent: number;
  maxWait?: number;
}

export interface ExternalSystemStep extends StepBaseProps {
  kind: "externalSystem";
  description: Description;
  /** ProcessFlow.context.catalogs.externalSystems のキー参照 (Identifier / camelCase)。 */
  systemRef: Identifier;
  httpCall?: ExternalHttpCall;
  /** OpenAPI operation 参照 (例: `/v1/payment_intents POST`)。 */
  operationRef?: string;
  operationId?: string;
  /** OpenAPI request body schema への JSON Pointer。 */
  requestBodyRef?: string;
  responseRef?: string;
  outcomes?: ExternalCallOutcomes;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  circuitBreaker?: CircuitBreakerConfig;
  bulkhead?: BulkheadConfig;
  fireAndForget?: boolean;
  auth?: ExternalAuth;
  idempotencyKey?: ExpressionString;
  headers?: Record<string, string>;
  apiVersion?: string;
  cache?: CacheHint;
  successCriteria?: Criterion[];
}

// ─── 残り 19 step variants ─────────────────────────────────────────────

export interface CommonProcessStep extends StepBaseProps {
  kind: "commonProcess";
  description: Description;
  /** 呼び出し先 ProcessFlow の Uuid (kind='common' の他フロー)。 */
  refId: ProcessFlowId;
  /** 呼び先 inputs 名 → 引数式の対応。 */
  argumentMapping?: Record<string, ExpressionString>;
  /** 呼び先 outputs 名 → 説明 / バインド先の対応。 */
  returnMapping?: Record<string, string>;
}

export interface ScreenTransitionStep extends StepBaseProps {
  kind: "screenTransition";
  description: Description;
  targetScreenId: ScreenId;
}

export interface DisplayUpdateStep extends StepBaseProps {
  kind: "displayUpdate";
  description: Description;
  /** 更新対象 (式 / DOM / variable)。 */
  target: string;
}

/** Branch 1 件 (kind=expression 等の discriminated union)。 */
export type BranchCondition =
  | { kind: "expression"; expression: ExpressionString }
  | { kind: "tryCatch"; errorCode: ErrorCode; description?: Description }
  | { kind: "affectedRowsZero"; stepId?: LocalId; description?: Description }
  | {
      kind: "externalOutcome";
      stepId?: LocalId;
      outcome: "success" | "failure" | "timeout";
      description?: Description;
    };

export interface Branch {
  id: LocalId;
  /** 1 文字大文字 (A/B/C...)。 */
  code: string;
  label?: DisplayName;
  condition: BranchCondition;
  steps: Step[];
}

export interface ElseBranch {
  id: LocalId;
  /** 通常 'X' 等の最終枠を使用。 */
  code: string;
  label?: DisplayName;
  description?: Description;
  steps: Step[];
}

export interface BranchStep extends StepBaseProps {
  kind: "branch";
  description: Description;
  branches: Branch[];
  elseBranch?: ElseBranch;
  /** tryCatch 分岐の try 範囲となる Step.id 列。 */
  tryScope?: LocalId[];
}

export interface LoopStep extends StepBaseProps {
  kind: "loop";
  description: Description;
  loopKind: "count" | "condition" | "collection";
  countExpression?: ExpressionString;
  conditionMode?: "continue" | "exit";
  conditionExpression?: ExpressionString;
  collectionSource?: ExpressionString;
  collectionItemName?: Identifier;
  steps: Step[];
}

export interface LoopBreakStep extends StepBaseProps {
  kind: "loopBreak";
  description: Description;
}

export interface LoopContinueStep extends StepBaseProps {
  kind: "loopContinue";
  description: Description;
}

export interface JumpStep extends StepBaseProps {
  kind: "jump";
  description: Description;
  jumpTo: LocalId;
}

export interface ComputeStep extends StepBaseProps {
  kind: "compute";
  description: Description;
  expression: ExpressionString;
}

export interface ReturnStep extends StepBaseProps {
  kind: "return";
  description: Description;
  /** Action.responses[].id 参照。 */
  responseId?: LocalId;
  bodyExpression?: ExpressionString;
}

export interface LogStep extends StepBaseProps {
  kind: "log";
  description: Description;
  level: "trace" | "debug" | "info" | "warn" | "error";
  message: string;
  category?: string;
  structuredData?: Record<string, string>;
}

export interface AuditStep extends StepBaseProps {
  kind: "audit";
  description: Description;
  /** 監査対象アクション (例: `order.confirm`)。 */
  action: string;
  resource?: { type: string; id: string };
  result?: "success" | "failure";
  reason?: string;
  sensitive?: boolean;
}

// ─── WorkflowStep ──────────────────────────────────────────────────────

export type WorkflowPattern =
  | "approval-sequential"
  | "approval-parallel"
  | "approval-veto"
  | "approval-quorum"
  | "approval-escalation"
  | "review"
  | "sign-off"
  | "acknowledge"
  | "branch-merge"
  | "discussion"
  | "ad-hoc";

/**
 * Workflow 承認者。
 *
 * `order` の semantics は `pattern` ごとに異なる (#539 R5-2):
 * - `approval-sequential`: 承認の**実行順序** (1, 2, 3 = 担当→課長→部長)
 * - `approval-parallel` / `branch-merge` / `approval-quorum`: 無視 (規約として全員 `order: 1`)
 * - `approval-veto`: 通常無視 (拒否権発動なので順序不要)。実装が「先着 1 reject で打ち切り」を採用するなら順序が意味を持つが、本 spec では順序非依存とする (全員 `order: 1` 推奨)
 * - `approval-escalation`: 通常 `order: 1` (escalateTo 経由で次層を表現)
 * - `review` / `sign-off` / `acknowledge`: 通常 1 名構成、`order: 1` 固定
 * - `discussion`: 無視 (議論順序を spec で固定しない)
 * - `ad-hoc`: 自由解釈 (運用が決める)
 *
 * 詳細: docs/spec/process-flow-workflow.md §WorkflowApprover
 */
export interface WorkflowApprover {
  /** `@conv.role.<key>` 推奨。 */
  role: string;
  label?: DisplayName;
  order?: number;
}

/** 定足数承認の成立条件。 */
export interface WorkflowQuorum {
  type: "all" | "any" | "majority" | "nOfM";
  /** type='nOfM' の場合に必須。 */
  n?: number;
}

export interface WorkflowStep extends StepBaseProps {
  kind: "workflow";
  description: Description;
  pattern: WorkflowPattern;
  approvers: WorkflowApprover[];
  /** pattern='approval-quorum' で必須。 */
  quorum?: WorkflowQuorum;
  onApproved?: Step[];
  onRejected?: Step[];
  onTimeout?: Step[];
  /**
   * 期限式。datetime 算術は `duration('PnDTnHnMnS')` 形式推奨 (#539 R5-3)。
   * 例: `@submittedAt + duration('P2D')`
   */
  deadlineExpression?: ExpressionString;
  /** ISO 8601 期間。pattern='approval-escalation' で必須。例: `duration('P1D')` */
  escalateAfter?: string;
  /** pattern='approval-escalation' で必須。 */
  escalateTo?: {
    /** `@conv.role.<key>` */
    role?: string;
    userExpression?: ExpressionString;
  };
}

// ─── TransactionScopeStep ──────────────────────────────────────────────

/**
 * TX スコープ step。`outputBinding` を指定すると TX 結果が以下の semantics で expose される:
 *
 * - TX commit 成功: `@<name>.committed === true`、`@<name>.error` は未定義
 * - TX rollback (rollbackOn のエラー): `@<name>.committed === false`、`@<name>.error.code` = エラーコード、`@<name>.error.message` = 例外メッセージ
 * - TX rollback (rollbackOn 外の汎用エラー): `@<name>.committed === false`、`@<name>.error.code === "UNHANDLED"`
 *
 * 後続 branch の `condition.kind: "expression"` で `@txResult.error.code === 'STOCK_SHORTAGE'` のように参照する。
 * 参照: docs/spec/process-flow-transaction.md §8.5、ISSUE #782
 */
export interface TransactionScopeStep extends StepBaseProps {
  kind: "transactionScope";
  description: Description;
  isolationLevel?: "READ_COMMITTED" | "REPEATABLE_READ" | "SERIALIZABLE";
  propagation?: "REQUIRED" | "REQUIRES_NEW" | "NESTED";
  timeoutMs?: number;
  /** ProcessFlow.context.catalogs.errors のキー参照。 */
  rollbackOn?: ErrorCode[];
  steps: Step[];
  onCommit?: Step[];
  onRollback?: Step[];
  outcomes?: ExternalCallOutcomes;
}

// ─── EventPublishStep / EventSubscribeStep ─────────────────────────────

export interface EventPublishStep extends StepBaseProps {
  kind: "eventPublish";
  description: Description;
  /** 発行先 topic。同時に context.catalogs.events のキーとして登録されている必要がある (eventRef 二重持ちは v3 廃止)。 */
  topic: EventTopic;
  payload?: ExpressionString;
}

export interface EventSubscribeStep extends StepBaseProps {
  kind: "eventSubscribe";
  description: Description;
  topic: EventTopic;
  filter?: ExpressionString;
}

// ─── ClosingStep ────────────────────────────────────────────────────────

export interface ClosingStep extends StepBaseProps {
  kind: "closing";
  description: Description;
  period: "daily" | "monthly" | "quarterly" | "yearly" | "custom";
  customCron?: string;
  /**
   * 締切時刻 (HH:MM または HH:MM:SS、24 時間表記、timezone なし)。例: `23:59:59`、`23:59`、`00:00:00`。
   * pattern: `^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$` (#533 R3-2)
   */
  cutoffAt?: string;
  idempotencyKey?: ExpressionString;
  rollbackOnFailure?: boolean;
}

// ─── CdcStep ──────────────────────────────────────────────────────────

/** CDC 出力先 (discriminated union)。 */
export type CdcDestination =
  | { kind: "auditLog"; auditAction: string }
  | { kind: "eventStream"; topic: EventTopic }
  | { kind: "table"; tableId: TableId };

export interface CdcStep extends StepBaseProps {
  kind: "cdc";
  description: Description;
  /** 対象 Table の Uuid 配列。 */
  tableIds: TableId[];
  captureMode: "full" | "incremental";
  destination: CdcDestination;
  includeColumns?: TableColumnRef[];
  excludeColumns?: TableColumnRef[];
}

// ─── ExtensionStep ────────────────────────────────────────────────────

/**
 * 拡張 step (extensions.v3.stepKinds で定義)。
 * kind は namespace:StepName 形式。
 * 固有プロパティは config object に閉じる (loader が拡張定義側 schema で config を検証)。
 */
export interface ExtensionStep extends StepBaseProps {
  /** namespace:StepName 形式 (例: `retail:OrderConfirmStep`)。pattern: `^[a-z][a-z0-9_-]*:[A-Z][A-Za-z0-9]*$` */
  kind: string;
  description: Description;
  config?: Record<string, unknown>;
}

// ─── Step union (22 variants) ──────────────────────────────────────────

/**
 * Step union。kind プロパティで variant を識別。組み込み 21 + ExtensionStep の計 22 variant。
 *
 * AJV `discriminator: true` モードで kind を識別子として 1 branch のみエラー報告 (#525 F-4)。
 * ただし Step.oneOf は ExtensionStep の kind がパターン (`namespace:StepName`) のため
 * AJV strict const 要件を満たさず、schema には discriminator keyword を付けていない。
 */
export type Step =
  | ValidationStep
  | DbAccessStep
  | ExternalSystemStep
  | CommonProcessStep
  | ScreenTransitionStep
  | DisplayUpdateStep
  | BranchStep
  | LoopStep
  | LoopBreakStep
  | LoopContinueStep
  | JumpStep
  | ComputeStep
  | ReturnStep
  | LogStep
  | AuditStep
  | WorkflowStep
  | TransactionScopeStep
  | EventPublishStep
  | EventSubscribeStep
  | ClosingStep
  | CdcStep
  | ExtensionStep;

/** Return を除く Step subset (ExternalCallOutcomeSpec.sideEffects 等で使用)。 */
export type NonReturnStep = Exclude<Step, ReturnStep>;

// ─── ProcessFlow root ────────────────────────────────────────────────────

/**
 * 業務処理フロー entity 1 件分。
 * root を 4 セクション (meta / context / actions / authoring) に再編し、
 * catalog 群を `context.catalogs.<kind>` に階層化することで意味付けと拡張性を確保する。
 */
export interface ProcessFlow {
  $schema?: string;
  meta: ProcessFlowMeta;
  context?: Context;
  /** 実行ロジック本体。0 件も許容 (placeholder ProcessFlow 用)。 */
  actions: ActionDefinition[];
  /** 設計用 (markers / decisions / glossary / notes / testScenarios、実行不要)。 */
  authoring?: Authoring;
}
