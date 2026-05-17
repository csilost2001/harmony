/**
 * DDL 生成ヘルパー (#1144 Phase-1).
 *
 * 旧 index.ts に同居していた `generateDdl` / `mapDataType` / `autoIncrementType` を
 * 分離。`designer__generate_ddl` handler から利用される。
 *
 * 純粋関数のみで構成、副作用なし (ファイル IO は handler 側)。
 */

/** テーブル定義から DDL 文字列を生成する (dialect 別)。 */
export function generateDdl(table: Record<string, unknown>, dialect: string): string {
  const name = table.name as string;
  const columns = (table.columns ?? []) as Array<Record<string, unknown>>;
  const indexes = (table.indexes ?? []) as Array<Record<string, unknown>>;

  const colDefs: string[] = [];
  const pks: string[] = [];

  for (const col of columns) {
    let typeStr = mapDataType(col.dataType as string, col.length as number | undefined, col.scale as number | undefined, dialect);
    if (col.autoIncrement) typeStr = autoIncrementType(col.dataType as string, dialect);

    let line = `  ${col.name} ${typeStr}`;
    if (col.notNull) line += " NOT NULL";
    if (col.unique) line += " UNIQUE";
    if (col.defaultValue && !col.autoIncrement) {
      line += ` DEFAULT ${col.defaultValue}`;
    }
    if (col.comment && (dialect === "mysql" || dialect === "postgresql")) {
      // MySQL supports inline COMMENT, others need separate statements
      if (dialect === "mysql") line += ` COMMENT '${(col.comment as string).replace(/'/g, "''")}'`;
    }
    colDefs.push(line);
    if (col.primaryKey) pks.push(col.name as string);
  }

  if (pks.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pks.join(", ")})`);
  }

  // Foreign keys (物理FK制約のみ出力、noConstraint=true は除外)
  for (const col of columns) {
    if (col.foreignKey) {
      const fk = col.foreignKey as { tableId: string; columnName: string; noConstraint?: boolean };
      if (fk.noConstraint) continue;
      colDefs.push(`  FOREIGN KEY (${col.name}) REFERENCES ${fk.columnName ? fk.tableId + "(" + fk.columnName + ")" : fk.tableId}`);
    }
  }

  let ddl = `CREATE TABLE ${name} (\n${colDefs.join(",\n")}\n)`;

  if (dialect === "mysql") ddl += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
  ddl += ";";

  // Indexes (新形式 IndexDefinition + 旧形式 TableIndex 両対応)
  for (const idx of indexes) {
    const rawCols = (idx.columns ?? []) as Array<string | { name?: string; order?: string }>;
    const colNames = rawCols.map((c) => {
      if (typeof c === "string") {
        // 旧形式: 列 ID → 列名に解決
        const col = columns.find((cc) => cc.id === c);
        return col ? col.name as string : c;
      }
      // 新形式: IndexColumn { name, order? }
      const colName = (c as { name?: string }).name ?? "";
      const ord = (c as { order?: string }).order === "desc" ? " DESC" : "";
      return `${colName}${ord}`;
    });
    const unique = idx.unique ? "UNIQUE " : "";
    const idxName = ((idx.id ?? idx.name) as string | undefined) ?? "";
    ddl += `\n\nCREATE ${unique}INDEX ${idxName} ON ${name} (${colNames.join(", ")});`;
  }

  // Constraints (β-2)
  for (const c of (table.constraints ?? []) as Array<Record<string, unknown>>) {
    const kind = c.kind as string;
    const cid = c.id as string;
    const cols = (c.columns ?? []) as string[];
    if (kind === "unique") {
      ddl += `\n\nALTER TABLE ${name} ADD CONSTRAINT ${cid} UNIQUE (${cols.join(", ")});`;
    } else if (kind === "check") {
      ddl += `\n\nALTER TABLE ${name} ADD CONSTRAINT ${cid} CHECK (${c.expression});`;
    } else if (kind === "foreignKey") {
      const refTable = c.referencedTable as string;
      const refCols = (c.referencedColumns ?? []) as string[];
      let s = `ALTER TABLE ${name} ADD CONSTRAINT ${cid}\n  FOREIGN KEY (${cols.join(", ")}) REFERENCES ${refTable}(${refCols.join(", ")})`;
      if (c.onDelete) s += `\n  ON DELETE ${c.onDelete}`;
      if (c.onUpdate) s += `\n  ON UPDATE ${c.onUpdate}`;
      ddl += `\n\n${s};`;
    }
  }

  // DEFAULT values (β-4)
  for (const def of (table.defaults ?? []) as Array<Record<string, unknown>>) {
    const defCol = def.column as string;
    const defKind = def.kind as string;
    let expr: string;
    if (defKind === "sequence" && dialect === "postgresql") {
      expr = `nextval('${def.value}')`;
    } else if (defKind === "conventionRef") {
      expr = `NULL /* ${def.value} */`;
    } else {
      expr = def.value as string;
    }
    if (dialect === "oracle") {
      ddl += `\n\nALTER TABLE ${name} MODIFY (${defCol} DEFAULT ${expr});`;
    } else {
      ddl += `\n\nALTER TABLE ${name} ALTER COLUMN ${defCol} SET DEFAULT ${expr};`;
    }
  }

  // Triggers (β-4)
  for (const trg of (table.triggers ?? []) as Array<Record<string, unknown>>) {
    const trgId = trg.id as string;
    const timing = trg.timing as string;
    const events = ((trg.events ?? []) as string[]).join(" OR ");
    const trgWhen = trg.whenCondition ? `\n  WHEN (${trg.whenCondition})` : "";
    const body = trg.body as string;
    const trgEvents = (trg.events ?? []) as string[];
    if (dialect === "postgresql") {
      const fnName = `${trgId}_fn`;
      const returnStmt = trgEvents.length === 1 && trgEvents[0] === "DELETE" ? "RETURN OLD;" : "RETURN NEW;";
      ddl += "\n\n" + [
        `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS TRIGGER AS $$`,
        `BEGIN`,
        `  ${body.split("\n").join("\n  ")}`,
        `  ${returnStmt}`,
        `END;`,
        `$$ LANGUAGE plpgsql;`,
        ``,
        `CREATE TRIGGER ${trgId}`,
        `${timing} ${events} ON ${name}${trgWhen}`,
        `FOR EACH ROW EXECUTE FUNCTION ${fnName}();`,
      ].join("\n");
    } else {
      ddl += "\n\n" + [
        `CREATE TRIGGER ${trgId}`,
        `${timing} ${events} ON ${name}${trgWhen}`,
        `FOR EACH ROW`,
        `BEGIN`,
        `  ${body.split("\n").join("\n  ")}`,
        `END;`,
      ].join("\n");
    }
  }

  // PostgreSQL / Oracle comments
  if (dialect === "postgresql" || dialect === "oracle") {
    const logicalName = table.logicalName as string | undefined;
    if (logicalName) {
      ddl += `\n\nCOMMENT ON TABLE ${name} IS '${logicalName.replace(/'/g, "''")}';`;
    }
    for (const col of columns) {
      if (col.comment || col.logicalName) {
        const cmt = (col.comment || col.logicalName) as string;
        ddl += `\nCOMMENT ON COLUMN ${name}.${col.name} IS '${cmt.replace(/'/g, "''")}';`;
      }
    }
  }

  return ddl;
}

