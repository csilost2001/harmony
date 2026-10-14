/** 画面項目の一括変更で、まとめて変えられる項目 */
import type { BulkField } from "../../utils/bulkEdit";
import type { ScreenItem } from "../../types/v3/screen-item";
import { PRIMITIVE_TYPES } from "./internal/screenItemsConstants";

const primitive = (i: ScreenItem): string | null => (typeof i.type === "string" ? i.type : null);
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? null : "0 以上の整数を入れてください");
const onlyFor = (kinds: readonly string[], what: string) => (i: ScreenItem): string | null => {
  const t = primitive(i);
  return t && kinds.includes(t) ? null : `${what}は、型が ${kinds.join(" / ")} の項目だけです`;
};

export const ITEM_BULK_FIELDS: ReadonlyArray<BulkField<ScreenItem>> = [
  { key: "type", label: "型", kind: "select", options: PRIMITIVE_TYPES.map((t) => ({ value: t, label: t })),
    applicable: (i) => (primitive(i) === null ? "配列・オブジェクトの型は、一括では変えません" : null) },
  { key: "direction", label: "入出力", kind: "select", options: [{ value: "in", label: "in (画面→外部)" }, { value: "out", label: "out (外部→画面)" }, { value: "both", label: "both (双方向)" }] },
  { key: "required", label: "必須", kind: "tri" },
  { key: "readonly", label: "読み取り専用", kind: "tri" },
  { key: "disabled", label: "無効", kind: "tri" },
  { key: "minLength", label: "最小長", kind: "number", validate: posInt, applicable: onlyFor(["string"], "最小長") },
  { key: "maxLength", label: "最大長", kind: "number", validate: posInt, applicable: onlyFor(["string"], "最大長") },
  { key: "min", label: "最小値", kind: "number", applicable: onlyFor(["number", "integer"], "最小値") },
  { key: "max", label: "最大値", kind: "number", applicable: onlyFor(["number", "integer"], "最大値") },
  { key: "pattern", label: "パターン", kind: "text", applicable: onlyFor(["string"], "パターン") },
  { key: "placeholder", label: "入力例", kind: "text" },
  { key: "description", label: "説明", kind: "text" },
];
