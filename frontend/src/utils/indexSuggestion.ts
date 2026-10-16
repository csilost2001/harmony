/**
 * インデックスの提案 (UI 改善提案 続編 第 8 弾 #154)。処理フローの DB アクセス (SQL の WHERE) と、外部キーの列から、
 * まだ索引の無い、検索・結合に使われる列の組を挙げる (画面に依存しない純関数)。
 * SQL は、WHERE の中の「列 = / IN / 範囲」を拾う簡易の読み取りで、候補を出すだけ (採用するかは、人が決める)。サブクエリ・別名つきの列は、対象のテーブルの別名のものだけ数える。
 */
import type { Column, ForeignKeyConstraint, Table } from "../types/v3";

export interface IndexSuggestion {
  /** 列の物理名 (等号の列が先、範囲の列が後) */
  columns: string[];
  reason: string;
  /** 根拠になった処理フロー・工程 */
  sources: string[];
}

interface FlowLike { meta: { id: string; name?: string }; actions: Array<{ steps?: unknown[] }> }
type StepLike = { id?: string; kind?: string; tableId?: string; operation?: string; sql?: string; description?: string; subSteps?: unknown[]; steps?: unknown[]; branches?: Array<{ steps?: unknown[] }>; elseBranch?: { steps?: unknown[] } };

function* walk(steps: readonly unknown[] | undefined): Generator<StepLike> {
  for (const raw of steps ?? []) {
    const s = raw as StepLike;
    yield s;
    for (const l of [s.subSteps, s.steps, ...((s.branches ?? []).map((b) => b.steps)), s.elseBranch?.steps]) if (Array.isArray(l)) yield* walk(l);
  }
}

/** SQL の中で、テーブル (名前または別名) を指す名前の集まり */
function aliasesOf(sql: string, physicalName: string): Set<string> {
  const names = new Set<string>([physicalName.toLowerCase()]);
  const re = new RegExp(`\\b(?:from|join|update|into)\\s+${physicalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?:\\s+(?:as\\s+)?([a-z_][\\w]*))?`, "gi");
  for (const m of sql.matchAll(re)) {
    const a = m[1]?.toLowerCase();
    if (a && !["where", "set", "join", "left", "right", "inner", "outer", "on", "group", "order", "limit", "values", "using", "cross", "full"].includes(a)) names.add(a);
  }
  return names;
}

const WHERE_END = /\b(group\s+by|order\s+by|limit|having|returning|union|offset)\b/i;

/** WHERE の中で使われている、テーブルの列 (等号 / IN の列と、範囲の列に分けて、出てきた順) */
export function whereColumns(sql: string, table: Pick<Table, "physicalName" | "columns">): { eq: string[]; range: string[] } {
  const own = new Set(table.columns.map((c) => String(c.physicalName).toLowerCase()));
  const aliases = aliasesOf(sql, String(table.physicalName));
  const eq: string[] = [];
  const range: string[] = [];
  for (const w of sql.matchAll(/\bwhere\b/gi)) {
    const rest = sql.slice((w.index ?? 0) + 5);
    const end = rest.search(WHERE_END);
    const clause = end >= 0 ? rest.slice(0, end) : rest;
    for (const m of clause.matchAll(/(?:\b([a-z_][\w]*)\.)?\b([a-z_][\w]*)\s*(=|<>|!=|<=|>=|<|>|\bin\b|\blike\b|\bbetween\b|\bis\b)/gi)) {
      const alias = m[1]?.toLowerCase();
      const col = m[2].toLowerCase();
      if (!own.has(col)) continue;
      if (alias && !aliases.has(alias)) continue; // 別名つきは、対象のテーブルの別名だけ
      const isEq = m[3] === "=" || /^in$/i.test(m[3]);
      const list = isEq ? eq : range;
      if (!eq.includes(col) && !range.includes(col)) list.push(col);
    }
  }
  return { eq, range };
}

/** 候補の列の組を、既存の索引・主キー・ユニークが先頭から覆っているか */
function covered(cols: readonly string[], table: Table): boolean {
  const byId = new Map(table.columns.map((c) => [c.id as string, String(c.physicalName).toLowerCase()]));
  const want = new Set(cols);
  const leads: string[][] = [];
  const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => String(c.physicalName).toLowerCase());
  if (pkCols.length) leads.push(pkCols);
  for (const c of table.columns) if (c.unique) leads.push([String(c.physicalName).toLowerCase()]);
  for (const k of table.constraints ?? []) {
    const x = k as { kind?: string; columnIds?: string[] };
    if ((x.kind === "primaryKey" || x.kind === "unique") && x.columnIds) leads.push(x.columnIds.map((id) => byId.get(id) ?? id));
  }
  for (const i of table.indexes ?? []) leads.push(i.columns.map((ic) => byId.get(ic.columnId as string) ?? String(ic.columnId)));
  return leads.some((l) => {
    if (l.length < want.size) return false;
    const head = l.slice(0, want.size);
    return head.every((c) => want.has(c));
  });
}

export function suggestIndexes(table: Table, flows: readonly FlowLike[]): IndexSuggestion[] {
  const out = new Map<string, IndexSuggestion>();
  const add = (cols: string[], reason: string, source: string) => {
    if (cols.length === 0 || covered(cols, table)) return;
    const key = cols.join(",");
    const cur = out.get(key);
    if (cur) { if (!cur.sources.includes(source)) cur.sources.push(source); return; }
    out.set(key, { columns: cols, reason, sources: [source] });
  };

  for (const f of flows) {
    for (const a of f.actions ?? []) {
      for (const s of walk(a.steps)) {
        if (s.kind !== "dbAccess" || s.tableId !== table.id || !s.sql) continue;
        const op = String(s.operation ?? "").toUpperCase();
        if (op === "INSERT") continue;
        const w = whereColumns(s.sql, table);
        const cols = [...w.eq, ...w.range].slice(0, 3);
        add(cols, `検索条件 (WHERE) に使われています`, `処理フロー「${f.meta.name ?? f.meta.id}」${s.description ? `: ${String(s.description).slice(0, 30)}` : ""}`);
      }
    }
  }
  const nameById = new Map(table.columns.map((c: Column) => [c.id as string, String(c.physicalName)]));
  for (const k of table.constraints ?? []) {
    const fk = k as ForeignKeyConstraint;
    if (fk.kind !== "foreignKey" || fk.noConstraint) continue;
    add(fk.columnIds.map((id) => nameById.get(id as string) ?? String(id)).map((n) => n.toLowerCase()), "外部キーの列です (親の表を引く・親から子を探すときに使われます)", "外部キー");
  }
  return [...out.values()].sort((a, b) => b.sources.length - a.sources.length || a.columns.join(",").localeCompare(b.columns.join(",")));
}
