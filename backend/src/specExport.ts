/**
 * export_spec ハンドラ用テーブル変換ユーティリティ。
 * index.ts の MCP ハンドラから切り出し、単体テスト可能にする。
 */

export function mcpTableToSpecEntry(t: Record<string, unknown>): Record<string, unknown> {
  const cols = (t.columns ?? []) as Array<Record<string, unknown>>;
  return {
    name: t.name,
    logicalName: t.logicalName,
    description: t.description,
    category: t.category,
    columns: cols.map((c) => {
      const col: Record<string, unknown> = {
        name: c.name, logicalName: c.logicalName, dataType: c.dataType,
        ...(c.length != null ? { length: c.length } : {}),
        ...(c.scale != null ? { scale: c.scale } : {}),
        notNull: c.notNull, primaryKey: c.primaryKey, unique: c.unique,
        ...(c.autoIncrement ? { autoIncrement: true } : {}),
        ...(c.defaultValue ? { defaultValue: c.defaultValue } : {}),
        ...(c.comment ? { comment: c.comment } : {}),
      };
      if (c.foreignKey) {
        const fk = c.foreignKey as { tableId: string; columnName: string; noConstraint?: boolean };
        col.reference = { table: fk.tableId, column: fk.columnName, type: fk.noConstraint ? "logical" : "physical" };
      }
      return col;
    }),
    indexes: ((t.indexes ?? []) as Array<Record<string, unknown>>).map((idx) => {
      const rawCols = (idx.columns ?? []) as Array<string | { name?: string; order?: string }>;
      const colNames = rawCols.map((c) => {
        if (typeof c === "string") {
          const col = cols.find((cc) => cc.id === c);
          return col ? col.name : c;
        }
        return (c as { name?: string }).name ?? "";
      });
      return {
        name: (idx.id ?? idx.name) as string,
        columns: colNames,
        unique: idx.unique,
      };
    }),
    ...((t.constraints as unknown[])?.length ? { constraints: t.constraints } : {}),
    ...((t.defaults as unknown[])?.length ? { defaults: t.defaults } : {}),
    ...((t.triggers as unknown[])?.length ? { triggers: t.triggers } : {}),
  };
}
