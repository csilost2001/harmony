/**
 * ScreenItemsView 共通定数 (#1145 Phase-6)
 *
 * Phase-6 前は ScreenItemsView.tsx 内に inline 定義。
 * `OutputFields` section や将来追加される他 section と共有するため
 * `internal/` 配下に抽出。
 */
import type { FieldTypePrimitive } from "../../../types/v3";

/** 画面項目で許容する primitive 型一覧 */
export const PRIMITIVE_TYPES: FieldTypePrimitive[] = [
  "string", "number", "integer", "boolean", "date", "datetime", "json",
];

/** displayFormat プリセット候補 (datalist で補完表示) */
export const DISPLAY_FORMAT_PRESETS = [
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "YYYY年MM月DD日",
  "YYYY/MM/DD HH:mm:ss",
  "#,##0",
  "0.00",
  "#,##0.00",
  "¥#,##0",
  "$#,##0.00",
  "0%",
  "0.00%",
];

/** valueFrom kind 選択肢 (出力バインド種別) */
export const VALUE_SOURCE_KINDS = [
  { value: "flowVariable", label: "処理フロー変数" },
  { value: "tableColumn", label: "テーブル列" },
  { value: "viewColumn", label: "ビュー列" },
  { value: "expression", label: "計算式" },
] as const;

/** ID フィールドの validation 用 RE (JS identifier) */
export const JS_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
