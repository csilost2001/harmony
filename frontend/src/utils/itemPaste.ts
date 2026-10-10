/**
 * Excel・スプレッドシートの項目定義の表 (タブ / カンマ区切り) から、画面項目 (ScreenItem) を読み取る。
 * 規則は columnPaste.ts (テーブルのカラム) と同じ: 先頭行が見出しなら見出しの名前で列を対応づけ、
 * なければ 項目 ID / ラベル / 型 / 入出力 / 必須 / 最大長 / 最小長 / パターン / 説明 の順とみなす。
 */
import type { ScreenItem } from "../types/v3/screen-item";
import { detectDelimiter, norm, parseBoolean, splitRow } from "./columnPaste";

export type ParsedItem = Pick<ScreenItem, "id" | "label" | "type"> &
  Partial<Pick<ScreenItem, "direction" | "required" | "minLength" | "maxLength" | "min" | "max" | "pattern" | "description">>;

export interface ItemPasteResult { items: ParsedItem[]; warnings: string[]; headerDetected: boolean }

type Field = "id" | "label" | "type" | "direction" | "required" | "maxLength" | "minLength" | "min" | "max" | "pattern" | "description";
const DEFAULT_ORDER: Field[] = ["id", "label", "type", "direction", "required", "maxLength", "minLength", "pattern", "description"];

const HEADER_ALIASES: Array<[Field, string[]]> = [
  ["id", ["項目id", "id", "項目コード", "フィールド名", "identifier", "項目名(英)", "項目名英", "物理名", "name"]],
  ["label", ["ラベル", "項目名", "表示名", "論理名", "名称", "label", "項目名称", "日本語名", "名前"]],
  ["type", ["型", "データ型", "type", "属性", "データタイプ"]],
  ["direction", ["入出力", "方向", "direction", "io", "i/o", "入力出力", "入出力区分"]],
  ["required", ["必須", "required", "必須入力", "必須区分"]],
  ["maxLength", ["最大長", "桁数", "最大桁", "maxlength", "最大文字数", "長さ", "桁", "文字数"]],
  ["minLength", ["最小長", "最小桁", "minlength", "最小文字数"]],
  ["min", ["最小値", "min", "下限"]],
  ["max", ["最大値", "max", "上限"]],
  ["pattern", ["パターン", "形式", "正規表現", "pattern", "入力書式", "書式"]],
  ["description", ["説明", "備考", "補足", "description", "コメント", "memo", "メモ"]],
];

const TYPE_ALIASES: Record<string, ScreenItem["type"] & string> = {
  string: "string", 文字列: "string", 文字: "string", テキスト: "string", text: "string", varchar: "string", char: "string",
  integer: "integer", int: "integer", 整数: "integer", bigint: "integer", 数字: "integer",
  number: "number", 数値: "number", 小数: "number", decimal: "number", float: "number", double: "number", 金額: "number",
  boolean: "boolean", bool: "boolean", 真偽: "boolean", フラグ: "boolean", チェック: "boolean",
  date: "date", 日付: "date", 年月日: "date",
  datetime: "datetime", 日時: "datetime", timestamp: "datetime",
  json: "json",
};

function headerField(cell: string): Field | null {
  const n = norm(cell);
  if (!n) return null;
  for (const [f, aliases] of HEADER_ALIASES) if (aliases.some((a) => norm(a) === n)) return f;
  return null;
}

/** 項目 ID を camelCase (英字で始まる英数字) に寄せる。寄せられなければ null */
export function toItemId(raw: string): { value: string | null; changed: boolean } {
  const t = raw.trim();
  if (/^[a-z][A-Za-z0-9]*$/.test(t)) return { value: t, changed: false };
  const parts = t.split(/[\s_\-.　]+/).filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => /^[A-Za-z0-9]+$/.test(p))) return { value: null, changed: false };
  const camel = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join("");
  return /^[a-z][A-Za-z0-9]*$/.test(camel) ? { value: camel, changed: camel !== t } : { value: null, changed: false };
}

export function parseDirection(cell: string): ScreenItem["direction"] | undefined {
  const t = norm(cell);
  if (!t) return undefined;
  if (["入出力", "both", "io", "双方向", "入力出力"].includes(t)) return "both";
  if (["入力", "in", "i", "入"].includes(t)) return "in";
  if (["出力", "表示", "out", "o", "出", "表示のみ", "参照"].includes(t)) return "out";
  return undefined;
}

