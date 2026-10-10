/**
 * Excel・スプレッドシートの表 (タブ区切り / カンマ区切り) から、テーブルのカラム定義を読み取る。
 * 既存のテーブル定義書 (Excel) を Harmony へ移すとき、1 列ずつ入力せずに貼り付けで作るため。
 *
 * - 先頭行が見出しなら、見出しの名前で列を対応づける (順序は自由)。見出しがなければ、
 *   物理名 / 表示名 / 型 / 長さ / NOT NULL / PK / UK / 連番 / デフォルト / 備考 の順とみなす
 * - 型は `VARCHAR(100)` `DECIMAL(10,2)` のような書き方と、`varchar` `int` `文字列` などの別名を読む
 * - 真偽の列は ○ 〇 ✓ レ Y 1 true はい などを「はい」、空・× - N 0 false を「いいえ」とする
 */
import type { Column } from "../types/v3/table";

export interface ParsedColumn {
  physicalName: string;
  name: string;
  dataType: string;
  length?: number;
  scale?: number;
  notNull?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
  comment?: string;
}

export interface ColumnPasteResult {
  columns: ParsedColumn[];
  /** 読み取れなかった・直した点 (行番号つき) */
  warnings: string[];
  /** 先頭行を見出しとして読んだか */
  headerDetected: boolean;
}

type Field = "physicalName" | "name" | "dataType" | "length" | "notNull" | "primaryKey" | "unique" | "autoIncrement" | "defaultValue" | "comment";

const DEFAULT_ORDER: Field[] = ["physicalName", "name", "dataType", "length", "notNull", "primaryKey", "unique", "autoIncrement", "defaultValue", "comment"];

const norm = (s: string) => s.replace(/[\s　_\-・\/()（）]/g, "").toLowerCase();

const HEADER_ALIASES: Array<[Field, string[]]> = [
  ["physicalName", ["物理名", "物理カラム名", "カラム名", "列名", "column", "columnname", "physicalname", "フィールド名", "項目名物理"]],
  ["name", ["論理名", "表示名", "論理カラム名", "名称", "名前", "日本語名", "logicalname", "displayname", "項目名", "項目名称"]],
  ["dataType", ["データ型", "型", "type", "datatype", "属性"]],
  ["length", ["長さ", "桁数", "桁", "サイズ", "length", "size", "最大長"]],
  ["notNull", ["notnull", "nn", "必須", "null不可", "nullable不可", "非null", "nullを許可しない", "null"]],
  ["primaryKey", ["pk", "主キー", "primarykey", "プライマリキー"]],
  ["unique", ["uk", "ユニーク", "unique", "一意", "一意制約"]],
  ["autoIncrement", ["ai", "autoincrement", "連番", "自動採番", "採番", "identity"]],
  ["defaultValue", ["デフォルト", "既定値", "初期値", "default", "defaultvalue", "デフォルト値"]],
  ["comment", ["備考", "コメント", "説明", "comment", "description", "補足", "memo"]],
];

const TRUE_TOKENS = new Set(["○", "〇", "◯", "◎", "●", "✓", "✔", "レ", "y", "yes", "1", "true", "t", "はい", "あり", "有", "要", "必須", "x"]);
const FALSE_TOKENS = new Set(["", "×", "✕", "-", "－", "ー", "n", "no", "0", "false", "f", "いいえ", "なし", "無", "不要", "任意"]);

