/**
 * v3 schema 整合 TS 型 — re-export entry point.
 *
 * 各ファイルは `schemas/v3/<name>.v3.schema.json` と 1:1 対応:
 *
 * - `common`: 共通 $defs (Uuid / Identifier / FieldType / StructuredField / Authoring / 等)
 * - `project`: Project root
 * - `screen` / `screen-item` / `screen-layout`: 画面定義 + UI 座標 (分離)
 * - `table` / `sequence` / `view` / `er-layout`: DB / ER 関連
 * - `process-flow`: ProcessFlow + 22 step variants
 * - `extensions` / `conventions` / `custom-block`: 拡張機構 / 横断規約 / GrapesJS ブロック
 *
 * 使用例:
 * ```ts
 * import type { ProcessFlow, Step, WorkflowStep } from "@/types/v3";
 * ```
 *
 * 参考: schemas/v3/README.md
 */

// 共通 (他全 export がこれを import)
export * from "./common";

// Project root
export * from "./project";

// 画面系
export * from "./screen";
export * from "./screen-item";
export * from "./screen-layout";

// DB / ER 系
export * from "./table";
export * from "./sequence";
export * from "./view";
export * from "./view-definition";
export * from "./er-layout";

// 処理フロー
export * from "./process-flow";

// 拡張機構 / 横断規約 / GrapesJS ブロック
export * from "./extensions";
export * from "./conventions";
export * from "./custom-block";
