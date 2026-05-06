/**
 * DB 制約 × フロー操作順序の交差検査 (#632 MVP: 観点 1+2、#640 観点 3、#641 観点 4)。
 *
 * 観点 1 (NULL_NOT_ALLOWED_AT_INSERT):
 *   INSERT 時点で NOT NULL カラムに対応する変数が未バインド
 *   (= outputBinding に記録されていない変数名を VALUES に使っている)
 *
 * 観点 2 (FK_REFERENCE_NOT_INSERTED):
 *   INSERT 時点で FK 参照先テーブルへの先行 INSERT が同 action 内に無い
 *   (= FK 制約の参照整合を保証する先行書き込みが存在しない)
 *
 * 観点 3 (UNIQUE_CHECK_MISSING):
 *   INSERT 時点で UNIQUE 制約のあるカラムに対して事前の重複チェックがない
 *   (= 以下のいずれかが INSERT 直前に存在しない場合 warning)
 *   - SELECT WHERE <unique_col> = <value> + branch.condition で件数判定
 *   - INSERT step 自身の affectedRowsCheck.errorCode が UNIQUE_VIOLATION 系
 *   - INSERT を含む branch step の condition.kind: "tryCatch" で UNIQUE_VIOLATION error
 *
 * 観点 4 (CASCADE_DELETE_OMITTED):
 *   親テーブルへの DELETE step を検出した際に、子テーブル (referencedTableId が親を指す FK を持つ)
 *   の onDelete が restrict / noAction (または未指定) の場合、同 action 内の前段に
 *   子テーブルへの DELETE step が存在しなければ実行時 FK 制約違反。
 *   - onDelete = cascade / setNull / setDefault → DB 側が処理するため issue なし
 *   - onDelete = restrict / noAction (default) → 子 DELETE が前段になければ error
 *
 * 既存 sqlColumnValidator と同じ node-sql-parser v5 AST walker を再利用。
 * 変数バインド時系列追跡 + テーブル schema (notNull / foreignKey / unique) との交差解析
 * で実行時 DB 制約違反を構造的に検出する。
 *
 * 観点 5 (TX_CIRCULAR_DEPENDENCY) → #642
 */

import { Parser } from "node-sql-parser";
import type { ProcessFlow, LoopStep, Step, TransactionScopeStep } from "../types/v3";
import { isBuiltinStep } from "./stepGuards";

// ─── 入力型: テーブル定義 (v3 形式) ────────────────────────────────────────

/** カラム 1 件 (validator 内部で必要な最小フィールド)。 */
export interface OrderTableColumn {
  id: string;
  physicalName: string;
  notNull?: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
}

/** FK onDelete アクション (table.v3.schema.json の FkAction enum)。 */
export type FkAction = "cascade" | "setNull" | "setDefault" | "restrict" | "noAction";

/** FK 制約 (validator 内部で必要な最小フィールド)。 */
export interface OrderForeignKeyConstraint {
  kind: "foreignKey";
  columnIds: string[];
  referencedTableId: string;
  onDelete?: FkAction;
}

/** UNIQUE 制約 (validator 内部で必要な最小フィールド)。 */
export interface OrderUniqueConstraint {
  kind: "unique";
  columnIds: string[];
}

/** テーブル制約 (validator 内部では FK と UNIQUE を利用)。 */
export type OrderConstraint =
  | OrderUniqueConstraint
  | { kind: "check"; [key: string]: unknown }
  | OrderForeignKeyConstraint;

/** テーブル定義 (v3 table.v3.schema.json の最小シェイプ)。 */
export interface OrderTableDefinition {
  id: string;
  physicalName: string;
  columns: OrderTableColumn[];
  constraints?: OrderConstraint[];
}

// ─── 出力型: 検出 issue ─────────────────────────────────────────────────────

export interface SqlOrderIssue {
  path: string;
  code: "NULL_NOT_ALLOWED_AT_INSERT" | "FK_REFERENCE_NOT_INSERTED" | "UNIQUE_CHECK_MISSING" | "CASCADE_DELETE_OMITTED" | "TX_CIRCULAR_DEPENDENCY" | "SQL_PARSE_ERROR";
  severity?: "error" | "warning";
  message: string;
}

// ─── パーサー初期化 ─────────────────────────────────────────────────────────

const parser = new Parser();
const DIALECT = "postgresql" as const;

/** @xxx / @x.y.z を $N プレースホルダに置換 (sqlColumnValidator と同じ手法)。 */
function substituteAtVars(sql: string): string {
  let n = 0;
  return sql.replace(/@[a-zA-Z_][\w.?]*/g, () => `$${++n}`);
}

// ─── AST ヘルパー ───────────────────────────────────────────────────────────

