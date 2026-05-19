import type * as V3ProcessFlow from "./v3/process-flow";
import type * as V3Common from "./v3/common";

export type V3ProcessFlowTypes = typeof V3ProcessFlow;
export type V3CommonTypes = typeof V3Common;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy process-flow compatibility relies on permissive dictionary values.
type AnyRecord = Record<string, any>;

export type Maturity = V3Common.Maturity;
export type ProcessFlowMode = V3Common.Mode;
export type ProcessFlowType = V3ProcessFlow.ProcessFlowKind;
export type ProcessFlowKind = V3ProcessFlow.ProcessFlowKind;

export type FieldType = string | AnyRecord;
export type StructuredField = AnyRecord & { name: string; type: FieldType; description?: string };
export type ActionFields = StructuredField[] | string | undefined;

export type MarkerKind = string;
export type Marker = AnyRecord;

// #1186 Phase 1: common.v3 Note.kind enum と完全一致 (assumption / prerequisite / todo / deferred / question)。
// 旧 enum の "decision" / "risk" は schema 外の値で、actionMigration.ts:noteKind で "deferred" に正規化される (read 時 fallback あり)。
export type StepNoteType =
  | "assumption"
  | "prerequisite"
  | "todo"
  | "deferred"
  | "question";
export interface StepNote {
  id: string;
  /** common.v3 Note 規範。v3 schema 上 field 名は `kind` 必須 (旧 `type` は read 互換のみ)。 */
  kind?: StepNoteType;
  /** @deprecated v1/v2 legacy field。新規書込は `kind` を使用。 */
  type?: StepNoteType;
  body: string;
  createdAt: string;
}

export type StepKind =
  | "validation"
  | "dbAccess"
  | "externalSystem"
  | "componentCall"
  | "commonProcess"
  | "screenTransition"
  | "displayUpdate"
  | "branch"
  | "loop"
  | "loopBreak"
  | "loopContinue"
  | "jump"
  | "compute"
  | "return"
  | "log"
  | "audit"
  | "workflow"
  | "transactionScope"
  | "eventPublish"
  | "eventSubscribe"
  | "closing"
  | "cdc"
  | "aiCall"
  | "aiAgent"
  | "extension"
  | "other";
export type StepType = StepKind;

export type Step = AnyRecord;

export type ActionTrigger = string;
export type ActionDefinition = AnyRecord;

export type ProcessFlowMeta = AnyRecord;

export type ProcessFlow = AnyRecord;

export type BranchCondition = string | AnyRecord;
export type BranchConditionVariant = BranchCondition;
export type Branch = AnyRecord & { condition?: BranchCondition; steps?: Step[] };
export type ElseBranch = Branch;
export type OutputBinding = string | AnyRecord;
export type OutputBindingObject = AnyRecord;
export type OutputBindingOperation = "assign" | "accumulate" | "push";

export type ValidationRuleType =
  | "required"
  | "regex"
  | "maxLength"
  | "minLength"
  | "range"
  | "enum"
  | "custom";
// #1186 Phase 1: v3 で完全廃止 (field 名 kind→severity rename + lowerCamelCase に正規化)。Dead code として削除。
export type ValidationRule = AnyRecord & { field?: string; type?: ValidationRuleType; severity?: string };

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type HttpAuthRequirement = "required" | "optional" | "none";
export type HttpRoute = AnyRecord;
export type HttpResponseSpec = AnyRecord;
export type BodySchema = string | AnyRecord;

export type ExternalCallOutcome = "success" | "failure" | "timeout";
export type ExternalCallOutcomeSpec = AnyRecord;
export type ExternalCallOutcomes = AnyRecord;
// #1186 Phase 1: process-flow.v3 ExternalAuth.kind に iamRole / azureAd を追加 (AWS Bedrock / Azure OpenAI 認証、#867 / #939 連動)
export type ExternalAuthKind = "bearer" | "basic" | "apiKey" | "oauth2" | "iamRole" | "azureAd" | "none";
export type ExternalAuth = AnyRecord;

