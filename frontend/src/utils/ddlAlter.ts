/**
 * 版の差分から、変更用の DDL (ALTER 文) を作る。テーブルの前の版 (保存前の版・別の版) と今の定義を比べる。
 *
 * - 列は Column.id で対応づける (物理名が変わっていれば、名前の変更 = RENAME。消して足すのではない)
 * - インデックス・制約は id で対応づける。変わったものは、消して作り直す
 * - 主キーの構成の変更・方言が対応しない変更は、実行しない注意書き (コメント) にする。実行前に、必ず内容を確かめること
 * データは移行されない (列の削除・型の縮小は、データを失いうる)。出力の各文の前に、注意があれば `-- ` で添える。
 */
import type { Column, Constraint, Index, Table } from "../types/v3";
import { autoIncrementType, constraintToDdl, generateDdl, indexToDdl, mapDataType, quoteIdentifier, resolveColumnPhysical, sanitizeDefaultValue, type SqlDialect } from "./ddlGenerator";

export interface AlterResult {
  /** 実行する文 (注意書きのコメントを含む) */
  statements: string[];
  /** 変更が何も無い */
  empty: boolean;
  /** データを失う・失いうる変更の数 */
  destructive: number;
}

const colKey = (c: Column) => c.id || c.physicalName;
const q = quoteIdentifier;

function columnType(c: Column, dialect: SqlDialect): string {
  return c.autoIncrement ? autoIncrementType(c.dataType, dialect) : mapDataType(c.dataType, c.length, c.scale, dialect);
}

function fullColumnDef(c: Column, dialect: SqlDialect): string {
  let def = `${q(c.physicalName, dialect)} ${columnType(c, dialect)}`;
  if (c.notNull) def += " NOT NULL";
  if (c.defaultValue && !c.autoIncrement) def += ` DEFAULT ${sanitizeDefaultValue(c.defaultValue)}`;
  return def;
}

const typeSig = (c: Column) => `${c.dataType}|${c.length ?? ""}|${c.scale ?? ""}|${c.autoIncrement ? "ai" : ""}`;

const sameIndex = (a: Index, b: Index, ta: Table, tb: Table) =>
  a.physicalName === b.physicalName && !!a.unique === !!b.unique && (a.where ?? "") === (b.where ?? "") && (a.method ?? "btree") === (b.method ?? "btree")
  && a.columns.map((c) => `${resolveColumnPhysical(ta, c.columnId)}:${c.order ?? "asc"}`).join(",") === b.columns.map((c) => `${resolveColumnPhysical(tb, c.columnId)}:${c.order ?? "asc"}`).join(",");

function constraintSig(c: Constraint, t: Table): string {
  switch (c.kind) {
    case "check": return `check|${c.expression}`;
    case "foreignKey": return `fk|${c.columnIds.map((id) => resolveColumnPhysical(t, id)).join(",")}|${c.referencedTableId}|${c.referencedColumnIds.join(",")}|${c.onDelete ?? ""}|${c.onUpdate ?? ""}|${c.noConstraint ? "nc" : ""}`;
    default: return `${c.kind}|${c.columnIds.map((id) => resolveColumnPhysical(t, id)).join(",")}`;
  }
}

function dropIndex(t: Table, idx: Index, d: SqlDialect): string {
  const name = q(idx.physicalName, d);
  return d === "mysql" || d === "sqlserver" ? `DROP INDEX ${name} ON ${q(t.physicalName, d)};` : `DROP INDEX ${name};`;
}

function dropConstraint(t: Table, c: Constraint, d: SqlDialect): string {
  const table = q(t.physicalName, d);
  const name = q(c.physicalName ?? c.id, d);
  if (d === "mysql") {
    if (c.kind === "foreignKey") return `ALTER TABLE ${table} DROP FOREIGN KEY ${name};`;
    if (c.kind === "unique") return `ALTER TABLE ${table} DROP INDEX ${name};`;
    if (c.kind === "check") return `ALTER TABLE ${table} DROP CHECK ${name};`;
    return `ALTER TABLE ${table} DROP PRIMARY KEY;`;
  }
  return `ALTER TABLE ${table} DROP CONSTRAINT ${name};`;
}

