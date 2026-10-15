/**
 * SQL の表名・カラム名の補完 Resolver。
 *
 *   FROM / JOIN / INTO / UPDATE の後  → テーブルの物理名
 *   表名. または 別名. の後            → そのテーブルのカラム (物理名)
 *   それ以外の単語 (2 文字以上)        → FROM / JOIN に出てくるテーブルのカラム
 *
 * @ で始まる参照 (@inputs.x など) は、他の補完に任せる。テーブル定義は ctx.workspace.tables から読む。
 */
import { looseMatch } from "../textMatch";
import type { Candidate, CompletionContext, CompletionState, Resolver, WorkspaceRefs } from "./types";

type TableRef = WorkspaceRefs["tables"][number];

const RESERVED_AFTER_TABLE = new Set([
  "where", "on", "set", "inner", "left", "right", "full", "cross", "natural", "join", "group", "order",
  "limit", "values", "using", "union", "having", "returning", "select", "as", "offset", "for", "outer",
]);

/** 文中の FROM / JOIN / UPDATE / INTO に出てくる表と別名を集める (別名 → テーブル、物理名 → テーブル)。 */
export function collectSqlTables(sql: string, tables: TableRef[]): Map<string, TableRef> {
  const byName = new Map<string, TableRef>();
  for (const t of tables) if (t.physicalName) byName.set(t.physicalName.toLowerCase(), t);
  const used = new Map<string, TableRef>();
  const re = /\b(?:from|join|update|into)\s+([A-Za-z_]\w*)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const table = byName.get(m[1].toLowerCase());
    if (!table) continue;
    used.set(m[1].toLowerCase(), table);
    const alias = m[2];
    if (alias && !RESERVED_AFTER_TABLE.has(alias.toLowerCase())) used.set(alias.toLowerCase(), table);
  }
  return used;
}

function columnCandidates(table: TableRef): Candidate[] {
  return (table.columns ?? []).map((c) => {
    const type = c.dataType ? `${c.dataType}${c.length ? `(${c.length})` : ""}` : "";
    return {
      value: c.physicalName,
      label: c.physicalName,
      hint: c.name,
      detail: `${table.physicalName}.${c.physicalName} ・ ${c.name}${type ? ` ・ ${type}` : ""}${c.primaryKey ? " ・ 主キー" : ""}${c.notNull ? " ・ NOT NULL" : ""}`,
    };
  });
}

function active(prefix: string, candidates: Candidate[]): CompletionState | null {
  if (candidates.length === 0) return null;
  return { phase: "active", resolverId: "sqlSchema", prefix, candidates, replaceLen: prefix.length };
}

export const sqlSchemaResolver: Resolver = {
  id: "sqlSchema",
  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const tables = ctx.workspace?.tables ?? [];
    if (tables.length === 0) return null;
    const before = value.slice(0, cursorPos);

    // 1) 表名. / 別名. の後 → カラム
    const dotted = before.match(/(?<![@\w.])([A-Za-z_]\w*)\.(\w*)$/);
    if (dotted) {
      const used = collectSqlTables(value, tables);
      const table = used.get(dotted[1].toLowerCase()) ?? tables.find((t) => t.physicalName.toLowerCase() === dotted[1].toLowerCase());
      if (!table) return null;
      const prefix = dotted[2];
      return active(prefix, columnCandidates(table).filter((c) => looseMatch(c.value, prefix)));
    }

    // 2) FROM / JOIN / INTO / UPDATE の直後 → テーブル
    const afterKeyword = before.match(/\b(?:from|join|into|update)\s+([\w\p{L}]*)$/iu);
    if (afterKeyword) {
      const prefix = afterKeyword[1];
      const candidates: Candidate[] = tables
        .filter((t) => t.physicalName && (looseMatch(t.physicalName, prefix) || looseMatch(t.name, prefix)))
        .map((t) => ({
          value: t.physicalName,
          label: t.physicalName,
          hint: t.name,
          detail: `テーブル ・ ${t.name} ・ カラム ${t.columns?.length ?? 0} 件`,
        }));
      return active(prefix, candidates);
    }

    // 3) 単語の途中 → FROM / JOIN に出てくるテーブルのカラム (2 文字以上、参照 @ ・ 数値は除く)
    const word = before.match(/(?<![@\w.'"])([A-Za-z_]\w+)$/);
    if (word && word[1].length >= 2) {
      const used = new Set(collectSqlTables(value, tables).values());
      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const table of used) {
        for (const c of columnCandidates(table)) {
          if (seen.has(c.value)) continue;
          if (c.value.toLowerCase() === word[1].toLowerCase()) continue;
          if (looseMatch(c.value, word[1])) {
            seen.add(c.value);
            candidates.push(c);
          }
        }
      }
      return active(word[1], candidates);
    }
    return null;
  },
};
