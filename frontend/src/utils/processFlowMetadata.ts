/**
 * processFlowMetadata.ts (#1186 Phase 2-A)
 *
 * ProcessFlow 系 UI 表示メタデータ (label / icon / color) の集約モジュール。
 *
 * これらは **schema 概念ではない frontend UI 表示専用の定数群** で、旧来 `types/action.ts` 内に
 * 同居していたが、責務 (schema 型) と異なるため本ファイルに分離 (#1186 Phase 2-A)。
 *
 * 命名規約:
 * - LABELS: kind/trigger → 日本語表示名 (画面・ボタン・menu 等)
 * - ICONS: kind/trigger → アイコン名 (bootstrap-icons / lucide / カスタム)
 * - COLORS: kind/trigger → 表示色 (hex, badge / カード枠等)
 * - *_VALUES: enum を array として走査する用の readonly tuple
 *
 * 旧 types/action.ts 経由の import は backward compat で同 file から re-export されているが、
 * 新規 consumer は本ファイルから直接 import すること。
 */

import type { Note } from "../types/v3/common";
import type { WorkflowPattern } from "../types/v3/process-flow";

// ── StepNote (common.v3 Note 派生 + v1/v2 legacy 互換 field) ────────────────
// #1186 Phase 2-B: action.ts から移管 (UI 表示 + migration 互換が frontend 固有概念のため)
export type StepNoteType = Note["kind"]; // common.v3 Note.kind と完全一致 (5 値)

export interface StepNote {
  id: string;
  /** common.v3 Note 規範。v3 schema 上 field 名は `kind` 必須 (旧 `type` は read 互換のみ)。 */
  kind?: StepNoteType;
  /** @deprecated v1/v2 legacy field。新規書込は `kind` を使用。 */
  type?: StepNoteType;
  body: string;
  createdAt: string;
}

// common.v3 Note.kind と完全一致 (5 値、順序は schema 列挙順)
export const STEP_NOTE_TYPE_VALUES: readonly StepNoteType[] = [
  "assumption",
  "prerequisite",
  "todo",
  "deferred",
  "question",
] as const;

// ── ActionTrigger (Action.trigger) ─────────────────────────────────────────
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

// ── ProcessFlow.meta.kind ───────────────────────────────────────────────────
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

// ── Step.kind ──────────────────────────────────────────────────────────────
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

// ── ExternalCallOutcomes ───────────────────────────────────────────────────
export type ExternalCallOutcome = "success" | "failure" | "timeout";

export const EXTERNAL_CALL_OUTCOME_VALUES: readonly ExternalCallOutcome[] = [
  "success",
  "failure",
  "timeout",
] as const;

// ── WorkflowPattern (v3 + frontend 拡張) ───────────────────────────────────
export const WORKFLOW_PATTERN_VALUES: readonly (WorkflowPattern | string)[] = [
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

// ── DB Operation (frontend 表示専用、schema には DbAccessStep.operation 直接) ──
export const DB_OPERATION_LABELS: Record<string, string> = {
  select: "検索",
  insert: "登録",
  update: "更新",
  delete: "削除",
  upsert: "登録または更新",
  call: "呼び出し",
  other: "その他",
};

// ── StepTemplate (Palette 表示用、空配列、将来 fill 予定) ──────────────────
export interface StepTemplate {
  id?: string;
  /** @deprecated 旧 v1/v2 互換、v3 では `kind` を使用 */
  type?: string;
  kind?: string;
  label: string;
  description?: string;
  step?: Record<string, unknown>;
  steps?: Record<string, unknown>[];
}

export const STEP_TEMPLATES: readonly StepTemplate[] = [];