export type Sla = AnyRecord;
export type OnTimeout = "throw" | "continue" | "compensate" | "log";
export type TxBoundaryRole = "begin" | "member" | "end";
export type TxBoundary = AnyRecord & { role?: TxBoundaryRole; txId?: string };
export type TransactionIsolationLevel = "READ_COMMITTED" | "REPEATABLE_READ" | "SERIALIZABLE" | string;
export type TransactionPropagation = "REQUIRED" | "REQUIRES_NEW" | "NESTED" | string;
export type ExternalChainPhase = "authorize" | "capture" | "cancel" | "other";
export type ExternalChain = AnyRecord & { chainId?: string; phase?: ExternalChainPhase };
// #1186 Phase 1: process-flow.v3 LoopStep.loopKind / conditionMode と完全一致 (string 緩和削除、schema 外 enum 削除)
export type LoopKind = "count" | "condition" | "collection";
export type LoopConditionMode = "continue" | "exit";
export type WorkflowPattern = V3ProcessFlow.WorkflowPattern | string;
export type WorkflowApprover = AnyRecord;
export type WorkflowQuorum = AnyRecord;

export type StepBase = Step;
export type ValidationStep = Step;
export type DbAccessStep = Step;
export type ExternalSystemStep = Step;
export type CommonProcessStep = Step;
export type ScreenTransitionStep = Step;
export type DisplayUpdateStep = Step;
export type BranchStep = Step;
export type LoopStep = Step;
export type LoopBreakStep = Step;
export type LoopContinueStep = Step;
export type JumpStep = Step;
export type ComputeStep = Step;
export type ReturnStep = Step;
export type LogStep = Step;
export type AuditStep = Step;
export type WorkflowStep = Step;
export type TransactionScopeStep = Step;
export type EventPublishStep = Step;
export type EventSubscribeStep = Step;
export type ClosingStep = Step;
export type CdcStep = Step;
export type OtherStep = Step;
export type NonReturnStep = Step;

export type AffectedRowsCheck = AnyRecord;
export type CacheHint = AnyRecord;
export type CdcDestination = AnyRecord;
export type Context = AnyRecord;
export type DbOperation = string;
export type EnvVarEntry = AnyRecord;
export type ErrorCatalogEntry = AnyRecord;
export type EventDef = AnyRecord;
export type ExternalSystemCatalogEntry = AnyRecord;
export type FunctionDef = AnyRecord;
export type HealthCheck = AnyRecord;
export type RetryPolicy = AnyRecord;
export type ResourceRequirements = AnyRecord;
export type SecretRef = AnyRecord;
export type DomainDef = AnyRecord;
export type DecisionRecord = AnyRecord;
export type GlossaryEntry = AnyRecord;
export type TestScenario = AnyRecord;
export type TemplateStep = AnyRecord;
export interface StepTemplate {
  id?: string;
  type?: StepKind;
  kind?: StepKind;
  label: string;
  description?: string;
  step?: TemplateStep;
  steps?: TemplateStep[];
}

// #1186 Phase 1: common.v3 Note.kind と完全一致 (5 値、順序は schema 列挙順)
export const STEP_NOTE_TYPE_VALUES: readonly StepNoteType[] = [
  "assumption",
  "prerequisite",
  "todo",
  "deferred",
  "question",
] as const;

export const ACTION_TRIGGER_LABELS: Record<string, string> = {
  click: "クリック",
  submit: "送信",
  select: "選択",
  change: "変更",
  load: "読込",
  unload: "終了",
  timer: "タイマー",
  manual: "手動",
};

export const PROCESS_FLOW_TYPE_LABELS: Record<string, string> = {
  screen: "画面",
  batch: "バッチ",
  scheduled: "定期実行",
  system: "システム",
  common: "共通",
  other: "その他",
};

export const PROCESS_FLOW_TYPE_ICONS: Record<string, string> = {
  screen: "monitor",
  batch: "layers",
  scheduled: "clock",
  system: "server",
  common: "component",
  other: "circle",
};