/** INSERT AST から対象テーブル名を取得 (lowercase)。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractInsertTableName(ast: any): string | null {
  if (!ast || typeof ast !== "object") return null;
  if (ast.type === "insert" && Array.isArray(ast.table)) {
    for (const t of ast.table) {
      if (t.table && typeof t.table === "string") return t.table.toLowerCase();
    }
  }
  return null;
}

/**
 * DELETE AST から対象テーブル名を取得 (lowercase)。
 *
 * node-sql-parser v5 PostgreSQL dialect での DELETE AST 構造:
 *   - ast.from: Array<{ table: string, ... }>  (PostgreSQL DELETE FROM)
 *   - ast.table: Array<{ table: string, ... }>  (一部 dialect フォールバック)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDeleteTableName(ast: any): string | null {
  if (!ast || typeof ast !== "object") return null;
  if (ast.type === "delete") {
    // PostgreSQL: DELETE FROM table_name → ast.from
    if (Array.isArray(ast.from)) {
      for (const t of ast.from) {
        if (t.table && typeof t.table === "string") return t.table.toLowerCase();
      }
    }
    // フォールバック: ast.table
    if (Array.isArray(ast.table)) {
      for (const t of ast.table) {
        if (t.table && typeof t.table === "string") return t.table.toLowerCase();
      }
    }
  }
  return null;
}

/**
 * INSERT AST から (columnPhysicalName → varName | null) マップを抽出。
 *
 * node-sql-parser v5 PostgreSQL dialect での INSERT AST 構造:
 *   - ast.columns: Array<{ type: "default", value: string }> (列名リスト)
 *   - ast.values: { type: "values", values: Array<{ type: "expr_list", value: any[] }> }
 *   - 各 value 要素: { type: "var", name: number, prefix: "$", members: [] }  ← プレースホルダ
 *                 または { type: "null", value: null }  ← NULL リテラル
 *                 または { type: "number" | "string" | ... }  ← リテラル
 *
 * @atVarMap: プレースホルダ番号 (1, 2, ...) → 元の @varName のルート名のマップ
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractInsertColumnVarMap(ast: any, atVarMap: Map<number, string>): Map<string, string | null> {
  const result = new Map<string, string | null>();
  if (!ast || ast.type !== "insert") return result;

  // columns: Array<{ type: "default", value: string }> または string[] のどちらもサポート
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: string[] = Array.isArray(ast.columns) ? ast.columns.map((c: any) => {
    if (typeof c === "string") return c;
    if (c && typeof c.value === "string") return c.value;
    return String(c);
  }) : [];

  // values: { type: "values", values: Array<{ type: "expr_list", value: any[] }> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valuesContainer: any = ast.values;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let valueRows: any[][] = [];
  if (valuesContainer && Array.isArray(valuesContainer.values)) {
    // v5 形式: { type: "values", values: [...] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    valueRows = valuesContainer.values.map((row: any) => Array.isArray(row?.value) ? row.value : []);
  } else if (Array.isArray(valuesContainer)) {
    // フォールバック: 旧来の配列形式
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    valueRows = valuesContainer.map((row: any) => Array.isArray(row?.value) ? row.value : []);
  }

  if (columns.length === 0 || valueRows.length === 0) return result;

  // 最初の VALUES 行のみ検査 (バルク INSERT の 2 行目以降は同形とみなす)
  const firstRow = valueRows[0];
  for (let i = 0; i < columns.length; i++) {
    const colName = columns[i].toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valNode: any = firstRow[i];
    if (!valNode) {
      result.set(colName, null);
      continue;
    }
    // プレースホルダ: { type: "var", name: number, prefix: "$" }
    if (valNode.type === "var" && valNode.prefix === "$" && typeof valNode.name === "number") {
      const paramNum = valNode.name; // 1, 2, 3, ...
      const originalVar = atVarMap.get(paramNum) ?? null;
      result.set(colName, originalVar);
    } else if (valNode.type === "null" || valNode.value === null) {
      // NULL リテラル
      result.set(colName, null);
    } else {
      // リテラル値 (string / number / boolean) → 変数参照ではないため non-null とみなす
      result.set(colName, `__literal__`);
    }
  }
  return result;
}

/**
 * @xxx / @x.y.z → プレースホルダ番号 → 元変数名 の逆引きマップを構築。
 * substituteAtVars と同じ順序で置換するため、同じ regex を使用。
 */
function buildAtVarMap(sql: string): Map<number, string> {
  const map = new Map<number, string>();
  let n = 0;
  const re = /@[a-zA-Z_][\w.?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    n++;
    // @varName.field の場合はルート変数名部分を抽出 (例: @beneficiary.id → beneficiary)
    const fullRef = m[0].slice(1); // "varName.field"
    const rootName = fullRef.split(".")[0]; // "varName"
    map.set(n, rootName);
  }
  return map;
}

// ─── 変数バインド時系列追跡 ─────────────────────────────────────────────────

/**
 * step 列を順走査して、各 step が outputBinding で宣言する変数名を収集。
 * action.inputs[] はこの関数の外で先に追加しておく。
 *
 * @param steps   走査対象 step 列
 * @param visitor (step, path) → void コールバック (副作用あり)
 */
function walkStepsInOrder(
  steps: Step[],
  basePath: string,
  visitor: (step: Step, path: string) => void,
  loopHooks?: { onEnter: (loop: LoopStep) => void; onExit: (loop: LoopStep) => void },
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const path = `${basePath}[${i}]`;
    visitor(step, path);
    if (!isBuiltinStep(step)) continue;
    if (step.kind === "branch") {
      step.branches.forEach((b, bi) =>
        walkStepsInOrder(b.steps, `${path}.branches[${bi}].steps`, visitor, loopHooks),
      );
      if (step.elseBranch) walkStepsInOrder(step.elseBranch.steps, `${path}.elseBranch.steps`, visitor, loopHooks);
    }
    if (step.kind === "loop") {
      if (loopHooks) loopHooks.onEnter(step);
      walkStepsInOrder(step.steps, `${path}.steps`, visitor, loopHooks);
      if (loopHooks) loopHooks.onExit(step);
    }
    if (step.kind === "transactionScope") {
      walkStepsInOrder(step.steps, `${path}.steps`, visitor, loopHooks);
      if (step.onCommit) walkStepsInOrder(step.onCommit, `${path}.onCommit`, visitor, loopHooks);
      if (step.onRollback) walkStepsInOrder(step.onRollback, `${path}.onRollback`, visitor, loopHooks);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]) => {
        if (spec?.sideEffects) walkStepsInOrder(spec.sideEffects, `${path}.outcomes.${k}.sideEffects`, visitor, loopHooks);
      });
    }
    if (step.kind === "workflow") {
      if (step.onApproved) walkStepsInOrder(step.onApproved, `${path}.onApproved`, visitor, loopHooks);
      if (step.onRejected) walkStepsInOrder(step.onRejected, `${path}.onRejected`, visitor, loopHooks);
      if (step.onTimeout) walkStepsInOrder(step.onTimeout, `${path}.onTimeout`, visitor, loopHooks);
    }
    if (step.kind === "validation" && step.inlineBranch) {
      walkStepsInOrder(step.inlineBranch.ok, `${path}.inlineBranch.ok`, visitor, loopHooks);
      walkStepsInOrder(step.inlineBranch.ng, `${path}.inlineBranch.ng`, visitor, loopHooks);
    }
  }
}

