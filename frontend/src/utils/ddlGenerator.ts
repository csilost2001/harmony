/**
 * ddlGenerator.ts (v3, #556)
 * テーブル定義から DDL (CREATE TABLE) を生成するユーティリティ。
 * MySQL / PostgreSQL / Oracle / SQL Server / SQLite / 標準SQL に対応。
 * 版どうしの差分 (ALTER 文) は ddlAlter.ts。
 *
 * DDL を作る本体は `@harmony/shared` (shared/src/ddl.ts) にあり、MCP (backend の generate_ddl) と同じものを使う (#1561)。
 * ここは、それを画面向けに再エクスポートし、ダイアレクト名の表示と Markdown のテーブル定義書を足す。
 */
import type { Table } from "../types/v3";
import { generateDdl, resolveColumnPhysical, type SqlDialect } from "@harmony/shared";

export {
  SQL_DIALECTS,
  quoteIdentifier,
  escapeSqlString,
  sanitizeDefaultValue,
  resolveColumnPhysical,
  generateDdl,
  mapDataType,
  indexToDdl,
  constraintToDdl,
  autoIncrementType,
  type SqlDialect,
} from "@harmony/shared";

export const SQL_DIALECT_LABELS: Record<SqlDialect, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  oracle: "Oracle",
  sqlserver: "SQL Server",
  sqlite: "SQLite",
  standard: "標準SQL",
};

/** 全テーブルの DDL を生成。 */
export function generateAllDdl(tables: Table[], dialect: SqlDialect): string {
  return tables.map((t) => generateDdl(t, dialect, tables)).join("\n\n");
}

/** Markdown 形式のテーブル定義書 (1 件分)。 */
export function generateTableMarkdown(table: Table): string {
  const lines: string[] = [
    `### ${table.physicalName}（${table.name}）`,
    "",
  ];

  if (table.description) {
    lines.push(table.description, "");
  }

  // カラム定義
  lines.push(
    "| # | 物理名 | 表示名 | データ型 | 長さ | NN | PK | UK | AI | デフォルト | 備考 |",
    "|---|-------|--------|---------|------|----|----|----|----|----------|------|",
  );
  table.columns.forEach((col, i) => {
    const len = col.length != null ? String(col.length) + (col.scale != null ? `,${col.scale}` : "") : "";
    lines.push(
      `| ${i + 1} | ${col.physicalName} | ${col.name} | ${col.dataType} | ${len} | ${col.notNull ? "✓" : ""} | ${col.primaryKey ? "✓" : ""} | ${col.unique ? "✓" : ""} | ${col.autoIncrement ? "✓" : ""} | ${col.defaultValue ?? ""} | ${col.comment ?? ""} |`,
    );
  });

  // インデックス
  if ((table.indexes ?? []).length > 0) {
    lines.push("", "**インデックス**", "");
    lines.push(
      "| インデックス物理名 | カラム | ユニーク | WHERE |",
      "|------------------|--------|---------|-------|",
    );
    for (const idx of table.indexes ?? []) {
      const colList = idx.columns.map((ic) => {
        const phys = resolveColumnPhysical(table, ic.columnId);
        return `${phys}${ic.order === "desc" ? " DESC" : ""}`;
      }).join(", ");
      lines.push(`| ${idx.physicalName} | ${colList} | ${idx.unique ? "✓" : ""} | ${idx.where ?? ""} |`);
    }
  }

  return lines.join("\n");
}

/** 全テーブルの Markdown を生成。 */
export function generateAllTableMarkdown(tables: Table[], projectName: string): string {
  const lines: string[] = [
    `# ${projectName} — テーブル設計書`,
    "",
    `> テーブル数: ${tables.length}`,
    "",
    "## 目次",
    "",
    ...tables.map((t, i) => `${i + 1}. [${t.physicalName}（${t.name}）](#${t.physicalName})`),
    "",
    "---",
    "",
  ];

  for (const t of tables) {
    lines.push(generateTableMarkdown(t), "", "---", "");
  }

  lines.push(`> 生成日時: ${new Date().toLocaleString("ja-JP")}`);
  return lines.join("\n");
}