export function mapDataType(dt: string, length?: number, scale?: number, dialect?: string): string {
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
    case "BOOLEAN": {
      if (d === "oracle") return "NUMBER(1)";
      if (d === "mysql") return "TINYINT(1)";
      return "BOOLEAN";
    }
    case "DATE": return "DATE";
    case "TIME": return d === "oracle" ? "DATE" : "TIME";
    case "TIMESTAMP": {
      if (d === "oracle") return "TIMESTAMP";
      if (d === "mysql") return "DATETIME";
      return "TIMESTAMP";
    }
    case "BLOB": return d === "oracle" ? "BLOB" : "BLOB";
    case "JSON": {
      if (d === "oracle") return "CLOB";
      if (d === "mysql") return "JSON";
      if (d === "postgresql") return "JSONB";
      return "TEXT";
    }
    default: return dt;
  }
}

export function autoIncrementType(dt: string, dialect: string): string {
  switch (dialect) {
    case "mysql": return `${mapDataType(dt, undefined, undefined, dialect)} AUTO_INCREMENT`;
    case "postgresql": return dt === "BIGINT" ? "BIGSERIAL" : "SERIAL";
    case "oracle": return `${mapDataType(dt, undefined, undefined, dialect)} GENERATED ALWAYS AS IDENTITY`;
    case "sqlite": return "INTEGER"; // SQLite auto-increments INTEGER PRIMARY KEY
    default: return mapDataType(dt, undefined, undefined, dialect);
  }
}