// ─── テーブルメタデータ ─────────────────────────────────────────────────────

interface TableMeta {
  id: string;
  physicalName: string;
  notNullColumns: Set<string>;     // physicalName (lowercase) で保持
  autoColumns: Set<string>;        // autoIncrement || defaultValue 付き → NOT NULL でもバインド不要
  fkConstraints: Array<{
    columnPhysicalNames: string[]; // FK 本テーブル側カラム物理名 (lowercase)
    referencedTableId: string;
    onDelete?: FkAction;           // FK 違反時アクション (省略時は noAction 相当)
  }>;
  uniqueConstraints: Array<string[]>; // UNIQUE 制約ごとの physicalName (lowercase) 配列
  uniqueColumns: Set<string>;         // Column.unique: true のカラム (各カラム単体 UNIQUE)
}

/**
 * テーブルまたはカラムの物理名を取得。
 * v3 では physicalName、v1 フォールバックでは name を使用。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPhysicalName(obj: any): string | undefined {
  return (typeof obj?.physicalName === "string" && obj.physicalName)
    ? obj.physicalName
    : (typeof obj?.name === "string" ? obj.name : undefined);
}

function buildTableMeta(tables: OrderTableDefinition[]): Map<string, TableMeta> {
  const map = new Map<string, TableMeta>();
  for (const t of tables) {
    const tablePhysicalName = getPhysicalName(t);
    if (!tablePhysicalName) continue; // 物理名が取れないテーブルはスキップ

    const notNullColumns = new Set<string>();
    const autoColumns = new Set<string>();
    for (const col of t.columns) {
      const pName = getPhysicalName(col);
      if (!pName) continue;
      const pNameLower = pName.toLowerCase();
      if (col.notNull) notNullColumns.add(pNameLower);
      // autoIncrement または DB 側 DEFAULT がある列はバインド不要 (DB が値を埋める)
      if (col.autoIncrement || col.defaultValue !== undefined) autoColumns.add(pNameLower);
      // primaryKey は通常 autoIncrement と同義だが念のため除外
      if (col.primaryKey) autoColumns.add(pNameLower);
    }

    // FK 制約: Column.id → physicalName 逆引きマップ
    const colIdToPhysical = new Map<string, string>();
    for (const col of t.columns) {
      const pName = getPhysicalName(col);
      if (pName) colIdToPhysical.set(col.id, pName.toLowerCase());
    }

    const fkConstraints: TableMeta["fkConstraints"] = [];
    const uniqueConstraints: TableMeta["uniqueConstraints"] = [];
    const uniqueColumns = new Set<string>();

    for (const con of t.constraints ?? []) {
      if (con.kind === "foreignKey") {
        const fkCon = con as OrderForeignKeyConstraint;
        const columnPhysicalNames = fkCon.columnIds
          .map((id) => colIdToPhysical.get(id) ?? "")
          .filter(Boolean);
        if (columnPhysicalNames.length > 0) {
          fkConstraints.push({
            columnPhysicalNames,
            referencedTableId: fkCon.referencedTableId,
            onDelete: fkCon.onDelete,
          });
        }
      } else if (con.kind === "unique") {
        // UNIQUE 制約 (複合含む): columnIds → physicalName に変換
        const uqCon = con as OrderUniqueConstraint;
        const columnPhysicalNames = uqCon.columnIds
          .map((id) => colIdToPhysical.get(id) ?? "")
          .filter(Boolean);
        if (columnPhysicalNames.length > 0) {
          uniqueConstraints.push(columnPhysicalNames);
        }
      }
    }

    // Column.unique: true も単体 UNIQUE として収集
    for (const col of t.columns) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((col as any).unique === true) {
        const pName = getPhysicalName(col);
        if (pName) uniqueColumns.add(pName.toLowerCase());
      }
    }

    map.set(tablePhysicalName.toLowerCase(), {
      id: t.id,
      physicalName: tablePhysicalName.toLowerCase(),
      notNullColumns,
      autoColumns,
      fkConstraints,
      uniqueConstraints,
      uniqueColumns,
    });
  }
  return map;
}

// ─── 観点 3: UNIQUE_CHECK_MISSING ヘルパー ─────────────────────────────────

/**
 * UNIQUE_VIOLATION 系のエラーコード文字列かどうかを判定。
 * 主要な命名パターンを網羅する。
 */
function isUniqueViolationErrorCode(code: string | undefined): boolean {
  if (!code) return false;
  const upper = code.toUpperCase();
  return (
    upper.includes("UNIQUE") ||
    upper.includes("DUPLICATE") ||
    upper.includes("ALREADY_EXISTS") ||
    upper.includes("CONFLICT") ||
    upper.includes("DUPLICATE_KEY") ||
    upper.includes("DUPLICATE_ENTRY")
  );
}

