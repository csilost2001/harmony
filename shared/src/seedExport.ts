/**
 * 初期データ (汎用定義 seed-data) の書き出し: INSERT 文 / JSON (#1499)。
 * 行のキーは、テーブルのカラムの id でも物理名でもよい。書き出すときは物理名にそろえる。
 * 文字は標準 SQL の書き方 ('' で ' を逃がす)。MySQL の既定のように、バックスラッシュを逃がし文字にする DB へ流すときは、NO_BACKSLASH_ESCAPES にするか、バックスラッシュを含む値に気をつける。
 * 純粋関数。仕様: docs/spec/generic-definition-layer.md §4.2.1
 */
import type { DocTable } from "./designDocument.js";

type Row = Record<string, unknown>;
type Col = NonNullable<DocTable["columns"]>[number];

const NUMERIC = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|NUMBER)\b/i;
const BOOLEAN = /^BOOL/i;
const quoteIdent = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const quoteStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function findColumn(table: DocTable, key: string): Col | undefined {
  return (table.columns ?? []).find((c) => c.id === key || c.physicalName === key);
}

/** 行を物理名のキーにそろえる (テーブルにないキーは `unknown` に分ける)。カラムの並びに従う */
export function normalizeSeedRows(table: DocTable, rows: readonly Row[]): { rows: Row[]; unknownKeys: string[] } {
  const unknown = new Set<string>();
  const order = new Map((table.columns ?? []).map((c, i) => [c.physicalName, i] as const));
  const out = rows.map((r) => {
    const named: Row = {};
    for (const [k, v] of Object.entries(r)) {
      const c = findColumn(table, k);
      if (c) named[c.physicalName] = v; else unknown.add(k);
    }
    return Object.fromEntries(Object.entries(named).sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  });
  return { rows: out, unknownKeys: [...unknown] };
}

/** 値を SQL の定数にする。数のカラムの「数の文字」は数に、真偽のカラムは TRUE / FALSE に */
function literal(v: unknown, col: Col | undefined): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") {
    if (col?.dataType && NUMERIC.test(col.dataType) && /^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim();
    if (col?.dataType && BOOLEAN.test(col.dataType) && /^(true|false)$/i.test(v)) return v.toUpperCase();
    return quoteStr(v);
  }
  return quoteStr(JSON.stringify(v));
}

/** 1 つのテーブルの INSERT 文 (1 行 1 文。行ごとに、持っているカラムだけを書くので、ほかは既定値になる) */
export function seedDataToSql(table: DocTable, rows: readonly Row[]): string {
  const { rows: named } = normalizeSeedRows(table, rows);
  const target = table.physicalName ?? table.id;
  // コメントに改行が入ると、次の行が実行される文になる。空白にする
  const lines = [`-- ${`${table.name ?? table.id} (${target})`.replace(/[\r\n]+/g, " ")} の初期データ ${named.length} 行`];
  for (const r of named) {
    const keys = Object.keys(r);
    if (!keys.length) continue;
    lines.push(`INSERT INTO ${quoteIdent(target)} (${keys.map(quoteIdent).join(", ")}) VALUES (${keys.map((k) => literal(r[k], findColumn(table, k))).join(", ")});`);
  }
  return lines.join("\n") + "\n";
}