function modifyColumn(oldC: Column, c: Column, t: Table, d: SqlDialect, out: string[]): void {
  const table = q(t.physicalName, d);
  const name = q(c.physicalName, d);
  const typeChanged = typeSig(oldC) !== typeSig(c);
  const nullChanged = !!oldC.notNull !== !!c.notNull;
  const defChanged = (oldC.defaultValue ?? "") !== (c.defaultValue ?? "");
  if (!typeChanged && !nullChanged && !defChanged) return;
  switch (d) {
    case "mysql":
      out.push(`ALTER TABLE ${table} MODIFY COLUMN ${fullColumnDef(c, d)};`);
      break;
    case "oracle":
      out.push(`ALTER TABLE ${table} MODIFY (${name}${typeChanged ? ` ${columnType(c, d)}` : ""}${defChanged ? ` DEFAULT ${c.defaultValue ? sanitizeDefaultValue(c.defaultValue) : "NULL"}` : ""}${nullChanged ? (c.notNull ? " NOT NULL" : " NULL") : ""});`);
      break;
    case "sqlserver":
      if (typeChanged || nullChanged) out.push(`ALTER TABLE ${table} ALTER COLUMN ${name} ${columnType(c, d)}${c.notNull ? " NOT NULL" : " NULL"};`);
      if (defChanged) out.push(`-- 既定値の変更: SQL Server は名前つきの既定値の制約を、消して作り直します (既存の制約名を確かめてください)\n${c.defaultValue ? `ALTER TABLE ${table} ADD CONSTRAINT ${q(`DF_${t.physicalName}_${c.physicalName}`, d)} DEFAULT ${sanitizeDefaultValue(c.defaultValue)} FOR ${name};` : `-- ALTER TABLE ${table} DROP CONSTRAINT <既定値の制約名>;`}`);
      break;
    case "sqlite":
      out.push(`-- SQLite は列の変更 (型・NOT NULL・既定値) に対応していません。テーブルを作り直して、データを移してください: ${t.physicalName}.${c.physicalName}`);
      break;
    default: // postgresql / standard
      if (typeChanged) out.push(`ALTER TABLE ${table} ALTER COLUMN ${name} ${d === "postgresql" ? "TYPE" : "SET DATA TYPE"} ${columnType(c, d)};`);
      if (nullChanged) out.push(`ALTER TABLE ${table} ALTER COLUMN ${name} ${c.notNull ? "SET" : "DROP"} NOT NULL;`);
      if (defChanged) out.push(c.defaultValue ? `ALTER TABLE ${table} ALTER COLUMN ${name} SET DEFAULT ${sanitizeDefaultValue(c.defaultValue)};` : `ALTER TABLE ${table} ALTER COLUMN ${name} DROP DEFAULT;`);
  }
}

/**
 * 前の版から今の定義への変更用の DDL。前の版が無ければ CREATE TABLE、今の定義が無ければ DROP TABLE。
 * 参照解決用に、全テーブル (今の定義) を渡す。
 */