/**
 * column_ref ノードからカラム名文字列を抽出する。
 *
 * node-sql-parser v5 PostgreSQL dialect では column が
 * - 文字列 (v4 以前) または
 * - { expr: { type: "default", value: "colName" } } オブジェクト (v5)
 * のどちらかになる。両方に対応する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractColumnName(node: any): string | null {
  if (!node || node.type !== "column_ref") return null;
  const col = node.column;
  if (typeof col === "string") return col.toLowerCase();
  if (col && typeof col === "object") {
    // v5 形式: { expr: { type: "default", value: "colName" } }
    if (col.expr && typeof col.expr.value === "string") return col.expr.value.toLowerCase();
    // フォールバック: value 直下
    if (typeof col.value === "string") return col.value.toLowerCase();
  }
  return null;
}

/**
 * SELECT SQL AST から WHERE 句で参照しているカラム物理名 (lowercase) を抽出する。
 * シンプルな `WHERE col = @var` 形式および `AND` / `OR` 連結を対象とする。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractWhereColumns(ast: any): Set<string> {
  const cols = new Set<string>();
  if (!ast || ast.type !== "select") return cols;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any): void {
    if (!node || typeof node !== "object") return;
    // binary expression: left/right
    if (node.type === "binary_expr") {
      const leftCol = extractColumnName(node.left);
      if (leftCol) cols.add(leftCol);
      const rightCol = extractColumnName(node.right);
      if (rightCol) cols.add(rightCol);
      walk(node.left);
      walk(node.right);
    }
    // WHERE 直下
    if (node.where) walk(node.where);
  }

  walk(ast);
  return cols;
}

/**
 * action 内の前段 step (INSERT step より前の index まで) を走査して、
 * 以下のいずれかが存在するか確認する (UNIQUE_CHECK_MISSING の false positive 抑止):
 *
 * パターン 1: SELECT WHERE <unique_col> = <value> が存在する
 *             (= SELECT で存在確認してから INSERT する正常フロー)
 *
 * walkStepsInOrder は INSERT 順に呼ばれるため、ここでは「これまでに見た SELECT step 列」を
 * 引数で受け取る。
 */
function hasPriorSelectForUniqueColumns(
  uniqueColPhysicalNames: string[], // UNIQUE 制約の全カラム物理名 (lowercase)
  priorSelectWhereColumns: Set<string>, // INSERT より前に見た SELECT の WHERE カラム集合
): boolean {
  // UNIQUE 制約のいずれかのカラムが SELECT WHERE に含まれていれば OK
  // (厳密には全カラムが含まれるべきだが、偽陽性抑止優先で any-match にする)
  return uniqueColPhysicalNames.some((col) => priorSelectWhereColumns.has(col));
}

/**
 * step の affectedRowsCheck.errorCode が UNIQUE_VIOLATION 系かどうかを確認する。
 * パターン 2: INSERT step 自身の affectedRowsCheck でハンドリングしている。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAffectedRowsUniqueCheck(step: any): boolean {
  return isUniqueViolationErrorCode(step?.affectedRowsCheck?.errorCode);
}

/**
 * step がいずれかの branch / tryCatch 内に入っているかを確認するのではなく、
 * INSERT step の親 branch step が tryCatch で UNIQUE_VIOLATION をハンドルしているかを確認する。
 *
 * 実装上の制約: walkStepsInOrder は step を個別に訪問するため、「親 branch を持つか」の
 * 判定が複雑になる。ここでは代わりに「action 全体の step 列 (flat) に tryCatch で
 * UNIQUE_VIOLATION 系のエラーをハンドルする branch step が存在するか」で代替する。
 * (偽陽性抑止優先: tryCatch が存在すれば OK とみなす)
 *
 * パターン 3: branch step の condition.kind === "tryCatch" で UNIQUE_VIOLATION をキャッチ。
 */
function hasTryCatchUniqueViolationInSteps(steps: Step[]): boolean {
  for (const step of steps) {
    if (!isBuiltinStep(step)) continue;
    if (step.kind === "branch") {
      // branches の condition を確認
      for (const branch of step.branches) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cond = branch.condition as any;
        if (
          cond?.kind === "tryCatch" &&
          Array.isArray(cond?.catchErrors) &&
          cond.catchErrors.some((e: unknown) => {
            if (typeof e === "string") return isUniqueViolationErrorCode(e);
            if (e && typeof e === "object") {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const obj = e as any;
              return isUniqueViolationErrorCode(obj.errorCode ?? obj.code ?? obj.kind ?? "");
            }
            return false;
          })
        ) {
          return true;
        }
        // condition が文字列で UNIQUE_VIOLATION 系を含む場合
        if (typeof branch.condition === "string" && isUniqueViolationErrorCode(branch.condition)) {
          return true;
        }
      }
      // elseBranch も含め再帰
      if (step.elseBranch && hasTryCatchUniqueViolationInSteps(step.elseBranch.steps)) return true;
      for (const branch of step.branches) {
        if (hasTryCatchUniqueViolationInSteps(branch.steps)) return true;
      }
    }
    if (step.kind === "loop" && hasTryCatchUniqueViolationInSteps(step.steps)) return true;
    if (step.kind === "transactionScope") {
      if (hasTryCatchUniqueViolationInSteps(step.steps)) return true;
    }
    if (step.kind === "externalSystem") {
      for (const spec of Object.values(step.outcomes ?? {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = spec as any;
        if (s?.sideEffects && hasTryCatchUniqueViolationInSteps(s.sideEffects)) return true;
      }
    }
  }
  return false;
}

// ─── 観点 5: TX_CIRCULAR_DEPENDENCY ────────────────────────────────────────

/**
 * INSERT/UPDATE 対象テーブルを transactionScope step 内の dbAccess step から収集する。
 * - INSERT / UPDATE step の対象テーブル物理名 (lowercase) を返す
 * - SQL をパースできない場合は step.tableId 経由でフォールバック
 */
function collectTxWriteTableNames(
  txSteps: Step[],
  tableMeta: Map<string, TableMeta>,
  tableIdIndex: Map<string, TableMeta>,
): string[] {
  const result: string[] = [];

  function walk(steps: Step[]): void {
    for (const step of steps) {
      if (!isBuiltinStep(step)) continue;

      if (step.kind === "dbAccess" && (step.operation === "INSERT" || step.operation === "UPDATE") && step.sql) {
        // SQL パースでテーブル名を取得
        const substituted = substituteAtVars(step.sql);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let ast: any = parser.astify(substituted, { database: DIALECT });
          ast = Array.isArray(ast) ? ast[0] : ast;
          if (ast) {
            let tableName: string | null = null;
            if (ast.type === "insert") {
              tableName = extractInsertTableName(ast);
            } else if (ast.type === "update") {
              // UPDATE AST: ast.table または ast.from
              if (Array.isArray(ast.table)) {
                for (const t of ast.table) {
                  if (t.table && typeof t.table === "string") { tableName = t.table.toLowerCase(); break; }
                }
              }
            }
            if (tableName && tableMeta.has(tableName)) {
              result.push(tableName);
            }
          }
        } catch {
          // パース失敗: step.tableId フォールバック
        }
        // step.tableId フォールバック (SQL パース失敗 or テーブル名が取れなかった場合)
        if (step.tableId) {
          const meta = tableIdIndex.get(step.tableId);
          if (meta && !result.includes(meta.physicalName)) {
            result.push(meta.physicalName);
          }
        }
      }

      // nested step の走査 (branch / loop / transactionScope 内は対象外 — TX スコープは本関数呼び出し元で制御)
      if (step.kind === "branch") {
        for (const branch of step.branches) walk(branch.steps);
        if (step.elseBranch) walk(step.elseBranch.steps);
      }
      if (step.kind === "loop") walk(step.steps);
      // 入れ子 TX は対象外 (outer TX のみで循環を見る)
    }
  }

  walk(txSteps);
  return result;
}

