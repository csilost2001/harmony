/**
 * DDL 生成の handler 用の補助 (#1561)。DDL を作る本体は `@harmony/shared` (shared/src/ddl.ts) にあり、
 * 画面 (frontend/src/utils/ddlGenerator.ts) と同じものを使う。
 *
 * `designer__generate_ddl` / `designer__export_spec` から利用される。
 */
import { generateDdl, SQL_DIALECTS, type DdlTable, type SqlDialect } from "@harmony/shared";


/**
 * 物理名が足りない (設計の途中) テーブルの、足りない場所の一覧。空なら DDL を出せる。
 * 例: ["テーブルの physicalName", "カラム「金額」の physicalName"]
 */
export function missingPhysicalNames(table: Record<string, unknown>): string[] {
  const out: string[] = [];
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  if (blank(table.physicalName)) out.push("テーブルの physicalName");
  const cols = Array.isArray(table.columns) ? table.columns as Array<Record<string, unknown>> : [];
  for (const c of cols) {
    if (blank(c.physicalName)) out.push(`カラム「${typeof c.name === "string" ? c.name : String(c.id ?? "?")}」の physicalName`);
  }
  return out;
}

/**
 * handler 用: 物理名が足りないテーブルはエラーにせず、足りない場所を書いたコメントだけを出す
 * (全テーブルの DDL を頼んだとき、1 件の書きかけで全体が止まらないように)。
 */
export function generateDdlForSpec(table: Record<string, unknown>, dialect: string, allTables: Array<Record<string, unknown>> = []): string {
  const missing = missingPhysicalNames(table);
  if (missing.length > 0) {
    const label = typeof table.physicalName === "string" && table.physicalName ? table.physicalName : String(table.name ?? table.id ?? "?");
    return `-- テーブル ${label}: 物理名 (physicalName) が未設定のため DDL を出せません (${missing.join("、")})`;
  }
  const dl = (SQL_DIALECTS as readonly string[]).includes(dialect) ? dialect as SqlDialect : "standard";
  return generateDdl(table as unknown as DdlTable, dl, allTables as unknown as DdlTable[]);
}