export function generateAlterDdl(oldTable: Table | null, newTable: Table | null, dialect: SqlDialect, allTables: Table[] = []): AlterResult {
  if (!oldTable && !newTable) return { statements: [], empty: true, destructive: 0 };
  if (!oldTable && newTable) return { statements: [generateDdl(newTable, dialect, allTables)], empty: false, destructive: 0 };
  if (oldTable && !newTable) return { statements: [`DROP TABLE ${q(oldTable.physicalName, dialect)};`], empty: false, destructive: 1 };
  const o = oldTable!, n = newTable!;
  const out: string[] = [];
  let destructive = 0;

  // テーブル名の変更
  if (o.physicalName !== n.physicalName) {
    out.push(dialect === "mysql" ? `RENAME TABLE ${q(o.physicalName, dialect)} TO ${q(n.physicalName, dialect)};`
      : dialect === "sqlserver" ? `EXEC sp_rename N'${o.physicalName.replace(/'/g, "''")}', N'${n.physicalName.replace(/'/g, "''")}';`
        : `ALTER TABLE ${q(o.physicalName, dialect)} RENAME TO ${q(n.physicalName, dialect)};`);
  }
  const table = q(n.physicalName, dialect);

  // 制約 (先に、消えるもの・変わるものを外す。列の削除・型の変更の前に外さないと、失敗する)
  const oldCons = new Map((o.constraints ?? []).filter((c) => !(c.kind === "foreignKey" && c.noConstraint)).map((c) => [c.id, c]));
  const newCons = new Map((n.constraints ?? []).filter((c) => !(c.kind === "foreignKey" && c.noConstraint)).map((c) => [c.id, c]));
  const changedCons = [...newCons.values()].filter((c) => oldCons.has(c.id) && constraintSig(oldCons.get(c.id)!, o) !== constraintSig(c, n));
  for (const c of oldCons.values()) if (!newCons.has(c.id) || changedCons.some((x) => x.id === c.id)) out.push(dropConstraint({ ...o, physicalName: n.physicalName }, c, dialect));
  const oldIdx = new Map((o.indexes ?? []).map((i) => [i.id, i]));
  const newIdx = new Map((n.indexes ?? []).map((i) => [i.id, i]));
  const changedIdx = [...newIdx.values()].filter((i) => oldIdx.has(i.id) && !sameIndex(oldIdx.get(i.id)!, i, o, n));
  for (const i of oldIdx.values()) if (!newIdx.has(i.id) || changedIdx.some((x) => x.id === i.id)) out.push(dropIndex({ ...o, physicalName: n.physicalName }, i, dialect));

  // 列
  const oldCols = new Map(o.columns.map((c) => [colKey(c), c]));
  const newCols = new Map(n.columns.map((c) => [colKey(c), c]));
  for (const c of o.columns) if (!newCols.has(colKey(c))) {
    out.push(`-- 列「${c.physicalName}」を削除します。この列のデータは失われます`);
    out.push(`ALTER TABLE ${table} DROP COLUMN ${q(c.physicalName, dialect)};`);
    destructive++;
  }
  for (const c of n.columns) {
    const prev = oldCols.get(colKey(c));
    if (!prev) {
      if (c.notNull && !c.defaultValue && !c.autoIncrement) out.push(`-- NOT NULL で既定値の無い列です。行がある表では失敗します。既定値を付けるか、いったん NULL を許してから埋めてください: ${c.physicalName}`);
      out.push(dialect === "oracle" ? `ALTER TABLE ${table} ADD (${fullColumnDef(c, dialect)});` : dialect === "sqlserver" ? `ALTER TABLE ${table} ADD ${fullColumnDef(c, dialect)};` : `ALTER TABLE ${table} ADD COLUMN ${fullColumnDef(c, dialect)};`);
      continue;
    }
    if (prev.physicalName !== c.physicalName) {
      out.push(dialect === "sqlserver" ? `EXEC sp_rename N'${n.physicalName.replace(/'/g, "''")}.${prev.physicalName.replace(/'/g, "''")}', N'${c.physicalName.replace(/'/g, "''")}', 'COLUMN';` : `ALTER TABLE ${table} RENAME COLUMN ${q(prev.physicalName, dialect)} TO ${q(c.physicalName, dialect)};`);
    }
    // 列の変更 (改名後の名前で)
    const before = out.length;
    modifyColumn(prev, c, n, dialect, out);
    const shrinks = prev.dataType === c.dataType && (c.length ?? Infinity) < (prev.length ?? 0);
    if (out.length > before && (prev.dataType !== c.dataType || shrinks)) { out.splice(before, 0, `-- 列「${c.physicalName}」の型が変わります。既存のデータが変換できないと失敗します${shrinks ? " (長さが縮みます: 切り捨て・失敗の恐れ)" : ""}`); if (shrinks) destructive++; }
    if (!!prev.primaryKey !== !!c.primaryKey) out.push(`-- 列「${c.physicalName}」の主キーの指定が変わりました。主キーの付け替えは自動では作りません。手で確認してください`);
    if (!!prev.unique !== !!c.unique && !c.primaryKey) out.push(`-- 列「${c.physicalName}」の一意の指定が変わりました。${c.unique ? `ALTER TABLE ${table} ADD CONSTRAINT ${q(`uq_${n.physicalName}_${c.physicalName}`, dialect)} UNIQUE (${q(c.physicalName, dialect)});` : "既存の一意の制約を、名前を確かめて消してください。"}`);
  }

  // 制約・インデックスの追加 (列の後)
  for (const c of newCons.values()) if (!oldCons.has(c.id) || changedCons.some((x) => x.id === c.id)) out.push(constraintToDdl(n, c, dialect, allTables));
  for (const i of newIdx.values()) if (!oldIdx.has(i.id) || changedIdx.some((x) => x.id === i.id)) out.push(indexToDdl(n, i, dialect));

  return { statements: out, empty: out.length === 0, destructive };
}

export function alterToText(r: AlterResult): string {
  return r.empty ? "-- 変更はありません" : `${r.destructive ? `-- 注意: データを失いうる変更が ${r.destructive} 件あります。実行前に確認してください\n\n` : ""}${r.statements.join("\n")}`;
}