/**
 * テーブル集合のサブグラフで有向 FK グラフを構築し、DFS で循環を検出する。
 *
 * グラフ: 各ノード = テーブル物理名 (lowercase)
 *         エッジ A → B = テーブル A の FK が テーブル B を参照する
 *
 * @param tableNames   TX 内で INSERT/UPDATE されたテーブル物理名集合
 * @param tableMeta    テーブルメタデータ (FK 情報含む)
 * @param tableIdIndex id → TableMeta 逆引き
 * @returns 循環パスの配列 (例: [["table_a", "table_b", "table_a"]])
 */
function detectFkCycles(
  tableNames: string[],
  tableMeta: Map<string, TableMeta>,
  tableIdIndex: Map<string, TableMeta>,
): string[][] {
  const tableSet = new Set(tableNames);
  const cycles: string[][] = [];

  // 隣接リスト (A → [B, C, ...]) を tableSet 内のノードのみで構築
  const adj = new Map<string, string[]>();
  for (const name of tableSet) {
    const meta = tableMeta.get(name);
    if (!meta) continue;
    const neighbors: string[] = [];
    for (const fk of meta.fkConstraints) {
      const refMeta = tableIdIndex.get(fk.referencedTableId);
      if (refMeta && tableSet.has(refMeta.physicalName) && refMeta.physicalName !== name) {
        neighbors.push(refMeta.physicalName);
      }
    }
    adj.set(name, neighbors);
  }

  // DFS による back-edge (循環) 検出
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stackPath: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    onStack.add(node);
    stackPath.push(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (onStack.has(neighbor)) {
        // back-edge 発見: 循環パスを抽出
        const cycleStart = stackPath.indexOf(neighbor);
        const cyclePath = [...stackPath.slice(cycleStart), neighbor];
        // 重複しない循環のみ追加 (循環の正規化: 最小要素を先頭にした比較)
        const cycleKey = cyclePath.join("→");
        const alreadyExists = cycles.some((c) => c.join("→") === cycleKey);
        if (!alreadyExists) {
          cycles.push(cyclePath);
        }
      }
    }

    stackPath.pop();
    onStack.delete(node);
  }

  for (const name of tableSet) {
    if (!visited.has(name)) {
      dfs(name);
    }
  }

  return cycles;
}

/**
 * 観点 5: TX_CIRCULAR_DEPENDENCY 検出。
 *
 * 同一 transactionScope 内で INSERT/UPDATE されるテーブル群の FK 有向グラフで循環を検出する。
 * 循環 = テーブル A の FK が B を参照し、かつ B の FK が A を参照 (直接 or 間接) していて、
 * 同一 TX 内で両方が書き込まれている状態。
 *
 * severity = warning (設計者目視確認で許容判断。DEFERRED は本 ISSUE スコープ外)
 */
function checkTxCircularDependency(
  txStep: TransactionScopeStep,
  txPath: string,
  tableMeta: Map<string, TableMeta>,
  tableIdIndex: Map<string, TableMeta>,
  issues: SqlOrderIssue[],
): void {
  const txSteps = txStep.steps ?? [];
  if (txSteps.length === 0) return;

  // TX 内で INSERT/UPDATE されるテーブル物理名を収集
  const writtenTableNames = collectTxWriteTableNames(txSteps, tableMeta, tableIdIndex);
  if (writtenTableNames.length < 2) return; // 2 テーブル未満では循環不可

  // FK グラフで循環検出
  const cycles = detectFkCycles(writtenTableNames, tableMeta, tableIdIndex);

  for (const cycle of cycles) {
    issues.push({
      path: `${txPath}`,
      code: "TX_CIRCULAR_DEPENDENCY",
      severity: "warning",
      message: `transactionScope 内で双方向 FK 循環が検出されました: ${cycle.join(" → ")}。同一 TX で INSERT/UPDATE されるテーブル間に循環する FK 参照チェーンが存在します。DEFERRED 制約または挿入順序の見直し / FK 一時無効化を検討してください (設計者目視確認が必要です)。`,
    });
  }
}

