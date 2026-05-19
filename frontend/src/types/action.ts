/**
 * action.ts — **@deprecated v1/v2 ProcessFlow 互換 type 集約** (#1186)
 *
 * 本ファイルは旧 v1/v2 ProcessFlow 時代の type alias 群で、v3 schema (#955) 移行後は
 * 段階的に廃止予定。**新規 consumer は本ファイルからの import を避け、以下を使うこと**:
 *
 * - schema 整合 strict 型 → `import type { ... } from "@/types/v3"`
 * - UI 表示メタデータ (LABELS / ICONS / COLORS) → `import { ... } from "@/utils/processFlowMetadata"`
 *
 * 本ファイルは backward compat re-export 層として機能する。
 * Phase 2-A (#1186): UI 定数を processFlowMetadata.ts に分離、本 file は re-export のみ
 * Phase 2-B (TBD): consumer を types/v3 / processFlowMetadata 直接 import に移行
 * Phase 3 (TBD): 本 file を削除 (consumer 移行完了後)
 *
 * AnyRecord 型 (Step / ProcessFlow / Branch 等) は backward compat 用に温存。
 * v3 schema 整合 strict 型は `types/v3/process-flow.ts` 参照。
 */

import type * as V3ProcessFlow from "./v3/process-flow";
import type * as V3Common from "./v3/common";

export type V3ProcessFlowTypes = typeof V3ProcessFlow;
export type V3CommonTypes = typeof V3Common;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy process-flow compatibility relies on permissive dictionary values.
type AnyRecord = Record<string, any>;

// ── Schema 整合 type (v3 から re-export) ────────────────────────────────────
export type Maturity = V3Common.Maturity;
export type ProcessFlowMode = V3Common.Mode;
export type ProcessFlowType = V3ProcessFlow.ProcessFlowKind;
export type ProcessFlowKind = V3ProcessFlow.ProcessFlowKind;

// ── Field / Marker 系 (緩い表現で温存) ──────────────────────────────────────
export type FieldType = string | AnyRecord;
export type StructuredField = AnyRecord & { name: string; type: FieldType; description?: string };
export type ActionFields = StructuredField[] | string | undefined;

export type MarkerKind = string;
export type Marker = AnyRecord;

// ── StepNote (#1186 Phase 1 で 5 値正規化済) ────────────────────────────────
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

// ── StepKind (v3 schema 25 種、componentCall / aiCall / aiAgent / cdc / closing / log / audit 含む) ──
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
/** @deprecated v1/v2 では `type` だったが v3 では `kind`。互換のため alias 残置。 */
export type StepType = StepKind;

// ── Loose AnyRecord 型 (consumer 多数のため backward compat 温存) ───────────
// 将来的に `types/v3/process-flow.ts` の strict 型へ段階移行予定 (#1186 Phase 2-B 以降)。
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
export type ValidationRule = AnyRecord & { field?: string; type?: ValidationRuleType; severity?: string };

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type HttpAuthRequirement = "required" | "optional" | "none";
export type HttpRoute = AnyRecord;
export type HttpResponseSpec = AnyRecord;
export type BodySchema = string | AnyRecord;

// ── ExternalCallOutcome は frontend 表示用 enum (processFlowMetadata.ts と同期) ──
export type { ExternalCallOutcome } from "../utils/processFlowMetadata";
export type ExternalCallOutcomeSpec = AnyRecord;
export type ExternalCallOutcomes = AnyRecord;
// #1186 Phase 1: process-flow.v3 ExternalAuth.kind に iamRole / azureAd を追加 (AWS Bedrock / Azure OpenAI、#867 / #939)
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
// #1186 Phase 1: process-flow.v3 LoopStep と完全一致
export type LoopKind = "count" | "condition" | "collection";
export type LoopConditionMode = "continue" | "exit";
export type WorkflowPattern = V3ProcessFlow.WorkflowPattern | string;
export type WorkflowApprover = AnyRecord;
export type WorkflowQuorum = AnyRecord;

// ── Step variant aliases (backward compat) ──────────────────────────────────
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

// ── Catalog entry 型 (緩い) ─────────────────────────────────────────────────
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

// ── StepNote 関連定数 (Phase 1 で 5 値正規化済) ─────────────────────────────
export const STEP_NOTE_TYPE_VALUES: readonly StepNoteType[] = [
  "assumption",
  "prerequisite",
  "todo",
  "deferred",
  "question",
] as const;

// ── UI 表示メタデータ定数 (processFlowMetadata.ts から re-export、#1186 Phase 2-A) ──
// 旧 consumer の `import { STEP_TYPE_LABELS } from "@/types/action"` 互換維持。
// 新規 consumer は `@/utils/processFlowMetadata` から直接 import すること。
export {
  ACTION_TRIGGER_LABELS,
  PROCESS_FLOW_TYPE_LABELS,
  PROCESS_FLOW_TYPE_ICONS,
  STEP_TYPE_LABELS,
  STEP_TYPE_ICONS,
  STEP_TYPE_COLORS,
  EXTERNAL_CALL_OUTCOME_VALUES,
  WORKFLOW_PATTERN_VALUES,
  WORKFLOW_PATTERN_LABELS,
  DB_OPERATION_LABELS,
  STEP_TEMPLATES,
  type StepTemplate,
} from "../utils/processFlowMetadata";
