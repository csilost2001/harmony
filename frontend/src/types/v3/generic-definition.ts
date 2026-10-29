/**
 * Generic Definition Catalog 型定義 (v3 schema 準拠)
 *
 * schema: schemas/v3/generic-definition.v3.schema.json
 * 17 kind (#1254 件 3.7 / #1263 Phase X2 / #1303 / #1310 / #1436 で ui-fragment 廃止):
 *   既存 7: data-contract / domain-type / exception-type / application-rule /
 *            ui-behavior / runtime-policy / component-definition
 *   新規 6: validation-rule / constants / message / domain-event / log-event / log-config
 *   新規 3: dialog / message-area / options (#1303 で導入、#1318 で messageArea → message-area kebab-case 統一)
 *   新規 1: global (#1310 で導入)
 *
 * 命名規約: 複合語 kind は kebab-case で統一。prefix は log-event/logEvent、log-config/logConfig、
 * message-area/messageArea のように camelCase 短縮形を取りうる (kind と prefix は別概念)。
 */

export type GenericDefinitionKind =
  | "data-contract"
  | "domain-type"
  | "exception-type"
  | "application-rule"
  | "validation-rule"
  | "ui-behavior"
  | "runtime-policy"
  | "component-definition"
  | "constants"
  | "message"
  | "domain-event"
  | "log-event"
  | "log-config"
  | "dialog"
  | "message-area"
  | "options"
  | "global"
  | "state-machine"
  | "seed-data"
  | "requirement"
  | "job-definition";

export type GenericDefinitionTarget = "backend" | "frontend" | "shared" | "runtime";

export type GenericRelationKind =
  | "extends"
  | "implements"
  | "uses"
  | "transformsFrom"
  | "transformsTo"
  | "appliesTo";

export interface GenericField {
  name: string;
  type: string;
  constraints?: string[];
  description?: string;
}

export interface GenericOperation {
  name: string;
  inputs?: GenericField[];
  outputs?: GenericField[];
  description?: string;
}

export interface GenericRelation {
  kind: GenericRelationKind;
  ref: string;
  description?: string;
}

/** 状態 (state-machine) */
export interface GenericState {
  name: string;
  label?: string;
  initial?: boolean;
  final?: boolean;
  description?: string;
}

/** 状態の遷移 (state-machine) */
export interface GenericTransition {
  from: string;
  to: string;
  trigger: string;
  guard?: string;
  processFlowId?: string;
  actionId?: string;
  description?: string;
}

/** 要件の目標値 (requirement) */
export interface GenericMeasure {
  metric: string;
  operator: "<=" | "<" | ">=" | ">" | "==";
  value: number;
  unit?: string;
  percentile?: string;
}

/** ジョブの実行の時刻 (job-definition) */
export interface GenericSchedule {
  kind: "cron" | "interval" | "event" | "manual";
  expression?: string;
  timezone?: string;
}

/** ジョブの再実行の方針 (job-definition) */
export interface GenericRetry {
  maxAttempts: number;
  backoff?: "none" | "fixed" | "exponential";
  intervalSeconds?: number;
}

export interface GenericDefinition {
  $schema?: string;
  kind: GenericDefinitionKind;
  name: string;
  purpose: string;
  responsibilities: string[];
  targets: GenericDefinitionTarget[];
  fields?: GenericField[];
  operations?: GenericOperation[];
  relations?: GenericRelation[];
  constraints?: string[];
  mappingHints?: Record<string, unknown>;
  /** state-machine */
  states?: GenericState[];
  transitions?: GenericTransition[];
  stateColumn?: { tableId: string; columnId: string };
  /** seed-data */
  tableId?: string;
  rows?: Array<Record<string, unknown>>;
  /** job-definition / requirement */
  processFlowId?: string;
  /** requirement */
  measure?: GenericMeasure;
  /** job-definition */
  schedule?: GenericSchedule;
  retry?: GenericRetry;
}

export interface DataContractDefinition extends GenericDefinition {
  kind: "data-contract";
}

export interface ExceptionTypeDefinition extends GenericDefinition {
  kind: "exception-type";
}

export const GENERIC_DEFINITION_KINDS: GenericDefinitionKind[] = [
  "data-contract",
  "domain-type",
  "exception-type",
  "application-rule",
  "validation-rule",
  "ui-behavior",
  "runtime-policy",
  "component-definition",
  "constants",
  "message",
  "domain-event",
  "log-event",
  "log-config",
  "dialog",
  "message-area",
  "options",
  "global",
  "state-machine",
  "seed-data",
  "requirement",
  "job-definition",
];

export const GENERIC_DEFINITION_KIND_LABELS: Record<GenericDefinitionKind, string> = {
  "data-contract": "データ契約",
  "domain-type": "ドメイン型",
  "exception-type": "例外型",
  "application-rule": "アプリケーションルール",
  "validation-rule": "業務検証ルール",
  "ui-behavior": "UI ビヘイビア",
  "runtime-policy": "ランタイムポリシー",
  "component-definition": "コンポーネント定義",
  constants: "定数集",
  message: "メッセージ",
  "domain-event": "ドメインイベント",
  "log-event": "ログイベント",
  "log-config": "ログ設定",
  dialog: "ダイアログ",
  "message-area": "メッセージエリア",
  options: "選択肢",
  global: "グローバル設定",
  "state-machine": "状態遷移",
  "seed-data": "初期データ",
  requirement: "非機能要件",
  "job-definition": "ジョブ",
};

export const GENERIC_DEFINITION_TARGETS: GenericDefinitionTarget[] = [
  "backend",
  "frontend",
  "shared",
  "runtime",
];

export const GENERIC_DEFINITION_TARGET_LABELS: Record<GenericDefinitionTarget, string> = {
  backend: "バックエンド",
  frontend: "フロントエンド",
  shared: "共有",
  runtime: "ランタイム",
};

export const GENERIC_DEFINITION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface GenericDefinitionSummary {
  kind: GenericDefinitionKind;
  name: string;
  purpose: string;
  targets: GenericDefinitionTarget[];
  fieldCount: number;
}