// ─── メイン検査ロジック ─────────────────────────────────────────────────────

/**
 * action 内 INSERT / DELETE step を順番に検査。
 *
 * - boundVars: action.inputs の name + 各 step を順に実行した際に蓄積される outputBinding.name
 * - insertedTableIds: 先行 INSERT で書き込んだテーブルの id (FK 参照先確認用)
 * - deletedTableIds: 先行 DELETE で削除したテーブルの id (観点 4 の子 DELETE 前段確認用)
 * - priorSelectWhereColumns: INSERT より前に見た SELECT の WHERE カラム集合 (観点 3 用)
 */
function checkAction(
  actionIndex: number,
  steps: Step[],
  tableMeta: Map<string, TableMeta>,
  tableIdIndex: Map<string, TableMeta>, // id → TableMeta
  initialBound: Set<string>,
  issues: SqlOrderIssue[],
): void {
  const boundVars = new Set<string>(initialBound);
  const insertedTableIds = new Set<string>();
  // 観点 4: 先行 DELETE 済みテーブル id (physicalName lowercase → id の逆引きも兼ねる)
  const deletedTableIds = new Set<string>();
  // 観点 3: INSERT より前に見た SELECT の WHERE カラム集合 (テーブル物理名 → カラム集合)
  const priorSelectWhereColumnsByTable = new Map<string, Set<string>>();
  // loop step の collectionItemName を scope 管理するスタック
  // push: ループ開始時に name を登録 (既存なら null を push してスコープ変更なし)
  // pop: ループ終了時に登録した name を boundVars から削除
  const loopScopeStack: Array<string | null> = [];

  // 平坦化した step のシーケンスを順走査
  // (branch 内部は楽観的に両パスを走査してバインドを union する — 保守的な偽陽性抑止)
  walkStepsInOrder(steps, `actions[${actionIndex}].steps`, (step, path) => {
    if (!isBuiltinStep(step)) return;

    // ── 観点 5: TX_CIRCULAR_DEPENDENCY ────────────────────────────────────
    // transactionScope step を検出したら、そのスコープ内のテーブルで FK 循環を検査
    if (step.kind === "transactionScope") {
      checkTxCircularDependency(step as TransactionScopeStep, path, tableMeta, tableIdIndex, issues);
    }

    // outputBinding を先に boundVars に追加 (同 step の sql でも使えるよう before/after は問わない)
    // 厳密には sql 評価後に bind されるが、偽陽性抑止のため同 step の binding も有効とする。
    if (step.outputBinding?.name) {
      boundVars.add(step.outputBinding.name);
    }
    // ValidationStep.fieldErrorsVar も暗黙宣言として boundVars に取り込む
    // (identifierScope.ts:129-132 と同ロジック、デフォルト名 "fieldErrors")
    if (step.kind === "validation") {
      boundVars.add(step.fieldErrorsVar ?? "fieldErrors");
    }
    if (step.kind === "compute" && step.outputBinding?.name) {
      boundVars.add(step.outputBinding.name);
    }

    // dbAccess SELECT: WHERE カラムを収集 (観点 3 の false positive 抑止用)
    if (step.kind === "dbAccess" && step.operation === "SELECT" && step.sql) {
      const substitutedSel = substituteAtVars(step.sql);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let astSel: any = parser.astify(substitutedSel, { database: DIALECT });
        astSel = Array.isArray(astSel) ? astSel[0] : astSel;
        if (astSel && astSel.type === "select") {
          // SELECT 対象テーブル名を抽出 (FROM 句)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fromTables: string[] = [];
          if (Array.isArray(astSel.from)) {
            for (const fromItem of astSel.from) {
              if (fromItem?.table && typeof fromItem.table === "string") {
                fromTables.push(fromItem.table.toLowerCase());
              }
            }
          }
          const whereColumns = extractWhereColumns(astSel);
          for (const tbl of fromTables) {
            const existing = priorSelectWhereColumnsByTable.get(tbl) ?? new Set<string>();
            for (const col of whereColumns) existing.add(col);
            priorSelectWhereColumnsByTable.set(tbl, existing);
          }
          // テーブルが特定できない場合は全テーブルに追加 (偽陽性抑止)
          if (fromTables.length === 0 && whereColumns.size > 0) {
            const fallback = priorSelectWhereColumnsByTable.get("__any__") ?? new Set<string>();
            for (const col of whereColumns) fallback.add(col);
            priorSelectWhereColumnsByTable.set("__any__", fallback);
          }
        }
      } catch {
        // SELECT パース失敗は無視 (観点 3 の偽陽性抑止のため)
      }
    }

    // dbAccess DELETE: 観点 4 (CASCADE_DELETE_OMITTED) の検査
    if (step.kind === "dbAccess" && step.operation === "DELETE" && step.sql) {
      const delSql = step.sql;
      const delSubstituted = substituteAtVars(delSql);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let delAst: any;
      try {
        delAst = parser.astify(delSubstituted, { database: DIALECT });
      } catch {
        // DELETE パース失敗は観点 4 をスキップ
        delAst = null;
      }
      if (delAst) {
        const delRootNode = Array.isArray(delAst) ? delAst[0] : delAst;
        const delTableName = extractDeleteTableName(delRootNode);
        if (delTableName) {
          const delMeta = tableMeta.get(delTableName);
          if (delMeta) {
            // ── 観点 4: CASCADE_DELETE_OMITTED ──────────────────────────────
            // 親テーブルを DELETE しようとしている → 子テーブルを逆引きして確認
            // 子テーブル = fkConstraints に referencedTableId === delMeta.id が含まれるテーブル
            for (const childMeta of tableMeta.values()) {
              for (const fk of childMeta.fkConstraints) {
                if (fk.referencedTableId !== delMeta.id) continue;

                // onDelete の確認: cascade / setNull / setDefault は DB 側が処理 → skip
                const onDel = fk.onDelete ?? "noAction";
                if (onDel === "cascade" || onDel === "setNull" || onDel === "setDefault") continue;

                // restrict / noAction: 子テーブルへの前段 DELETE が必要
                if (deletedTableIds.has(childMeta.id)) continue;

                // 前段 DELETE なし → error
                issues.push({
                  path: `${path}.sql`,
                  code: "CASCADE_DELETE_OMITTED",
                  severity: "error",
                  message: `テーブル "${delMeta.physicalName}" を DELETE する前に、FK (onDelete=${onDel}) で参照している子テーブル "${childMeta.physicalName}" の DELETE が必要です。子テーブル行を先に DELETE してから親テーブルを DELETE してください。`,
                });
              }
            }

            // この DELETE を記録 (後続の親テーブル DELETE の false positive 抑止用)
            deletedTableIds.add(delMeta.id);
          }
        }
        // step.tableId からも記録 (SQL が取得できない場合の補完)
        if (step.tableId) {
          const metaById = tableIdIndex.get(step.tableId);
          if (metaById) deletedTableIds.add(metaById.id);
        }
      }
    }

    // dbAccess INSERT のみ検査
    if (step.kind !== "dbAccess") return;
    if (step.operation !== "INSERT") return;
    const sql = step.sql;
    if (!sql) return;

    // INSERT 先テーブルを記録
    const tableIdRef = step.tableId ?? "";

    // SQL パース
    const atVarMap = buildAtVarMap(sql);
    const substituted = substituteAtVars(sql);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ast: any;
    try {
      ast = parser.astify(substituted, { database: DIALECT });
    } catch {
      issues.push({
        path: `${path}.sql`,
        code: "SQL_PARSE_ERROR",
        message: "INSERT SQL のパースに失敗しました (sqlOrderValidator)",
      });
      return;
    }

    // AST が配列の場合は先頭のみ使用
    const rootNode = Array.isArray(ast) ? ast[0] : ast;
    if (!rootNode || rootNode.type !== "insert") return;

    const insertTableName = extractInsertTableName(rootNode);
    if (!insertTableName) return;
    const meta = tableMeta.get(insertTableName);

    // テーブルがカタログに無い場合は検査しない (外部テーブルは対象外)
    if (meta) {
      const colVarMap = extractInsertColumnVarMap(rootNode, atVarMap);

      // ── 観点 1: NOT NULL × 変数バインド ─────────────────────────────────
      for (const [colPhysical, varName] of colVarMap.entries()) {
        if (!meta.notNullColumns.has(colPhysical)) continue;   // nullable は無視
        if (meta.autoColumns.has(colPhysical)) continue;        // autoIncrement / DEFAULT は無視

        if (varName === null) {
          // NULL リテラルまたはプレースホルダ番号に対応する @var が無い (プレースホルダ外の NULL)
          issues.push({
            path: `${path}.sql`,
            code: "NULL_NOT_ALLOWED_AT_INSERT",
            message: `テーブル "${insertTableName}" の NOT NULL カラム "${colPhysical}" に NULL が挿入されます。INSERT 時点で非 NULL 値が必要です。`,
          });
        } else if (varName !== "__literal__" && !boundVars.has(varName)) {
          // 変数参照だが、この時点でまだバインドされていない
          issues.push({
            path: `${path}.sql`,
            code: "NULL_NOT_ALLOWED_AT_INSERT",
            message: `テーブル "${insertTableName}" の NOT NULL カラム "${colPhysical}" が参照する変数 @${varName} は INSERT 時点で未バインドです。`,
          });
        }
      }

      // ── 観点 2: FK 参照先テーブルへの先行 INSERT ─────────────────────────
      // 検査対象: FK カラムの値が変数参照 (= 実行時 binding) であり、
      //           かつその変数が boundVars にも存在しない (= SELECT 未済) で、
      //           かつ FK 参照先テーブルへの先行 INSERT も存在しない場合
      //
      // False positive 抑止の設計判断:
      //   FK カラムが @existingRow.id のような変数参照をしており、その変数が
      //   boundVars に存在する場合は「先行 SELECT で取得済みの既存行を参照している」
      //   とみなして issue にしない (よくあるパターン: SELECT → INSERT の正常フロー)。
      //   問題になるのは FK カラムが「まだバインドされていない変数」を参照している場合のみ。
      for (const fk of meta.fkConstraints) {
        // FK カラムが今回の INSERT 対象に含まれているか
        const fkColsInInsert = fk.columnPhysicalNames.filter((c) => colVarMap.has(c));
        if (fkColsInInsert.length === 0) continue;

        const refTableId = fk.referencedTableId;
        const refMeta = tableIdIndex.get(refTableId);
        if (!refMeta) continue; // 参照先テーブルがカタログ外 → skip

        // FK 参照先テーブルへの先行 INSERT が存在する場合は OK (通常の親→子 INSERT 順序)
        if (insertedTableIds.has(refTableId)) continue;

        // FK 列の値変数が全て boundVars に存在する場合は OK
        // (SELECT で取得済みの既存行 ID を参照しているとみなす)
        const allVarsBound = fkColsInInsert.every((c) => {
          const v = colVarMap.get(c);
          // null (NULL リテラル) または未バインド変数 → NG
          if (v === null || v === undefined) return false;
          if (v === "__literal__") return true; // リテラル値は OK
          return boundVars.has(v); // 変数がバインド済みなら OK
        });
        if (allVarsBound) continue;

        // FK 列の値が変数参照かつ未バインド → 潜在的問題
        const unboundFkCols = fkColsInInsert.filter((c) => {
          const v = colVarMap.get(c);
          if (v === null || v === undefined || v === "__literal__") return false;
          return !boundVars.has(v);
        });
        if (unboundFkCols.length === 0) continue;

        issues.push({
          path: `${path}.sql`,
          code: "FK_REFERENCE_NOT_INSERTED",
          message: `テーブル "${insertTableName}" の FK カラム [${unboundFkCols.join(", ")}] が参照する "${refMeta.physicalName}" の行が INSERT 時点で未確保です (先行 INSERT なし、かつ FK 列の変数が未バインド)。`,
        });
      }

      // ── 観点 3: UNIQUE 制約 × 事前チェック有無 (warning) ───────────────────
      // UNIQUE 制約のあるカラムが INSERT 対象に含まれる場合、
      // 以下のいずれかが存在するか確認する:
      //   パターン 1: 同テーブルへの先行 SELECT WHERE で UNIQUE カラムを参照している
      //   パターン 2: INSERT step 自身の affectedRowsCheck.errorCode が UNIQUE_VIOLATION 系
      //   パターン 3: action 全体の steps に tryCatch で UNIQUE_VIOLATION をキャッチする branch がある
      const allUniqueConstraints: Array<{ cols: string[] }> = [
        ...meta.uniqueConstraints.map((cols) => ({ cols })),
        // Column.unique: true は単体 UNIQUE として扱う
        ...[...meta.uniqueColumns].map((col) => ({ cols: [col] })),
      ];

      for (const uq of allUniqueConstraints) {
        // INSERT 対象カラムとの交差
        const uqColsInInsert = uq.cols.filter((c) => colVarMap.has(c));
        if (uqColsInInsert.length === 0) continue;

        // パターン 2: affectedRowsCheck.errorCode が UNIQUE_VIOLATION 系
        if (hasAffectedRowsUniqueCheck(step)) continue;

        // パターン 3: action 全体の steps に tryCatch で UNIQUE_VIOLATION をキャッチする branch
        if (hasTryCatchUniqueViolationInSteps(steps)) continue;

        // パターン 1: 同テーブルへの先行 SELECT WHERE でいずれかの UNIQUE カラムを参照
        const tablePriorCols = priorSelectWhereColumnsByTable.get(insertTableName) ?? new Set<string>();
        // __any__ (テーブル不明な SELECT のカラム) も加算
        const anyPriorCols = priorSelectWhereColumnsByTable.get("__any__") ?? new Set<string>();
        const mergedPriorCols = new Set<string>([...tablePriorCols, ...anyPriorCols]);
        if (hasPriorSelectForUniqueColumns(uqColsInInsert, mergedPriorCols)) continue;

        // どのパターンも満たさない → warning
        issues.push({
          path: `${path}.sql`,
          code: "UNIQUE_CHECK_MISSING",
          severity: "warning",
          message: `テーブル "${insertTableName}" の UNIQUE カラム [${uqColsInInsert.join(", ")}] に対する事前の重複チェックがありません。INSERT 前に SELECT で存在確認するか、INSERT の affectedRowsCheck で UNIQUE VIOLATION をハンドルするか、tryCatch で UNIQUE_VIOLATION エラーをキャッチしてください。`,
        });
      }

      // INSERT 完了後: このテーブル id を insertedTableIds に追加
      insertedTableIds.add(meta.id);
    }

    // tableId 参照 (SQL ではなく step.tableId から) でも追加
    if (tableIdRef) {
      const metaById = tableIdIndex.get(tableIdRef);
      if (metaById) insertedTableIds.add(metaById.id);
    }
  }, {
    onEnter: (loop) => {
      const name = loop.collectionItemName;
      if (name && !boundVars.has(name)) {
        boundVars.add(name);
        loopScopeStack.push(name);
      } else {
        // 既に boundVars に存在する (ネスト同名ループ等) → 追加しない
        loopScopeStack.push(null);
      }
    },
    onExit: () => {
      const popped = loopScopeStack.pop();
      if (popped) boundVars.delete(popped);
    },
  });
}

