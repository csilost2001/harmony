/**
 * DDL (CREATE TABLE) の生成 (#1144 Phase-1 / #1561)。画面 (frontend) と MCP (backend) で共有する 1 つの実装。
 *
 * 画面の DDL プレビュー / ダウンロードと、`designer__generate_ddl` / `designer__export_spec` が、これを使う。
 * v3 の table (schemas/v3/table.v3.schema.json) は、物理名が `physicalName`、
 * `name` は表示名 (コメント用)。DDL のテーブル名・カラム名・索引・制約は物理名で出す。
 * 外部キーは constraints の foreignKey (columnIds / referencedTableId / referencedColumnIds) から出し、
 * 参照先は `allTables` から物理名に引く。
 *
 * 受け取る型は、DDL に要る項目だけの形 (Ddl*)。frontend の v3 の Table 型はそのまま渡せる。
 * 純粋関数のみで構成、副作用なし。
 *
 * 試験: この実装の直接の試験は、`frontend/src/utils/ddlGenerator.test.ts` が、再 export 経由で受け持っている
 * (backend の `handlers/table.test.ts` の generate_ddl も経由で守る)。ここを変えたら、その試験を見る。
 */

/** SQL ダイアレクト */
export type SqlDialect = "mysql" | "postgresql" | "oracle" | "sqlserver" | "sqlite" | "standard";

export const SQL_DIALECTS: readonly SqlDialect[] = ["mysql", "postgresql", "oracle", "sqlserver", "sqlite", "standard"];

// v3 の table の、DDL に必要な部分だけの形 (検証は schema 側。ここは読み取りのみ)
type FkAction = "cascade" | "setNull" | "setDefault" | "restrict" | "noAction";
export interface DdlColumn {
  id: string; physicalName: string; name?: string; dataType: string;
  length?: number; scale?: number; notNull?: boolean; primaryKey?: boolean; unique?: boolean;
  autoIncrement?: boolean; defaultValue?: string; comment?: string;
}
export interface DdlIndex {
  id: string; physicalName: string; columns: Array<{ columnId: string; order?: string }>;
  unique?: boolean; method?: string; where?: string;
}
export type DdlConstraint =
  | { kind: "primaryKey"; id: string; physicalName?: string; columnIds: string[] }
  | { kind: "unique"; id: string; physicalName?: string; columnIds: string[] }
  | { kind: "check"; id: string; physicalName?: string; expression: string }
  | {
      kind: "foreignKey"; id: string; physicalName?: string; columnIds: string[];
      referencedTableId: string; referencedColumnIds: string[];
      onDelete?: FkAction; onUpdate?: FkAction; noConstraint?: boolean;
    };
export interface DdlDefault { columnId: string; kind: "literal" | "function" | "sequence" | "convention"; value: string }
export interface DdlTrigger {
  id: string; physicalName: string; timing: string; events: string[]; whenCondition?: string; body: string;
}
export interface DdlTable {
  id?: string; physicalName: string; name?: string; comment?: string;
  columns: DdlColumn[]; indexes?: DdlIndex[]; constraints?: DdlConstraint[];
  defaults?: DdlDefault[]; triggers?: DdlTrigger[];
}
type Table = DdlTable;
type Index = DdlIndex;
type Constraint = DdlConstraint;
type ForeignKeyConstraint = Extract<DdlConstraint, { kind: "foreignKey" }>;
type DefaultDefinition = DdlDefault;
type TriggerDefinition = DdlTrigger;

// ── S-004: SQL Injection 対策ヘルパー ──────────────────────────────────────

/**
 * SQL 識別子 (テーブル名・カラム名・インデックス名等) をダイアレクト対応でクォートする。
 * MySQL は `backtick`、SQL Server は [角括弧]、その他はダブルクォートを使用。
 * 識別子内のクォート文字は適切にエスケープされる。
 */