export function parseItemTable(text: string): ItemPasteResult {
  const warnings: string[] = [];
  const numbered = text.replace(/\r\n?/g, "\n").split("\n").map((line, i) => ({ line, no: i + 1 })).filter((l) => l.line.trim() !== "");
  if (numbered.length === 0) return { items: [], warnings, headerDetected: false };
  const delim = detectDelimiter(text);
  const rows = numbered.map((l) => splitRow(l.line, delim).map((c) => c.trim()));
  const first = rows[0].map(headerField);
  const headerDetected = first.filter((f) => f !== null).length >= 2;
  const order: Array<Field | null> = headerDetected ? first : DEFAULT_ORDER;
  const body = headerDetected ? rows.slice(1) : rows;
  const bodyStart = headerDetected ? 1 : 0;
  const lineNo = (i: number) => numbered[i + bodyStart].no;
  if (headerDetected && !order.includes("id")) {
    warnings.push("見出しに「項目 ID」の列が見つかりません。1 列目を項目 ID として読みます");
    order[0] = "id";
  }

  const items: ParsedItem[] = [];
  body.forEach((cells, i) => {
    const get = (f: Field) => { const idx = order.indexOf(f); return idx >= 0 ? (cells[idx] ?? "") : ""; };
    const idRaw = get("id");
    if (!idRaw) { warnings.push(`${lineNo(i)} 行目: 項目 ID が空のため読み飛ばしました`); return; }
    const id = toItemId(idRaw);
    if (id.value === null) {
      warnings.push(`${lineNo(i)} 行目: 項目 ID「${idRaw}」は英字で始まる英数字 (camelCase) にできないため読み飛ばしました。英語の ID を書いてください`);
      return;
    }
    if (id.changed) warnings.push(`${lineNo(i)} 行目: 項目 ID「${idRaw}」を「${id.value}」にしました`);
    const item: ParsedItem = { id: id.value as ParsedItem["id"], label: (get("label") || id.value) as ParsedItem["label"], type: "string" };

    const typeCell = get("type");
    if (typeCell) {
      const t = TYPE_ALIASES[norm(typeCell)];
      if (t) item.type = t;
      else warnings.push(`${lineNo(i)} 行目: 型「${typeCell}」が分からないため string にしました (文字列・整数・数値・真偽・日付・日時 など)`);
    }
    const dirCell = get("direction");
    if (dirCell) {
      const d = parseDirection(dirCell);
      if (d) item.direction = d; else warnings.push(`${lineNo(i)} 行目: 入出力「${dirCell}」が分からないため読み飛ばしました (入力 / 出力 / 入出力)`);
    }
    const req = get("required");
    if (req !== "") {
      const b = parseBoolean(req);
      if (b === undefined) warnings.push(`${lineNo(i)} 行目: 必須の値「${req}」が分からないため読み飛ばしました (○ か空で書いてください)`);
      else if (b) item.required = true;
    }
    for (const f of ["maxLength", "minLength", "min", "max"] as const) {
      const cell = get(f);
      if (cell === "") continue;
      const n = Number(cell.replace(/,/g, ""));
      if (!Number.isFinite(n)) warnings.push(`${lineNo(i)} 行目: ${f === "maxLength" ? "最大長" : f === "minLength" ? "最小長" : f === "min" ? "最小値" : "最大値"}「${cell}」は数字ではないため読み飛ばしました`);
      else item[f] = n;
    }
    const pat = get("pattern"); if (pat) item.pattern = pat;
    const desc = get("description"); if (desc) item.description = desc as ParsedItem["description"];
    items.push(item);
  });

  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) warnings.push(`項目 ID「${it.id}」が貼り付けの中で重複しています`);
    seen.add(it.id);
  }
  return { items, warnings, headerDetected };
}

/** 既存の項目と ID が重なるものを除く */
export function splitDuplicateItems(parsed: readonly ParsedItem[], existing: readonly Pick<ScreenItem, "id">[]): { add: ParsedItem[]; duplicates: ParsedItem[] } {
  const have = new Set(existing.map((c) => String(c.id)));
  const add: ParsedItem[] = [], duplicates: ParsedItem[] = [];
  for (const c of parsed) {
    if (have.has(c.id)) duplicates.push(c);
    else { add.push(c); have.add(c.id); }
  }
  return { add, duplicates };
}
