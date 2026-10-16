/**
 * 画面項目と、紐づけたテーブルのカラムの食い違い (UI 改善提案 続編 第 8 弾 #156)。
 * binding が tableColumn の項目について、型・桁数 (最大長)・必須を、カラムと比べて、食い違いを集める (画面に依存しない純関数)。
 * 直し方は「項目をカラムに合わせる」だけ (カラムは別の設計なので、ここでは書き換えない)。
 */
import type { Column, ScreenItem, Table } from "../types/v3";
import { fieldTypeForDataType } from "./itemSuggestion";

export type MismatchKind = "type" | "maxLength" | "required" | "missing";

export interface ItemMismatch {
  kind: MismatchKind;
  message: string;
  /** 項目をカラムに合わせるときの変更。直せない (参照先が無い) ものは無し */
  fix?: Partial<ScreenItem>;
}

export interface ItemMismatchRow {
  itemId: string;
  label: string;
  tableName: string;
  columnName: string;
  mismatches: ItemMismatch[];
}

const upper = (s: unknown) => String(s ?? "").toUpperCase();

function compare(item: ScreenItem, col: Column): ItemMismatch[] {
  const out: ItemMismatch[] = [];
  const expected = fieldTypeForDataType(String(col.dataType ?? ""));
  const itemType = typeof item.type === "string" ? item.type : undefined;
  if (expected && itemType && itemType !== expected) out.push({ kind: "type", message: `型が違います (項目: ${itemType} / カラム: ${col.dataType} → ${expected})`, fix: { type: expected } });
  const isChar = upper(col.dataType) === "VARCHAR" || upper(col.dataType) === "CHAR";
  if (isChar && typeof col.length === "number") {
    if (typeof item.maxLength === "number" && item.maxLength > col.length) out.push({ kind: "maxLength", message: `最大長 ${item.maxLength} が、カラムの長さ ${col.length} を超えています (入力できても、保存で失敗します)`, fix: { maxLength: col.length } });
    else if (item.maxLength === undefined && item.maxLengthRef === undefined) out.push({ kind: "maxLength", message: `最大長が決まっていません (カラムの長さは ${col.length})`, fix: { maxLength: col.length } });
  }
  if (col.notNull && !col.autoIncrement && col.defaultValue === undefined && !item.required && item.direction !== "out") out.push({ kind: "required", message: "カラムは NOT NULL ですが、項目は必須になっていません", fix: { required: true } });
  return out;
}

export function itemColumnMismatches(items: readonly ScreenItem[], tables: readonly Table[]): ItemMismatchRow[] {
  const byTable = new Map(tables.map((t) => [t.id as string, t]));
  const rows: ItemMismatchRow[] = [];
  for (const item of items) {
    const b = item.binding;
    if (!b || b.kind !== "tableColumn" || !b.ref) continue;
    const ref = b.ref as { tableId?: string; columnId?: string };
    if (!ref.tableId || !ref.columnId) continue;
    const table = byTable.get(ref.tableId);
    const col = table?.columns.find((c) => c.id === ref.columnId);
    const label = String(item.label ?? item.id);
    if (!table || !col) {
      rows.push({ itemId: String(item.id), label, tableName: table ? String(table.name) : ref.tableId, columnName: ref.columnId, mismatches: [{ kind: "missing", message: table ? "紐づけたカラムが、テーブルに見つかりません" : "紐づけたテーブルが見つかりません" }] });
      continue;
    }
    const mismatches = compare(item, col);
    if (mismatches.length) rows.push({ itemId: String(item.id), label, tableName: String(table.name), columnName: String(col.name ?? col.physicalName), mismatches });
  }
  return rows;
}

/** 行にある、直せる食い違いの変更を、1 つの変更にまとめる */
export function fixPatch(row: ItemMismatchRow): Partial<ScreenItem> {
  return Object.assign({}, ...row.mismatches.map((m) => m.fix ?? {}));
}
