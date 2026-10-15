/**
 * 画面項目の入力補助:
 *   - テーブルのカラムから、画面項目の行を作る (itemsFromTable)
 *   - ラベルから、項目 ID・型・最大長を提案する (planItemAutofill)
 *   - 必須・桁・形式・範囲から、エラーメッセージの下書きを作る (draftErrorMessages)
 */
import type { Column, FieldType, Identifier, ScreenItem, Table, DisplayName } from "../types/v3";
import { applyNamingConvention, splitWords, suggestColumnType, suggestPhysicalName, type TermIndex } from "./columnSuggestion";

/** DB のデータ型 → 画面項目の型 (対応が無い BLOB などは null)。 */
export function fieldTypeForDataType(dataType: string): FieldType | null {
  switch (dataType.toUpperCase()) {
    case "VARCHAR": case "CHAR": case "TEXT": case "TIME": return "string";
    case "INTEGER": case "BIGINT": case "SMALLINT": return "integer";
    case "DECIMAL": case "FLOAT": return "number";
    case "BOOLEAN": return "boolean";
    case "DATE": return "date";
    case "TIMESTAMP": return "datetime";
    case "JSON": return "json";
    default: return null;
  }
}

/** snake_case / kebab-case の物理名を camelCase の識別子にする (先頭が数字なら c を付ける)。 */
export function toCamelIdentifier(physicalName: string): string {
  const words = splitWords(physicalName);
  const id = applyNamingConvention(words, "camelCase");
  return /^[a-z]/.test(id) ? id : `c${id}`;
}

/** 既存の ID と重ならない ID にする (重なれば 2, 3, ... を付ける)。 */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export interface TableItemsPlan {
  items: ScreenItem[];
  /** 画面項目にできなかったカラム (BLOB など) */
  skipped: string[];
}

/** テーブルのカラムから、画面項目の行を作る。既存の項目 ID と重ならないようにする。 */
export function itemsFromTable(table: Table, columns: readonly Column[], existingIds: Iterable<string>): TableItemsPlan {
  const taken = new Set(existingIds);
  const items: ScreenItem[] = [];
  const skipped: string[] = [];
  for (const c of columns) {
    const type = fieldTypeForDataType(c.dataType);
    if (!type) { skipped.push(c.physicalName); continue; }
    const id = uniqueId(toCamelIdentifier(c.physicalName), taken);
    taken.add(id);
    const item: ScreenItem = {
      id: id as Identifier,
      label: c.name as DisplayName,
      type,
      direction: "both",
      binding: { kind: "tableColumn", ref: { tableId: table.id, columnId: c.id } },
    };
    if (c.notNull && !c.autoIncrement) item.required = true;
    if (c.autoIncrement) item.readonly = true;
    if (type === "string" && c.length && (c.dataType.toUpperCase() === "VARCHAR" || c.dataType.toUpperCase() === "CHAR")) item.maxLength = c.length;
    if (c.comment) item.description = c.comment as ScreenItem["description"];
    items.push(item);
  }
  return { items, skipped };
}

export interface ItemAutofill {
  patch: Partial<ScreenItem>;
  message: string;
}

/**
 * ラベルを入れたとき、まだ決めていない ID・型・最大長を埋める案。決めた値は変えない。
 *   - ID が空: ラベルから camelCase の ID (全部を英語にできたときだけ)
 *   - 型が string のままで、最大長・最小/最大値・pattern・選択肢が無い: 型と最大長
 */
export function planItemAutofill(
  item: Pick<ScreenItem, "type" | "maxLength" | "min" | "max" | "pattern" | "options" | "minLength"> & { id: string; label: string },
  existingIds: Iterable<string>,
  index?: TermIndex,
): ItemAutofill | null {
  const label = String(item.label ?? "").trim();
  if (!label) return null;
  const patch: Partial<ScreenItem> = {};
  const notes: string[] = [];

  if (!item.id) {
    const s = suggestPhysicalName(label, index, "camelCase");
    // 既存の列の物理名 (customer_name など) が使われたときも、項目 ID は camelCase にする
    const base = s?.name ? (/^[a-z][A-Za-z0-9]*$/.test(s.name) ? s.name : /^[A-Za-z0-9_-]+$/.test(s.name) ? toCamelIdentifier(s.name) : "") : "";
    if (/^[a-z][A-Za-z0-9]*$/.test(base)) {
      const id = uniqueId(base, new Set(existingIds));
      patch.id = id as Identifier;
      notes.push(`ID ${id}`);
    }
  }

  const untouchedType = item.type === "string" && item.maxLength === undefined && item.minLength === undefined
    && item.min === undefined && item.max === undefined && !item.pattern && !(item.options && item.options.length > 0);
  if (untouchedType) {
    const t = suggestColumnType(label);
    const ft = t ? fieldTypeForDataType(t.dataType) : null;
    if (t && ft && (ft !== "string" || t.length !== undefined)) {
      patch.type = ft;
      if (ft === "string" && t.length !== undefined) patch.maxLength = t.length;
      notes.push(`型 ${ft}${patch.maxLength !== undefined ? `・最大長 ${patch.maxLength}` : ""}`);
    }
  }
  if (notes.length === 0) return null;
  return { patch, message: `「${label}」から ${notes.join("、")} を入れました (Ctrl+Z で元に戻せます)` };
}

/** エラーメッセージのキー (画面項目の errorMessages)。 */
export const ERROR_MESSAGE_KEYS = ["required", "minLength", "maxLength", "invalidFormat", "outOfRange"] as const;
export type ErrorMessageKey = (typeof ERROR_MESSAGE_KEYS)[number];

/**
 * 必須・長さ・形式・範囲の設定から、まだ書いていないエラーメッセージの下書きを作る。
 * 規約に同じキーのメッセージ (`msg.<key>`) があれば、その参照 (`@conv.msg.<key>`) を入れる。
 */
export function draftErrorMessages(
  item: Pick<ScreenItem, "required" | "minLength" | "maxLength" | "min" | "max" | "pattern" | "errorMessages"> & { label: string },
  conventionMsgKeys: ReadonlySet<string> = new Set(),
): Partial<Record<ErrorMessageKey, string>> {
  const label = String(item.label ?? "").trim() || "この項目";
  const have = item.errorMessages ?? {};
  const out: Partial<Record<ErrorMessageKey, string>> = {};
  const put = (key: ErrorMessageKey, text: string) => {
    if (have[key]) return;
    out[key] = conventionMsgKeys.has(key) ? `@conv.msg.${key}` : text;
  };
  if (item.required) put("required", `${label}は必須です`);
  if (item.minLength !== undefined) put("minLength", `${label}は${item.minLength}文字以上で入力してください`);
  if (item.maxLength !== undefined) put("maxLength", `${label}は${item.maxLength}文字以内で入力してください`);
  if (item.pattern) put("invalidFormat", `${label}の形式が正しくありません`);
  if (item.min !== undefined || item.max !== undefined) {
    const range = item.min !== undefined && item.max !== undefined ? `${item.min}〜${item.max}の範囲で`
      : item.min !== undefined ? `${item.min}以上で` : `${item.max}以下で`;
    put("outOfRange", `${label}は${range}入力してください`);
  }
  return out;
}
