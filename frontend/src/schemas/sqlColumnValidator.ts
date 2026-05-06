/**
 * DbAccessStep.sql 内の列名がテーブル定義に存在するかを検証 (#261 残)。
 *
 * 流れ:
 *  1. @expression を `?` placeholder に置換 (node-sql-parser が @ 記法を受け付けないため)
 *  2. PostgreSQL dialect でパース
 *  3. 使用されている列 (SELECT columns, INSERT columns, UPDATE SET, WHERE の左辺 etc.) を抽出
 *  4. alias 解決 → tableId → 列名の集合と突合
 *
 * node-sql-parser v5 ベース。複雑な CTE / window / サブクエリは best-effort。
 */
import { Parser } from "node-sql-parser";
import type { ProcessFlow, DbAccessStep, Step } from "../types/v3";
import { isBuiltinStep } from "./stepGuards";

/** テーブル定義 (最小シェイプ、examples/<project-id>/tables/*.json 形式) */
export interface TableDefinition {
  id: string;
  name: string;
  columns: Array<{ name: string }>;
}

export interface SqlColumnIssue {
  path: string;
  code:
    | "SQL_PARSE_ERROR"
    | "UNKNOWN_TABLE"
    | "UNKNOWN_COLUMN";
  value: string;
  message: string;
}

const parser = new Parser();
const DIALECT = "postgresql" as const;

/** @xxx / @x.y.z を $N プレースホルダに置換 (PostgreSQL dialect) */
function substituteAtVars(sql: string): string {
  let n = 0;
  return sql.replace(/@[a-zA-Z_][\w.?]*/g, () => `$${++n}`);
}

interface TableSpec {
  name: string;        // SQL 上の名前 (lowercase)
  columns: Set<string>; // 列名 (lowercase)
}

/**
 * AST ノードから使用列を収集 (ベストエフォート)。
 * node-sql-parser v5 の AST は dialect 毎に微妙に違うので widen。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectColumnRefs(node: any, out: Array<{ table: string | null; column: string }>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectColumnRefs(item, out);
    return;
  }
  // column_ref: SELECT / UPDATE SET / WHERE で登場
  if (node.type === "column_ref" && node.column) {
    let col: string | null = null;
    if (typeof node.column === "string") col = node.column;
    else if (node.column?.expr?.value) col = String(node.column.expr.value);
    if (col) {
      out.push({ table: node.table ?? null, column: col });
    }
  }
  // INSERT の columns[] は top-level AST.columns にあり、要素は
  // { type: "default", value: "col_name" }。ここでだけ拾う (他文脈の default は無視)
  if (node.type === "insert" && Array.isArray(node.columns)) {
    for (const c of node.columns) {
      if (c?.type === "default" && typeof c.value === "string") {
        out.push({ table: null, column: c.value });
      } else if (typeof c === "string") {
        out.push({ table: null, column: c });
      }
    }
  }
  for (const key of Object.keys(node)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collectColumnRefs((node as any)[key], out);
  }
}

interface TableUsage {
  name: string;       // 実テーブル名 (lowercase)
  alias: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectTableUsages(node: any, out: TableUsage[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectTableUsages(item, out);
    return;
  }
  // from / join entry
  if (node.table && typeof node.table === "string") {
    out.push({
      name: node.table.toLowerCase(),
      alias: node.as ?? null,
    });
  }
  // INSERT / UPDATE top-level table
  if (node.type === "insert" && Array.isArray(node.table)) {
    for (const t of node.table) {
      if (t.table) out.push({ name: String(t.table).toLowerCase(), alias: t.as ?? null });
    }
  }
  for (const key of Object.keys(node)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collectTableUsages((node as any)[key], out);
  }
}

/**
 * 1 SQL 文を検証。tableDefsByName は SQL 中のテーブル名 (lowercase) → TableSpec の map。
 */
