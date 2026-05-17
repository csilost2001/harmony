/**
 * ViewDefinitionEditor 共通定数 (Phase-4 抽出)
 *
 * - FIELD_TYPE_OPTIONS: type select の選択肢 (FieldTypePrimitive)
 * - FILTER_OPERATORS: filter 演算子の選択肢
 * - KIND_LABELS: builtin viewer 種別の表示ラベル
 * - JOIN_KIND_OPTIONS: Level 2 structured query の JOIN 種別
 * - LEVEL_LABELS: Level 1/2/3 の表示ラベル
 */
import type {
  FilterOperator,
  BuiltinViewDefinitionKind,
  ViewQueryJoin,
} from "../../../types/v3/view-definition";
import type { FieldTypePrimitive } from "../../../types/v3";
import type { ViewLevel } from "../viewDefinitionLevels";

export const FIELD_TYPE_OPTIONS: FieldTypePrimitive[] = [
  "string", "integer", "number", "boolean", "date", "datetime", "json",
];

export const FILTER_OPERATORS: FilterOperator[] = [
  "eq", "neq", "gt", "gte", "lt", "lte",
  "contains", "startsWith", "in", "between",
];

export const KIND_LABELS: Record<BuiltinViewDefinitionKind, string> = {
  list: "list — 一覧",
  detail: "detail — 詳細",
  kanban: "kanban — カンバン",
  calendar: "calendar — カレンダー",
};

export const JOIN_KIND_OPTIONS: ViewQueryJoin["kind"][] = ["INNER", "LEFT", "RIGHT", "FULL"];

export const LEVEL_LABELS: Record<ViewLevel, string> = {
  1: "Level 1 — Simple (1 テーブル)",
  2: "Level 2 — Structured (joins + where)",
  3: "Level 3 — Raw SQL (CTE / window 等)",
};

export function isBuiltinKind(k: string): k is BuiltinViewDefinitionKind {
  return ["list", "detail", "kanban", "calendar"].includes(k);
}