/** 型名の別名 → 組み込みの型 */
const TYPE_ALIASES: Record<string, string> = {
  varchar: "VARCHAR", varchar2: "VARCHAR", nvarchar: "VARCHAR", string: "VARCHAR", 文字列: "VARCHAR", 可変長文字列: "VARCHAR",
  char: "CHAR", nchar: "CHAR", 固定長文字列: "CHAR",
  text: "TEXT", clob: "TEXT", longtext: "TEXT", 長文: "TEXT",
  int: "INTEGER", integer: "INTEGER", int4: "INTEGER", 整数: "INTEGER", 数値: "INTEGER",
  bigint: "BIGINT", int8: "BIGINT", long: "BIGINT",
  smallint: "SMALLINT", int2: "SMALLINT", tinyint: "SMALLINT",
  decimal: "DECIMAL", numeric: "DECIMAL", number: "DECIMAL", 小数: "DECIMAL",
  float: "FLOAT", double: "FLOAT", real: "FLOAT", 浮動小数: "FLOAT",
  boolean: "BOOLEAN", bool: "BOOLEAN", bit: "BOOLEAN", 真偽: "BOOLEAN",
  date: "DATE", 日付: "DATE",
  time: "TIME", 時刻: "TIME",
  timestamp: "TIMESTAMP", datetime: "TIMESTAMP", 日時: "TIMESTAMP", timestamptz: "TIMESTAMP",
  blob: "BLOB", bytea: "BLOB", binary: "BLOB", varbinary: "BLOB",
  json: "JSON", jsonb: "JSON",
};

/** 区切り文字を決める: タブがあればタブ、なければカンマ */
function detectDelimiter(text: string): string {
  return text.includes("\t") ? "\t" : ",";
}

/** 1 行を分ける。カンマ区切りでは "..." で囲んだ中のカンマ・改行は区切りにしない */
function splitRow(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "", inQ = false, depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === "(" || ch === "（") { depth++; cur += ch; }
    else if (ch === ")" || ch === "）") { depth = Math.max(0, depth - 1); cur += ch; }
    else if (ch === "," && depth === 0) { out.push(cur); cur = ""; } // 型の (10,2) のカンマは区切りにしない
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 見出しの 1 セルが、どの項目か (分からなければ null) */
export function headerField(cell: string): Field | null {
  const n = norm(cell);
  if (!n) return null;
  for (const [field, aliases] of HEADER_ALIASES) if (aliases.some((a) => norm(a) === n)) return field;
  return null;
}

export function parseBoolean(cell: string): boolean | undefined {
  const t = cell.trim().toLowerCase();
  if (TRUE_TOKENS.has(t)) return true;
  if (FALSE_TOKENS.has(t)) return false;
  return undefined;
}

/** 型の書き方 (`varchar(100)` `DECIMAL(10,2)` `int` `文字列`) を、型・長さ・小数桁に分ける */
export function parseDataType(cell: string): { dataType: string; length?: number; scale?: number; known: boolean } {
  const raw = cell.trim();
  const m = raw.match(/^([^(（\s]+)\s*[(（]\s*(\d+)\s*(?:[,，]\s*(\d+)\s*)?[)）]\s*$/);
  const base = (m ? m[1] : raw).trim();
  const key = base.toLowerCase().replace(/[\s　]/g, "");
  const mapped = TYPE_ALIASES[key] ?? TYPE_ALIASES[base];
  const dataType = mapped ?? base.toUpperCase();
  return {
    dataType,
    ...(m ? { length: Number(m[2]) } : {}),
    ...(m && m[3] !== undefined ? { scale: Number(m[3]) } : {}),
    known: !!mapped,
  };
}

/** 物理名を snake_case に寄せる (英数字と _ のみ)。直したかどうかも返す */
export function toPhysicalName(raw: string): { value: string; changed: boolean } {
  const trimmed = raw.trim();
  const snake = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s\-.　]+/g, "_")
    .toLowerCase();
  return { value: snake, changed: snake !== trimmed };
}

