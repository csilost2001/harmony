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
