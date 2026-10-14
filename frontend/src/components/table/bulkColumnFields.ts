/** テーブルのカラムの一括変更で、まとめて変えられる項目 */
import type { BulkField } from "../../utils/bulkEdit";
import type { Column } from "../../types/v3";
import { DATA_TYPE_LABELS, DATA_TYPES_WITH_LENGTH, DATA_TYPES_WITH_SCALE } from "./tableConstants";
import type { BuiltinDataType } from "../../types/v3";

const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? null : "0 以上の整数を入れてください");

export const COLUMN_BULK_FIELDS: ReadonlyArray<BulkField<Column>> = [
  { key: "dataType", label: "データ型", kind: "select", options: (Object.keys(DATA_TYPE_LABELS) as BuiltinDataType[]).map((k) => ({ value: k, label: DATA_TYPE_LABELS[k] })) },
  { key: "length", label: "長さ", kind: "number", validate: posInt,
    applicable: (c) => (DATA_TYPES_WITH_LENGTH.includes(c.dataType as BuiltinDataType) ? null : "この型には長さがありません") },
  { key: "scale", label: "スケール", kind: "number", validate: posInt,
    applicable: (c) => (DATA_TYPES_WITH_SCALE.includes(c.dataType as BuiltinDataType) ? null : "この型にはスケールがありません") },
  { key: "notNull", label: "NOT NULL", kind: "tri" },
  { key: "unique", label: "ユニーク", kind: "tri" },
  { key: "defaultValue", label: "デフォルト値", kind: "text" },
  { key: "comment", label: "備考", kind: "text" },
];