export function validateSql(
  sql: string,
  tableDefsByName: Map<string, TableSpec>,
  path: string,
): SqlColumnIssue[] {
  const issues: SqlColumnIssue[] = [];
  const substituted = substituteAtVars(sql);
  let ast: unknown;
  try {
    ast = parser.astify(substituted, { database: DIALECT });
  } catch (e) {
    issues.push({
      path,
      code: "SQL_PARSE_ERROR",
      value: (e as Error).message.slice(0, 200),
      message: `SQL パース失敗: ${(e as Error).message.slice(0, 100)}`,
    });
    return issues;
  }

  const tableUsages: TableUsage[] = [];
  collectTableUsages(ast, tableUsages);

  // alias → real table name のマップ
  const aliasToName = new Map<string, string>();
  for (const u of tableUsages) {
    if (u.alias) aliasToName.set(u.alias.toLowerCase(), u.name);
  }

  // 存在しないテーブル名を検出
  for (const u of tableUsages) {
    if (!tableDefsByName.has(u.name)) {
      // tableDefsByName に無ければ「このスキーマ検証対象外」として skip (CTE 等)
      continue;
    }
  }

  const colRefs: Array<{ table: string | null; column: string }> = [];
  collectColumnRefs(ast, colRefs);

  for (const ref of colRefs) {
    const col = ref.column.toLowerCase();
    // 特殊カラム (SUBSTRING 等のプレースホルダ / COUNT(*) 相当)
    if (col === "*" || col === "?" || col.startsWith("?")) continue;

    let candidateTables: string[];
    if (ref.table) {
      const tKey = ref.table.toLowerCase();
      const resolved = aliasToName.get(tKey) ?? tKey;
      candidateTables = [resolved];
    } else {
      // 修飾なしの列 → 全 usage のテーブルで候補探索
      candidateTables = tableUsages.map((u) => u.name);
    }

    // 候補テーブルのどれかに存在すれば OK
    const found = candidateTables.some((tName) => {
      const spec = tableDefsByName.get(tName);
      return spec?.columns.has(col);
    });

    if (!found) {
      // tableDefsByName に存在するテーブルについてのみ issue 化
      // (カタログに無いテーブルの列は検証対象外)
      const hasKnownTable = candidateTables.some((t) => tableDefsByName.has(t));
      if (hasKnownTable) {
        issues.push({
          path,
          code: "UNKNOWN_COLUMN",
          value: ref.table ? `${ref.table}.${ref.column}` : ref.column,
          message: `列 "${ref.table ? `${ref.table}.${ref.column}` : ref.column}" が該当テーブル定義に存在しません`,
        });
      }
    }
  }

  return issues;
}

/** ProcessFlow 内の全 DbAccessStep.sql を検証 */
export function checkSqlColumns(
  group: ProcessFlow,
  tables: TableDefinition[],
): SqlColumnIssue[] {
  const issues: SqlColumnIssue[] = [];
  const defsByName = new Map<string, TableSpec>();
  for (const t of tables) {
    defsByName.set(t.name.toLowerCase(), {
      name: t.name.toLowerCase(),
      columns: new Set(t.columns.map((c) => c.name.toLowerCase())),
    });
  }

  group.actions.forEach((action, ai) => {
    walkSteps(action.steps ?? [], `actions[${ai}].steps`, (step, path) => {
      if (isBuiltinStep(step) && step.kind === "dbAccess" && step.sql) {
        issues.push(...validateSql(step.sql, defsByName, `${path}.sql`));
      }
    });
  });

  return issues;
}

function walkSteps(steps: Step[], basePath: string, visit: (s: Step, p: string) => void): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    visit(step, path);
    // 拡張 step は nested 走査スキップ (固有プロパティは config 内に閉じる仕様)
    if (!isBuiltinStep(step)) return;
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) => walkSteps(b.steps, `${path}.branches[${bi}].steps`, visit));
      if (step.elseBranch) walkSteps(step.elseBranch.steps, `${path}.elseBranch.steps`, visit);
    }
    if (step.kind === "loop") walkSteps(step.steps, `${path}.steps`, visit);
    if (step.kind === "transactionScope") {
      walkSteps(step.steps, `${path}.steps`, visit);
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, visit);
      if (step.onRollback) walkSteps(step.onRollback, `${path}.onRollback`, visit);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) walkSteps(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, visit);
      });
    }
  });
}

/** 型エクスポート用のシーム (外部で DbAccessStep 直接触らせないため) */
export type { DbAccessStep };
