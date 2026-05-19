/**
 * v3 schema 整合 TS 型 — re-export entry point.
 *
 * 各ファイルは `schemas/v3/<name>.v3.schema.json` と 1:1 対応:
 *
 * - `common`: 共通 $defs (Uuid / Identifier / FieldType / StructuredField / Authoring / 等)
 * - `harmony`: Harmony workspace marker (`harmony.json`) root + entries
 * - `screen` / `screen-item` / `screen-flow-positions`: 画面定義 + UI 座標 (分離)
 * - `page-layout`: PageLayout entity (RFC #1021)
 * - `table` / `sequence` / `view` / `er-layout`: DB / ER 関連
 * - `process-flow`: ProcessFlow + 22 step variants + ModelEndpointEntry
 * - `external-catalogs`: project-level 共有 catalogs
 * - `extensions` / `conventions` / `custom-block`: 拡張機構 / 横断規約 / GrapesJS ブロック
 * - `generic-definition`: Generic Definition Catalog (#1069)
 *
 * **新規型ファイル追加時の手動更新が必要** (index.ts は手動メンテ、auto-generated ではない)。
 * 新しい `<name>.v3.schema.json` を追加した場合は、本ファイルへの `export *` 行も追加する。
 *
 * 使用例:
 * ```ts
 * import type { ProcessFlow, Step, WorkflowStep, Harmony } from "@/types/v3";
 * ```
 *
 * 参考: schemas/v3/README.md
 */

// 共通 (他全 export がこれを import)
export * from "./common";

// Harmony workspace marker root (旧 project.ts、#1142 で rename)
export * from "./harmony";

// 画面系
export * from "./screen";
export * from "./screen-item";
export * from "./screen-flow-positions";

// Page Layout (RFC #1021)
export * from "./page-layout";

// DB / ER 系
export * from "./table";
export * from "./sequence";
export * from "./view";
export * from "./view-definition";
export * from "./er-layout";

// 処理フロー
export * from "./process-flow";

// External Catalogs (project-level 共有 catalogs、#940 / #1142)
export * from "./external-catalogs";

// 拡張機構 / 横断規約 / GrapesJS ブロック
export * from "./extensions";
export * from "./conventions";
export * from "./custom-block";

// Generic Definition Catalog (#1069)
export * from "./generic-definition";

// ── #1186 Phase 2-D: Legacy alias group (action.ts 廃止移行用) ─────────────
// action.ts の旧 type 名 (v1/v2 互換) を v3 strict 型への alias として提供。
// 新規 consumer は v3 直接命名を使うこと。本 alias 群は移行完了後に削除予定。

import type { ProcessFlowKind, StepKind as _StepKind } from "./process-flow";
import type { Mode } from "./common";

/** @deprecated 旧 v1/v2 名。v3 は `ProcessFlowKind` を使う。 */
export type ProcessFlowType = ProcessFlowKind;

/** @deprecated 旧 v1/v2 名。v3 は `StepKind` を使う。 */
export type StepType = _StepKind;

/** @deprecated 旧 v1/v2 名。v3 は `Mode` (common.v3) を使う。 */
export type ProcessFlowMode = Mode;

// ── HTTP 関連 (frontend 表示専用、v3 schema には ExternalHttpCall.method として enum 定義) ──
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type HttpAuthRequirement = "required" | "optional" | "none";

// ── External Auth Kind (process-flow.v3 ExternalAuth.kind enum、frontend type alias) ──
export type ExternalAuthKind = "bearer" | "basic" | "apiKey" | "oauth2" | "iamRole" | "azureAd" | "none";

// ── SLA / Transaction の frontend 拡張 enum (v3 schema には string で許容) ──
export type OnTimeout = "throw" | "continue" | "compensate" | "log";
export type TransactionIsolationLevel = "READ_COMMITTED" | "REPEATABLE_READ" | "SERIALIZABLE" | string;
export type TransactionPropagation = "REQUIRED" | "REQUIRES_NEW" | "NESTED" | string;
export type ExternalChainPhase = "authorize" | "capture" | "cancel" | "other";

// ── TxBoundary.role (v3 schema TxBoundary.role と一致) ─────────────────────
export type TxBoundaryRole = "begin" | "member" | "end";
