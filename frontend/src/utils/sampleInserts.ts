/**
 * テーブル定義からの、サンプルの INSERT 文 (UI 改善提案 続編 第 8 弾 #153)。カラムの名前・型・桁数・制約から、それらしい値の行を作る (画面に依存しない純関数)。
 * 保存はしない (設計の原本には、サンプル行を持たない)。テストデータ・動作確認の下書き用。
 * 自動採番の列は、列ごと省く。主キー・ユニークの列は、行ごとに違う値にする。値の作り方は、画面デザイナのサンプル値 (sampleValues) と同じ。
 */
import type { Column, Table } from "../types/v3";
import { sampleText } from "./sampleValues";
import { quoteIdentifier, type SqlDialect } from "./ddlGenerator";

type Kind = "int" | "num" | "date" | "datetime" | "bool" | "text";

function kindOf(c: Column): Kind {
  const t = String(c.dataType ?? "").toUpperCase();
  if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|SERIAL|BIGSERIAL)/.test(t)) return "int";
  if (/^(DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|NUMBER|MONEY)/.test(t)) return "num";
  if (t === "DATE") return "date";
  if (/^(TIMESTAMP|DATETIME|TIME)/.test(t)) return "datetime";
  if (/^(BOOL|BIT)/.test(t)) return "bool";
  return "text";
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

function valueFor(c: Column, row: number, unique: boolean): string {
  const k = kindOf(c);
  const base = { label: String(c.name ?? ""), id: String(c.physicalName ?? ""), maxLength: typeof c.length === "number" ? c.length : undefined };
  if (k === "bool") return row % 2 === 0 ? "TRUE" : "FALSE";
  if (k === "int") {
    if (c.primaryKey || unique) return String(row + 1);
    const n = Number(sampleText({ ...base, type: "integer" }, "typical", row).replace(/,/g, ""));
    return String(Number.isFinite(n) ? n : row + 1);
  }
  if (k === "num") {
    const n = Number(sampleText({ ...base, type: "number" }, "typical", row).replace(/,/g, ""));
    return String(Number.isFinite(n) ? n : row + 1);
  }
  if (k === "date") return quote(sampleText({ ...base, type: "date" }, "typical", row).replace(/\//g, "-"));
  if (k === "datetime") return quote(`${sampleText({ ...base, type: "datetime" }, "typical", row).replace(/\//g, "-")}:00`);
  let text = sampleText({ ...base, type: "string" }, "typical", row);
  if (c.primaryKey || unique) {
    // 行ごとに違う値にする (桁数があれば、収まる範囲で)
    const suffix = String(row + 1);
    const len = typeof c.length === "number" && c.length > 0 ? c.length : undefined;
    text = len ? `${text.slice(0, Math.max(0, len - suffix.length))}${suffix}` : `${text}${suffix}`;
    // 値が同じになりやすい名前の列でも、行番号で区別できるように、末尾を行番号にする
  }
  return quote(text);
}

/** rows 行ぶんの INSERT 文 (1 行 1 文)。自動採番の列は含めない。列が無ければ空 */
export function generateSampleInserts(table: Pick<Table, "physicalName" | "columns">, rows: number, dialect: SqlDialect = "postgresql"): string {
  const cols = (table.columns ?? []).filter((c) => !c.autoIncrement);
  if (cols.length === 0 || rows <= 0) return "";
  // 識別子は DDL と同じく引用符で囲む (予約語の名前・記号を含む名前でも、文が壊れないように)
  const q = (n: string) => quoteIdentifier(String(n), dialect);
  const head = `INSERT INTO ${q(table.physicalName)} (${cols.map((c) => q(c.physicalName)).join(", ")}) VALUES`;
  const lines: string[] = [];
  for (let r = 0; r < Math.min(rows, 50); r++) lines.push(`${head} (${cols.map((c) => valueFor(c, r, !!c.unique)).join(", ")});`);
  return lines.join("\n");
}
