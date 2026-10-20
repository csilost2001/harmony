/**
 * SQL の一覧と、重複の検出。処理フローの DB アクセス工程に書かれた SQL を、1 か所にまとめて読めるようにする (DBA・レビュー用)。
 * 同じ SQL (差し込む変数の違いと空白・大文字小文字の違いを除く) が何度も出るときは、共通処理にまとめられないかの目安として知らせる。
 * 設計は書き換えない。仕様: docs/spec/design-analysis.md
 */
import type { DesignDocInput } from "../designDocument.js";
import type { FlowStep } from "../flowStructure.js";
import { toCsv } from "./common.js";

export interface SqlEntry {
  flow: { id: string; name: string };
  action: { id: string; name: string };
  stepId: string;
  /** 工程の説明 (無ければ空) */
  description: string;
  table: { id: string; name: string } | null;
  operation: string;
  sql: string;
  /** 結果を入れる変数の名前 (無ければ空) */
  binding: string;
}

export interface DuplicateSql {
  /** 比べるための形 (@変数 を ? に、空白をそろえ、小文字にしたもの) */
  normalized: string;
  /** 代表の SQL (最初に出たもの) */
  sql: string;
  entries: SqlEntry[];
  /** 出どころが、複数の処理フローにまたがるか */
  crossFlow: boolean;
}

/** これより短い SQL は、重複とは数えない (SELECT 1 のような、短い定型は、まとめる価値が薄い) */
export const DUPLICATE_SQL_MIN_LENGTH = 40;

/**
 * 比較用の形: 文字列の中身を ? に、コメントを空白に (1 回の走査で。コメントの中の `'` を文字列の始まりと取り違えない)、
 * `@x.y` `:x` `$1` を ? に (PostgreSQL のキャスト `::int` は残す)、空白をそろえ、小文字にする
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'|\/\*[\s\S]*?\*\/|--[^\n]*/g, (m) => (m.startsWith("'") ? "?" : " "))
    .replace(/@[A-Za-z_][\w.[\]]*|(?<!:):[A-Za-z_]\w*|\$\d+/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function* childLists(step: FlowStep): Generator<FlowStep[]> {
  const s = step as Record<string, unknown>;
  for (const k of ["steps", "subSteps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout"]) if (Array.isArray(s[k])) yield s[k] as FlowStep[];
  if (Array.isArray(s.branches)) for (const b of s.branches as Array<{ steps?: FlowStep[] }>) if (Array.isArray(b?.steps)) yield b.steps;
  const eb = s.elseBranch as { steps?: FlowStep[] } | undefined;
  if (eb && Array.isArray(eb.steps)) yield eb.steps;
  const ib = s.inlineBranch as { ok?: FlowStep[]; ng?: FlowStep[] } | undefined;
  if (ib) for (const l of [ib.ok, ib.ng]) if (Array.isArray(l)) yield l;
}

function* walk(steps: readonly FlowStep[] | undefined): Generator<FlowStep> {
  for (const s of steps ?? []) {
    yield s;
    for (const l of childLists(s)) yield* walk(l);
  }
}

/** すべての処理フローの、SQL つきの DB アクセス工程 */
export function deriveSqlCatalog(input: DesignDocInput): SqlEntry[] {
  const tableOf = new Map((input.tables ?? []).map((t) => [t.id, { id: t.id, name: t.name ?? t.physicalName ?? t.id }] as const));
  const out: SqlEntry[] = [];
  for (const f of input.flows) {
    for (const [i, a] of f.actions.entries()) {
      for (const s of walk(a.steps)) {
        const x = s as Record<string, unknown>;
        if (s.kind !== "dbAccess" || typeof x.sql !== "string" || !x.sql.trim()) continue;
        const tid = typeof x.tableId === "string" ? x.tableId : "";
        out.push({
          flow: { id: f.meta.id, name: f.meta.name ?? f.meta.id },
          action: { id: a.id ?? String(i), name: a.name ?? a.id ?? `アクション ${i + 1}` },
          stepId: s.id,
          description: typeof s.description === "string" ? s.description : "",
          table: tid ? tableOf.get(tid) ?? { id: tid, name: tid } : null,
          operation: typeof x.operation === "string" ? x.operation : "",
          sql: x.sql,
          binding: typeof (x.outputBinding as { name?: unknown } | undefined)?.name === "string" ? String((x.outputBinding as { name: string }).name) : "",
        });
      }
    }
  }
  return out;
}

/** 同じ SQL が 2 回以上出るもの (多い順) */
export function findDuplicateSql(entries: readonly SqlEntry[]): DuplicateSql[] {
  const groups = new Map<string, SqlEntry[]>();
  for (const e of entries) {
    const n = normalizeSql(e.sql);
    if (n.length < DUPLICATE_SQL_MIN_LENGTH) continue;
    (groups.get(n) ?? groups.set(n, []).get(n)!).push(e);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([normalized, list]) => ({ normalized, sql: list[0].sql, entries: list, crossFlow: new Set(list.map((e) => e.flow.id)).size > 1 }))
    .sort((a, b) => b.entries.length - a.entries.length || a.normalized.localeCompare(b.normalized));
}

/** SQL の一覧の CSV。重複している SQL には、同じ SQL が何件あるかを添える */
export function sqlCatalogToCsv(entries: readonly SqlEntry[]): string {
  const dupCount = new Map<string, number>();
  for (const d of findDuplicateSql(entries)) dupCount.set(d.normalized, d.entries.length);
  return toCsv(
    ["処理フロー", "アクション", "工程 ID", "説明", "テーブル", "操作", "結果の変数", "同じ SQL の件数", "SQL"],
    entries.map((e) => [e.flow.name, e.action.name, e.stepId, e.description, e.table?.name ?? "", e.operation, e.binding, dupCount.get(normalizeSql(e.sql)) ?? 1, e.sql]),
  );
}
