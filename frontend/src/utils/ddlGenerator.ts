/**
 * ddlGenerator.ts (v3, #556)
 * テーブル定義から DDL (CREATE TABLE) を生成するユーティリティ。
 * MySQL / PostgreSQL / Oracle / SQLite / 標準SQL に対応。
 *
 * v3 schema (`schemas/v3/table.v3.schema.json`) に整合:
 * - Column.physicalName / Column.name (display) 分離
 * - FK は ConstraintDefinition.foreignKey に集約 (Column.foreignKey は廃止)
 * - FkAction lowerCamelCase ("cascade" 等) → DDL では UPPER 変換 ("CASCADE")
 * - DefaultDefinition.kind: "convention" (旧 "conventionRef" から rename)
 * - TriggerDefinition.physicalName 必須化、INSTEAD_OF / TRUNCATE 対応
 * - FK の参照先テーブル/カラムは UUID/LocalId のため、`allTables` 引数で物理名へ逆引き
 */
import type {
  Table,
  Index,
  Constraint,
  ForeignKeyConstraint,
  DefaultDefinition,
  TriggerDefinition,
  FkAction,
} from "../types/v3";

/** SQL ダイアレクト */
export type SqlDialect = "mysql" | "postgresql" | "oracle" | "sqlite" | "standard";

export const SQL_DIALECT_LABELS: Record<SqlDialect, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  oracle: "Oracle",
  sqlite: "SQLite",
  standard: "標準SQL",
};

/** FkAction (lowerCamelCase) → DDL 出力 (UPPER スペース含み) への変換 */
const FK_ACTION_DDL: Record<FkAction, string> = {
  cascade: "CASCADE",
  setNull: "SET NULL",
  setDefault: "SET DEFAULT",
  restrict: "RESTRICT",
  noAction: "NO ACTION",
};

/** Column.id (LocalId) を physicalName に解決。見つからなければ id 文字列をそのまま返す。 */
function resolveColumnPhysical(table: Table, columnId: string): string {
  return table.columns.find((c) => c.id === columnId)?.physicalName ?? columnId;
}

/** TableId (UUID) を allTables から検索し、Table を返す。 */
function findTable(allTables: Table[], tableId: string): Table | undefined {
  return allTables.find((t) => t.id === tableId);
}

/**
 * テーブル 1 件の DDL を生成。
 * @param table 対象テーブル
 * @param dialect SQL ダイアレクト
 * @param allTables FK 参照解決用の全テーブル一覧 (referencedTableId UUID から物理名を逆引きするのに使う)
 */
export function generateDdl(table: Table, dialect: SqlDialect, allTables: Table[] = []): string {
  const physical = table.physicalName;
  const colDefs: string[] = [];
  const pks: string[] = [];

  for (const col of table.columns) {
    const typeStr = col.autoIncrement
      ? autoIncrementType(col.dataType, dialect)
      : mapDataType(col.dataType, col.length, col.scale, dialect);

    let line = `  ${col.physicalName} ${typeStr}`;
    if (col.notNull) line += " NOT NULL";
    if (col.unique && !col.primaryKey) line += " UNIQUE";
    if (col.defaultValue && !col.autoIncrement) {
      line += ` DEFAULT ${col.defaultValue}`;
    }
    if (col.comment && dialect === "mysql") {
      line += ` COMMENT '${col.comment.replace(/'/g, "''")}'`;
    }
    colDefs.push(line);
    if (col.primaryKey) pks.push(col.physicalName);
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
      ddl += `\n\nCOMMENT ON TABLE ${physical} IS '${tableComment.replace(/'/g, "''")}';`;
    }
    for (const col of table.columns) {
      const cmt = col.comment || col.name; // col.name は v3 では DisplayName (表示名)
      if (cmt) {
        ddl += `\nCOMMENT ON COLUMN ${physical}.${col.physicalName} IS '${cmt.replace(/'/g, "''")}';`;
      }
    }
  }

  return ddl;
}

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

// ── 内部ヘルパー ────────────────────────────────────────────────────────────