export function quoteIdentifier(name: string, dialect: SqlDialect): string {
  if (dialect === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  if (dialect === "sqlserver") {
    return "[" + name.replace(/]/g, "]]") + "]";
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * SQL 文字列リテラル内のシングルクォートをエスケープする。
 * NUL 文字 (\0) とバックスラッシュも除去・エスケープする。
 * 戻り値はクォートを含まない (呼び出し側が ' で囲む)。
 */
export function escapeSqlString(s: string): string {
  return s
    .replace(/\0/g, "")            // NUL 除去
    .replace(/\\/g, "\\\\")        // バックスラッシュエスケープ
    .replace(/'/g, "''");          // シングルクォートエスケープ
}

/**
 * DEFAULT 値の文字列を安全な SQL 式にサニタイズする。
 * - NULL → NULL
 * - 数値リテラル → そのまま
 * - 既にシングルクォートで囲まれた文字列 → 内側をエスケープして再クォート
 * - 関数呼び出し (英字・アンダースコア・丸括弧・数字のみ) → そのまま
 * - それ以外 → シングルクォートで囲んでエスケープ
 */
export function sanitizeDefaultValue(val: string): string {
  const trimmed = val.trim();
  if (/^null$/i.test(trimmed)) return "NULL";
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (/^'.*'$/s.test(trimmed)) {
    const inner = trimmed.slice(1, -1);
    return "'" + escapeSqlString(inner) + "'";
  }
  // 関数呼び出しパターン (CURRENT_TIMESTAMP, NOW(), GETDATE() 等)
  if (/^[A-Za-z_][A-Za-z0-9_]*(\(\)|\([0-9 ,]*\))?$/.test(trimmed)) return trimmed;
  // 不明な値はシングルクォートでエスケープして囲む
  return "'" + escapeSqlString(trimmed) + "'";
}

// ─────────────────────────────────────────────────────────────────────────────

/** FkAction (lowerCamelCase) → DDL 出力 (UPPER スペース含み) への変換 */
const FK_ACTION_DDL: Record<FkAction, string> = {
  cascade: "CASCADE",
  setNull: "SET NULL",
  setDefault: "SET DEFAULT",
  restrict: "RESTRICT",
  noAction: "NO ACTION",
};

/** Column.id (LocalId) を physicalName に解決。見つからなければ id 文字列をそのまま返す。 */
export function resolveColumnPhysical(table: Table, columnId: string): string {
  return table.columns.find((c) => c.id === columnId)?.physicalName ?? columnId;
}

/** TableId (kebab-case EntityId) を allTables から検索し、Table を返す。 */
function findTable(allTables: Table[], tableId: string): Table | undefined {
  return allTables.find((t) => t.id === tableId);
}

/**
 * テーブル 1 件の DDL を生成。
 * @param table 対象テーブル
 * @param dialect SQL ダイアレクト
 * @param allTables FK 参照解決用の全テーブル一覧 (referencedTableId EntityId から物理名を逆引きするのに使う)
 */
export function generateDdl(table: Table, dialect: SqlDialect, allTables: Table[] = []): string {
  const physical = quoteIdentifier(table.physicalName, dialect);
  const colDefs: string[] = [];
  const pks: string[] = [];

  for (const col of table.columns) {
    const typeStr = col.autoIncrement
      ? autoIncrementType(col.dataType, dialect)
      : mapDataType(col.dataType, col.length, col.scale, dialect);

    let line = `  ${quoteIdentifier(col.physicalName, dialect)} ${typeStr}`;
    if (col.notNull) line += " NOT NULL";
    if (col.unique && !col.primaryKey) line += " UNIQUE";
    if (col.defaultValue && !col.autoIncrement) {
      line += ` DEFAULT ${sanitizeDefaultValue(col.defaultValue)}`;
    }
    if (col.comment && dialect === "mysql") {
      line += ` COMMENT '${escapeSqlString(col.comment)}'`;
    }
    colDefs.push(line);
    if (col.primaryKey) pks.push(quoteIdentifier(col.physicalName, dialect));
  }

  if (pks.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pks.join(", ")})`);
  }

  let ddl = `CREATE TABLE ${physical} (\n${colDefs.join(",\n")}\n)`;
  if (dialect === "mysql") ddl += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
  ddl += ";";

  // Indexes
  for (const idx of table.indexes ?? []) {
    ddl += `\n\n${indexToDdl(table, idx, dialect)}`;
  }

  // Constraints (UNIQUE / CHECK / FOREIGN KEY を ALTER TABLE で追加)
  for (const c of table.constraints ?? []) {
    if (c.kind === "foreignKey" && c.noConstraint) continue; // 論理 FK は DDL に出さない
    ddl += `\n\n${constraintToDdl(table, c, dialect, allTables)}`;
  }

  // DEFAULT 値定義 (ALTER TABLE SET DEFAULT)
  for (const def of table.defaults ?? []) {
    ddl += `\n\n${defaultToDdl(table, def, dialect)}`;
  }

  // トリガー
  for (const trg of table.triggers ?? []) {
    ddl += `\n\n${triggerToDdl(table, trg, dialect)}`;
  }

  // PostgreSQL / Oracle: テーブル / カラムコメント
  if (dialect === "postgresql" || dialect === "oracle") {
    const tableComment = table.comment || table.name; // table.name は v3 では DisplayName (表示名)
    if (tableComment) {
      ddl += `\n\nCOMMENT ON TABLE ${physical} IS '${escapeSqlString(tableComment)}';`;
    }
    for (const col of table.columns) {
      const cmt = col.comment || col.name; // col.name は v3 では DisplayName (表示名)
      if (cmt) {
        ddl += `\nCOMMENT ON COLUMN ${physical}.${quoteIdentifier(col.physicalName, dialect)} IS '${escapeSqlString(cmt)}';`;
      }
    }
  }

  // SQL Server: テーブル / 列の説明 (拡張プロパティ)
  if (dialect === "sqlserver") {
    const prop = (level2: string | null, name: string, text: string) =>
      `EXEC sp_addextendedproperty @name = N'MS_Description', @value = N'${escapeSqlString(text)}', @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'${escapeSqlString(table.physicalName)}'${level2 ? `, @level2type = N'COLUMN', @level2name = N'${escapeSqlString(name)}'` : ""};`;
    const tableComment = table.comment || table.name;
    if (tableComment) ddl += `\n\n${prop(null, "", tableComment)}`;
    for (const col of table.columns) {
      const cmt = col.comment || col.name;
      if (cmt) ddl += `\n${prop("COLUMN", col.physicalName, cmt)}`;
    }
  }

  return ddl;
}

// ── 内部ヘルパー ────────────────────────────────────────────────────────────

export function mapDataType(dt: string, length?: number, scale?: number, dialect?: SqlDialect): string {
  const d = dialect ?? "standard";
  switch (dt) {
    case "VARCHAR": return d === "sqlserver" ? `NVARCHAR(${length ?? 255})` : `VARCHAR(${length ?? 255})`;
    case "CHAR": return d === "sqlserver" ? `NCHAR(${length ?? 1})` : `CHAR(${length ?? 1})`;
    case "TEXT": return d === "oracle" ? "CLOB" : d === "sqlserver" ? "NVARCHAR(MAX)" : "TEXT";
    case "INTEGER": return d === "oracle" ? "NUMBER(10)" : "INTEGER";
    case "BIGINT": return d === "oracle" ? "NUMBER(19)" : "BIGINT";
    case "SMALLINT": return d === "oracle" ? "NUMBER(5)" : "SMALLINT";
    case "DECIMAL": return `DECIMAL(${length ?? 10}, ${scale ?? 2})`;
    case "FLOAT": return d === "oracle" ? "BINARY_FLOAT" : "FLOAT";
    case "BOOLEAN":
      if (d === "sqlserver") return "BIT";
      if (d === "oracle") return "NUMBER(1)";
      if (d === "mysql") return "TINYINT(1)";
      return "BOOLEAN";
    case "DATE": return "DATE";
    case "TIME": return d === "oracle" ? "DATE" : "TIME";
    case "TIMESTAMP":
      if (d === "mysql") return "DATETIME";
      if (d === "sqlserver") return "DATETIME2";
      return "TIMESTAMP";
    case "BLOB": return d === "sqlserver" ? "VARBINARY(MAX)" : "BLOB";
    case "JSON":
      if (d === "sqlserver") return "NVARCHAR(MAX)";
      if (d === "oracle") return "CLOB";
      if (d === "postgresql") return "JSONB";
      if (d === "mysql") return "JSON";
      return "TEXT";
    default:
      // 拡張参照 (例: "oracle:VARCHAR2") は namespace prefix を剥がして UPPER 部分を出力
      if (typeof dt === "string" && dt.includes(":")) {
        return dt.split(":")[1] ?? dt;
      }
      return dt;
  }
}

export function indexToDdl(table: Table, idx: Index, dialect: SqlDialect): string {
  const physical = quoteIdentifier(table.physicalName, dialect);
  const colList = idx.columns.map((ic) => {
    const phys = resolveColumnPhysical(table, ic.columnId);
    const ord = ic.order === "desc" ? " DESC" : "";
    return `${quoteIdentifier(phys, dialect)}${ord}`;
  }).join(", ");
  const uniq = idx.unique ? "UNIQUE " : "";
  const method = idx.method && idx.method !== "btree" && dialect === "postgresql"
    ? ` USING ${idx.method.toUpperCase()}`
    : "";
  let stmt = `CREATE ${uniq}INDEX ${quoteIdentifier(idx.physicalName, dialect)} ON ${physical}${method} (${colList})`;
  if (idx.where) stmt += `\n  WHERE ${idx.where}`;
  return stmt + ";";
}

export function constraintToDdl(
  table: Table,
  c: Constraint,
  dialect: SqlDialect,
  allTables: Table[],
): string {
  const physical = quoteIdentifier(table.physicalName, dialect);
  const constraintName = quoteIdentifier(c.physicalName ?? c.id, dialect);
  switch (c.kind) {
    case "primaryKey": {
      // #1185 提案 C: PRIMARY KEY 制約 DDL (composite PK 対応)
      const cols = c.columnIds.map((id) => quoteIdentifier(resolveColumnPhysical(table, id), dialect));
      return `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName} PRIMARY KEY (${cols.join(", ")});`;
    }
    case "unique": {
      const cols = c.columnIds.map((id) => quoteIdentifier(resolveColumnPhysical(table, id), dialect));
      return `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName} UNIQUE (${cols.join(", ")});`;
    }
    case "check":
      return `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName} CHECK (${c.expression});`;
    case "foreignKey":
      return foreignKeyToDdl(table, c, allTables, constraintName, dialect);
  }
}

function foreignKeyToDdl(
  table: Table,
  fk: ForeignKeyConstraint,
  allTables: Table[],
  constraintName: string,
  dialect: SqlDialect,
): string {
  const physical = quoteIdentifier(table.physicalName, dialect);
  const ownCols = fk.columnIds.map((id) => quoteIdentifier(resolveColumnPhysical(table, id), dialect));
  const refTable = findTable(allTables, fk.referencedTableId);
  const refTableName = refTable
    ? quoteIdentifier(refTable.physicalName, dialect)
    : `<unknown:${String(fk.referencedTableId).slice(0, 8)}>`;
  const refCols = fk.referencedColumnIds.map((id) =>
    quoteIdentifier(refTable ? resolveColumnPhysical(refTable, id) : id, dialect),
  );
  let s = `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName}\n  FOREIGN KEY (${ownCols.join(", ")}) REFERENCES ${refTableName}(${refCols.join(", ")})`;
  if (fk.onDelete) s += `\n  ON DELETE ${FK_ACTION_DDL[fk.onDelete]}`;
  if (fk.onUpdate) s += `\n  ON UPDATE ${FK_ACTION_DDL[fk.onUpdate]}`;
  return s + ";";
}

function defaultToDdl(table: Table, def: DefaultDefinition, dialect: SqlDialect): string {
  const physical = quoteIdentifier(table.physicalName, dialect);
  const colName = quoteIdentifier(resolveColumnPhysical(table, def.columnId), dialect);
  let expr: string;
  switch (def.kind) {
    case "literal":
    case "function":
      expr = sanitizeDefaultValue(def.value);
      break;
    case "sequence":
      expr = dialect === "postgresql"
        ? `nextval('${escapeSqlString(def.value)}')`
        : sanitizeDefaultValue(def.value);
      break;
    case "convention":
      expr = `NULL /* ${def.value.replace(/\*\//g, "* /")} */`;
      break;
  }
  if (dialect === "oracle") {
    return `ALTER TABLE ${physical} MODIFY (${colName} DEFAULT ${expr});`;
  }
  if (dialect === "sqlserver") {
    // SQL Server の既定値は、名前つきの制約として足す
    const name = quoteIdentifier(`DF_${table.physicalName}_${resolveColumnPhysical(table, def.columnId)}`, dialect);
    return `ALTER TABLE ${physical} ADD CONSTRAINT ${name} DEFAULT ${expr} FOR ${colName};`;
  }
  return `ALTER TABLE ${physical} ALTER COLUMN ${colName} SET DEFAULT ${expr};`;
}

function triggerToDdl(table: Table, trg: TriggerDefinition, dialect: SqlDialect): string {
  const physical = quoteIdentifier(table.physicalName, dialect);
  const events = trg.events.join(" OR ");
  const when = trg.whenCondition ? `\n  WHEN (${trg.whenCondition})` : "";
  // INSTEAD_OF はビュー用、テーブルでは通常使わないが schema 上は有効
  const timing = trg.timing === "INSTEAD_OF" ? "INSTEAD OF" : trg.timing;
  const triggerName = quoteIdentifier(trg.physicalName, dialect);
  if (dialect === "postgresql") {
    const fnName = quoteIdentifier(`${trg.physicalName}_fn`, dialect);
    const returnStmt = trg.events.length === 1 && trg.events[0] === "DELETE"
      ? "RETURN OLD;"
      : "RETURN NEW;";
    return [
      `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS TRIGGER AS $$`,
      `BEGIN`,
      `  ${trg.body.split("\n").join("\n  ")}`,
      `  ${returnStmt}`,
      `END;`,
      `$$ LANGUAGE plpgsql;`,
      ``,
      `CREATE TRIGGER ${triggerName}`,
      `${timing} ${events} ON ${physical}${when}`,
      `FOR EACH ROW EXECUTE FUNCTION ${fnName}();`,
    ].join("\n");
  }
  if (dialect === "sqlserver") {
    // SQL Server のトリガーは、文単位 (AFTER / INSTEAD OF のみ。BEFORE は無い。WHEN 句も無い)
    const note = timing === "BEFORE" ? "-- SQL Server に BEFORE トリガーは無いため、INSTEAD OF にしています。意味が変わるので確認してください\n" : "";
    const tm = timing === "BEFORE" ? "INSTEAD OF" : timing;
    return [
      `${note}CREATE TRIGGER ${triggerName}`,
      `ON ${physical}`,
      `${tm} ${trg.events.join(", ")}`,
      `AS`,
      `BEGIN`,
      `  ${trg.body.split("\n").join("\n  ")}`,
      `END;`,
    ].join("\n");
  }
  return [
    `CREATE TRIGGER ${triggerName}`,
    `${timing} ${events} ON ${physical}${when}`,
    `FOR EACH ROW`,
    `BEGIN`,
    `  ${trg.body.split("\n").join("\n  ")}`,
    `END;`,
  ].join("\n");
}

export function autoIncrementType(dt: string, dialect: SqlDialect): string {
  switch (dialect) {
    case "mysql": return `${mapDataType(dt, undefined, undefined, dialect)} AUTO_INCREMENT`;
    case "postgresql": return dt === "BIGINT" ? "BIGSERIAL" : "SERIAL";
    case "oracle": return `${mapDataType(dt, undefined, undefined, dialect)} GENERATED ALWAYS AS IDENTITY`;
    case "sqlserver": return `${mapDataType(dt, undefined, undefined, dialect)} IDENTITY(1,1)`;
    case "sqlite": return "INTEGER";
    default: return mapDataType(dt, undefined, undefined, dialect);
  }
}