export const STEP_TYPE_LABELS: Record<string, string> = {
  validation: "入力チェック",
  dbAccess: "DBアクセス",
  externalSystem: "外部システム",
  componentCall: "コンポーネント呼出",
  commonProcess: "共通処理",
  screenTransition: "画面遷移",
  displayUpdate: "表示更新",
  branch: "分岐",
  loop: "ループ",
  loopBreak: "ループ終了",
  loopContinue: "次の繰り返し",
  jump: "ジャンプ",
  compute: "計算/代入",
  return: "レスポンス返却",
  log: "ログ",
  audit: "監査",
  workflow: "ワークフロー",
  transactionScope: "トランザクション",
  eventPublish: "イベント発行",
  eventSubscribe: "イベント購読",
  closing: "締め処理",
  cdc: "CDC",
  aiCall: "AI 呼出",
  aiAgent: "AI エージェント",
  extension: "拡張",
  other: "その他",
};

export const STEP_TYPE_ICONS: Record<string, string> = {
  validation: "check-square",
  dbAccess: "database",
  externalSystem: "plug",
  componentCall: "puzzle",
  commonProcess: "share",
  screenTransition: "arrow-right",
  displayUpdate: "refresh-cw",
  branch: "git-branch",
  loop: "repeat",
  loopBreak: "log-out",
  loopContinue: "skip-forward",
  jump: "corner-up-right",
  compute: "bi-calculator",
  return: "bi-reply",
  log: "file-text",
  audit: "shield-check",
  workflow: "users",
  transactionScope: "box",
  eventPublish: "radio",
  eventSubscribe: "rss",
  closing: "lock",
  cdc: "activity",
  aiCall: "cpu",
  aiAgent: "bi-robot",
  extension: "puzzle",
  other: "circle",
};

export const STEP_TYPE_COLORS: Record<string, string> = {
  validation: "#0f766e",
  dbAccess: "#2563eb",
  externalSystem: "#7c3aed",
  componentCall: "#6366f1",
  commonProcess: "#475569",
  screenTransition: "#16a34a",
  displayUpdate: "#0891b2",
  branch: "#d97706",
  loop: "#ca8a04",
  loopBreak: "#b45309",
  loopContinue: "#a16207",
  jump: "#9333ea",
  compute: "#0284c7",
  return: "#dc2626",
  log: "#64748b",
  audit: "#be123c",
  workflow: "#4f46e5",
  transactionScope: "#1d4ed8",
  eventPublish: "#059669",
  eventSubscribe: "#0d9488",
  closing: "#7f1d1d",
  cdc: "#0369a1",
  aiCall: "#a855f7",
  aiAgent: "#c026d3",
  extension: "#6b7280",
  other: "#6b7280",
};

export const EXTERNAL_CALL_OUTCOME_VALUES: readonly ExternalCallOutcome[] = [
  "success",
  "failure",
  "timeout",
] as const;

export const WORKFLOW_PATTERN_VALUES: readonly WorkflowPattern[] = [
  "approval-sequential",
  "approval-parallel",
  "approval-veto",
  "approval-quorum",
  "approval-escalation",
  "review",
  "sign-off",
  "acknowledge",
  "branch-merge",
  "discussion",
  "ad-hoc",
] as const;

export const WORKFLOW_PATTERN_LABELS: Record<string, string> = {
  "approval-sequential": "順次承認",
  "approval-parallel": "並列承認",
  "approval-veto": "拒否権承認",
  "approval-quorum": "定足数承認",
  "approval-escalation": "エスカレーション承認",
  review: "レビュー",
  "sign-off": "サインオフ",
  acknowledge: "確認",
  "branch-merge": "分岐合流",
  discussion: "議論",
  "ad-hoc": "アドホック",
};

export const DB_OPERATION_LABELS: Record<string, string> = {
  select: "検索",
  insert: "登録",
  update: "更新",
  delete: "削除",
  upsert: "登録または更新",
  call: "呼び出し",
  other: "その他",
};

export const STEP_TEMPLATES: readonly StepTemplate[] = [];