function mapDataType(dt: string, length?: number, scale?: number, dialect?: SqlDialect): string {
  const d = dialect ?? "standard";
  switch (dt) {
    case "VARCHAR": return `VARCHAR(${length ?? 255})`;
    case "CHAR": return `CHAR(${length ?? 1})`;
    case "TEXT": return d === "oracle" ? "CLOB" : "TEXT";
    case "INTEGER": return d === "oracle" ? "NUMBER(10)" : "INTEGER";
    case "BIGINT": return d === "oracle" ? "NUMBER(19)" : "BIGINT";
    case "SMALLINT": return d === "oracle" ? "NUMBER(5)" : "SMALLINT";
    case "DECIMAL": return `DECIMAL(${length ?? 10}, ${scale ?? 2})`;
    case "FLOAT": return d === "oracle" ? "BINARY_FLOAT" : "FLOAT";
    case "BOOLEAN":
      if (d === "oracle") return "NUMBER(1)";
      if (d === "mysql") return "TINYINT(1)";
      return "BOOLEAN";
    case "DATE": return "DATE";
    case "TIME": return d === "oracle" ? "DATE" : "TIME";
    case "TIMESTAMP":
      if (d === "mysql") return "DATETIME";
      return "TIMESTAMP";
    case "BLOB": return "BLOB";
    case "JSON":
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

function indexToDdl(table: Table, idx: Index, dialect: SqlDialect): string {
  const physical = table.physicalName;
  const colList = idx.columns.map((ic) => {
    const phys = resolveColumnPhysical(table, ic.columnId);
    const ord = ic.order === "desc" ? " DESC" : "";
    return `${phys}${ord}`;
  }).join(", ");
  const uniq = idx.unique ? "UNIQUE " : "";
  const method = idx.method && idx.method !== "btree" && dialect === "postgresql"
    ? ` USING ${idx.method.toUpperCase()}`
    : "";
  let stmt = `CREATE ${uniq}INDEX ${idx.physicalName} ON ${physical}${method} (${colList})`;
  if (idx.where) stmt += `\n  WHERE ${idx.where}`;
  return stmt + ";";
}

function constraintToDdl(
  table: Table,
  c: Constraint,
  _dialect: SqlDialect,
  allTables: Table[],
): string {
  const physical = table.physicalName;
  const constraintName = c.physicalName ?? c.id;
  switch (c.kind) {
    case "unique": {
      const cols = c.columnIds.map((id) => resolveColumnPhysical(table, id));
      return `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName} UNIQUE (${cols.join(", ")});`;
    }
    case "check":
      return `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName} CHECK (${c.expression});`;
    case "foreignKey":
      return foreignKeyToDdl(table, c, allTables, constraintName);
  }
}

function foreignKeyToDdl(
  table: Table,
  fk: ForeignKeyConstraint,
  allTables: Table[],
  constraintName: string,
): string {
  const physical = table.physicalName;
  const ownCols = fk.columnIds.map((id) => resolveColumnPhysical(table, id));
  const refTable = findTable(allTables, fk.referencedTableId);
  const refTableName = refTable?.physicalName ?? `<unknown:${String(fk.referencedTableId).slice(0, 8)}>`;
  const refCols = fk.referencedColumnIds.map((id) =>
    refTable ? resolveColumnPhysical(refTable, id) : id,
  );
  let s = `ALTER TABLE ${physical} ADD CONSTRAINT ${constraintName}\n  FOREIGN KEY (${ownCols.join(", ")}) REFERENCES ${refTableName}(${refCols.join(", ")})`;
  if (fk.onDelete) s += `\n  ON DELETE ${FK_ACTION_DDL[fk.onDelete]}`;
  if (fk.onUpdate) s += `\n  ON UPDATE ${FK_ACTION_DDL[fk.onUpdate]}`;
  return s + ";";
}

function defaultToDdl(table: Table, def: DefaultDefinition, dialect: SqlDialect): string {
  const physical = table.physicalName;
  const colName = resolveColumnPhysical(table, def.columnId);
  let expr: string;
  switch (def.kind) {
    case "literal":
    case "function":
      expr = def.value;
      break;
    case "sequence":
      expr = dialect === "postgresql"
        ? `nextval('${def.value}')`
        : def.value;
      break;
    case "convention":
      expr = `NULL /* ${def.value} */`;
      break;
  }
  if (dialect === "oracle") {
    return `ALTER TABLE ${physical} MODIFY (${colName} DEFAULT ${expr});`;
  }
  return `ALTER TABLE ${physical} ALTER COLUMN ${colName} SET DEFAULT ${expr};`;
}

function triggerToDdl(table: Table, trg: TriggerDefinition, dialect: SqlDialect): string {
  const physical = table.physicalName;
  const events = trg.events.join(" OR ");
  const when = trg.whenCondition ? `\n  WHEN (${trg.whenCondition})` : "";
  // INSTEAD_OF はビュー用、テーブルでは通常使わないが schema 上は有効
  const timing = trg.timing === "INSTEAD_OF" ? "INSTEAD OF" : trg.timing;
  if (dialect === "postgresql") {
    const fnName = `${trg.physicalName}_fn`;
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
      `CREATE TRIGGER ${trg.physicalName}`,
      `${timing} ${events} ON ${physical}${when}`,
      `FOR EACH ROW EXECUTE FUNCTION ${fnName}();`,
    ].join("\n");
  }
  return [
    `CREATE TRIGGER ${trg.physicalName}`,
    `${timing} ${events} ON ${physical}${when}`,
    `FOR EACH ROW`,
    `BEGIN`,
    `  ${trg.body.split("\n").join("\n  ")}`,
    `END;`,
  ].join("\n");
}

function autoIncrementType(dt: string, dialect: SqlDialect): string {
  switch (dialect) {
    case "mysql": return `${mapDataType(dt, undefined, undefined, dialect)} AUTO_INCREMENT`;
    case "postgresql": return dt === "BIGINT" ? "BIGSERIAL" : "SERIAL";
    case "oracle": return `${mapDataType(dt, undefined, undefined, dialect)} GENERATED ALWAYS AS IDENTITY`;
    case "sqlite": return "INTEGER";
    default: return mapDataType(dt, undefined, undefined, dialect);
  }
}