// ─── エクスポート関数 ───────────────────────────────────────────────────────

/**
 * ProcessFlow 内の全 action を検査し、DB 制約 × 操作順序の問題を返す。
 *
 * @param flow   検査対象の ProcessFlow
 * @param tables テーブル定義一覧 (v3 形式、physicalName + columns[].notNull + constraints[])
 */
export function checkSqlOrder(
  flow: ProcessFlow,
  tables: OrderTableDefinition[],
): SqlOrderIssue[] {
  const issues: SqlOrderIssue[] = [];
  const tableMeta = buildTableMeta(tables);

  // id → TableMeta の逆引きインデックス
  const tableIdIndex = new Map<string, TableMeta>();
  for (const meta of tableMeta.values()) {
    tableIdIndex.set(meta.id, meta);
  }

  // ProcessFlow は context.ambientVariables が暗黙バインド
  const ambientVars = new Set<string>(
    (flow.context?.ambientVariables ?? []).map((v) => v.name),
  );
  // 暗黙的にどこでも参照可能な特殊ルート変数名
  // (@inputs.xxx / @conv.xxx / @env.xxx / @secret.xxx / @now 等は常にバインド済みとみなす)
  const ALWAYS_BOUND = new Set(["inputs", "outputs", "conv", "env", "secret", "now", "requestId", "fn"]);

  flow.actions.forEach((action, ai) => {
    // inputs は action 開始時点で全てバインド済み
    const initialBound = new Set<string>(ambientVars);
    // 特殊ルート変数は常にバインド済み
    for (const name of ALWAYS_BOUND) initialBound.add(name);
    for (const inp of action.inputs ?? []) {
      initialBound.add(inp.name);
    }
    checkAction(ai, action.steps ?? [], tableMeta, tableIdIndex, initialBound, issues);
  });

  return issues;
}