export function parseColumnTable(text: string): ColumnPasteResult {
  const warnings: string[] = [];
  // 空行は読み飛ばすが、行番号は貼り付けた文のとおりに数える
  const numbered = text.replace(/\r\n?/g, "\n").split("\n").map((line, i) => ({ line, no: i + 1 })).filter((l) => l.line.trim() !== "");
  if (numbered.length === 0) return { columns: [], warnings, headerDetected: false };
  const delim = detectDelimiter(text);
  const rows = numbered.map((l) => splitRow(l.line, delim).map((c) => c.trim()));

  // 見出し: 先頭行のうち 2 つ以上のセルが既知の見出し名なら、見出し行とみなす
  const first = rows[0].map(headerField);
  const headerDetected = first.filter((f) => f !== null).length >= 2;
  const order: Array<Field | null> = headerDetected ? first : DEFAULT_ORDER;
  const body = headerDetected ? rows.slice(1) : rows;
  const bodyStart = headerDetected ? 1 : 0;
  const lineNo = (i: number) => numbered[i + bodyStart].no;

  if (headerDetected && !order.includes("physicalName")) {
    warnings.push("見出しに「物理名」(カラム名) の列が見つかりません。1 列目を物理名として読みます");
    order[0] = "physicalName";
  }

  const columns: ParsedColumn[] = [];
  body.forEach((cells, i) => {
    const get = (f: Field) => { const idx = order.indexOf(f); return idx >= 0 ? (cells[idx] ?? "") : ""; };
    const physRaw = get("physicalName");
    if (!physRaw) { warnings.push(`${lineNo(i)} 行目: 物理名が空のため読み飛ばしました`); return; }
    const phys = toPhysicalName(physRaw);
    if (!/^[a-z_][a-z0-9_]*$/.test(phys.value)) {
      warnings.push(`${lineNo(i)} 行目: 物理名「${physRaw}」に使えない文字があります (英数字と _ のみ)。そのまま取り込むので直してください`);
    } else if (phys.changed) {
      warnings.push(`${lineNo(i)} 行目: 物理名「${physRaw}」を「${phys.value}」にしました`);
    }

    const col: ParsedColumn = { physicalName: phys.value, name: get("name") || phys.value, dataType: "VARCHAR" };
    const typeCell = get("dataType");
    if (typeCell) {
      const t = parseDataType(typeCell);
      col.dataType = t.dataType;
      if (t.length !== undefined) col.length = t.length;
      if (t.scale !== undefined) col.scale = t.scale;
      if (!t.known) warnings.push(`${lineNo(i)} 行目: 型「${typeCell}」は組み込みの型にありません。そのまま「${t.dataType}」として取り込みます`);
    } else {
      warnings.push(`${lineNo(i)} 行目: 型が空のため VARCHAR にしました`);
    }

    const lenCell = get("length");
    if (lenCell) {
      const m = lenCell.match(/^(\d+)\s*(?:[,，]\s*(\d+))?$/);
      if (m) { col.length = Number(m[1]); if (m[2] !== undefined) col.scale = Number(m[2]); }
      else warnings.push(`${lineNo(i)} 行目: 長さ「${lenCell}」は数字ではないため読み飛ばしました`);
    }

    for (const f of ["notNull", "primaryKey", "unique", "autoIncrement"] as const) {
      const cell = get(f);
      if (cell === "") continue;
      const b = parseBoolean(cell);
      if (b === undefined) warnings.push(`${lineNo(i)} 行目: ${f === "notNull" ? "NOT NULL" : f === "primaryKey" ? "PK" : f === "unique" ? "UK" : "連番"}の値「${cell}」が分からないため読み飛ばしました (○ か空で書いてください)`);
      else if (b) col[f] = true;
    }
    // PK は NOT NULL を含む
    if (col.primaryKey) col.notNull = true;

    const def = get("defaultValue"); if (def) col.defaultValue = def;
    const com = get("comment"); if (com) col.comment = com;
    columns.push(col);
  });

  // 同じ物理名が貼り付けの中で重なっていないか
  const seen = new Set<string>();
  for (const c of columns) {
    if (seen.has(c.physicalName)) warnings.push(`物理名「${c.physicalName}」が貼り付けの中で重複しています`);
    seen.add(c.physicalName);
  }
  return { columns, warnings, headerDetected };
}

/** 既存のカラムと物理名が重なるものを除く (除いたものを返す) */
export function splitDuplicates(parsed: readonly ParsedColumn[], existing: readonly Pick<Column, "physicalName">[]): { add: ParsedColumn[]; duplicates: ParsedColumn[] } {
  const have = new Set(existing.map((c) => String(c.physicalName)));
  const add: ParsedColumn[] = [], duplicates: ParsedColumn[] = [];
  for (const c of parsed) {
    if (have.has(c.physicalName)) duplicates.push(c);
    else { add.push(c); have.add(c.physicalName); }
  }
  return { add, duplicates };
}
