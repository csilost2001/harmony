/**
 * ViewDefinition 整合検証 (#649、Phase 4 子 1 / #745 で 3 レベル DSL 拡張)
 *
 * 検査観点 (11 件、#745 で再定義):
 * 1. UNKNOWN_SOURCE_TABLE         — sourceTableId / query.from.tableId / query.joins[].tableId が同プロジェクト内に実在しない
 * 2. UNKNOWN_TABLE_COLUMN_REF     — ViewColumn.tableColumnRef が実在しない
 * 3. UNKNOWN_TABLE_REF_IN_VIEW    — Level 2: tableColumnRef.tableId が from/joins いずれにも無い (#745、error)
 * 4. JOIN_NOT_DECLARED            — Level 1: tableColumnRef.tableId が sourceTableId と異なる (暗黙 join、warning)
 *                                   #745 で旧 COLUMN_REF_NOT_IN_SOURCE_TABLE を再定義 (Level 2 アップグレードを推奨)
 * 5. DUPLICATE_QUERY_ALIAS        — Level 2: query.from.alias と query.joins[].alias 間で別名が重複 (#745、error)
 * 6. DUPLICATE_VIEW_COLUMN_NAME   — ViewColumn.name が同 ViewDefinition 内で重複
 * 7. FIELD_TYPE_INCOMPATIBLE      — ViewColumn.type (FieldType) と DB Column.dataType が互換しない (warning)
 * 8. UNKNOWN_SORT_COLUMN          — sortDefaults[].columnName が columns[].name に存在しない
 * 9. UNKNOWN_FILTER_COLUMN        — filterDefaults[].columnName が columns[].name に存在しない
 * 10. FILTER_OPERATOR_TYPE_MISMATCH — filter operator が column type と不整合 (warning)
 * 11. UNKNOWN_GROUP_BY_COLUMN     — groupBy が columns[].name に存在しない
 *
 * Level 別の column ref 検査:
 * - Level 1 (sourceTableId): tableColumnRef.tableId === sourceTableId なら正常、異なるなら JOIN_NOT_DECLARED (warning)
 * - Level 2 (query.from + joins): tableColumnRef.tableId が {from} ∪ {joins[].tableId} に含まれないと UNKNOWN_TABLE_REF_IN_VIEW (error)
 * - Level 3 (query.sql): tableColumnRef は省略可、validator は SQL 構文解析せず columns 宣言を信頼
 */

import type {
  ViewColumn,
  ViewDefinition,
  ViewQueryStructured,
  ViewQueryRawSql,
} from "../types/v3/view-definition";

export type ViewDefinitionIssueCode =
  | "UNKNOWN_SOURCE_TABLE"
  | "UNKNOWN_TABLE_COLUMN_REF"
  | "UNKNOWN_TABLE_REF_IN_VIEW"
  | "JOIN_NOT_DECLARED"
  | "DUPLICATE_QUERY_ALIAS"
  | "DUPLICATE_VIEW_COLUMN_NAME"
  | "FIELD_TYPE_INCOMPATIBLE"
  | "UNKNOWN_SORT_COLUMN"
  | "UNKNOWN_FILTER_COLUMN"
  | "FILTER_OPERATOR_TYPE_MISMATCH"
  | "UNKNOWN_GROUP_BY_COLUMN";

export interface ViewDefinitionIssue {
  path: string;
  code: ViewDefinitionIssueCode;
  severity: "error" | "warning";
  viewDefinitionId: string;
  message: string;
}

/** テーブル定義の最小インターフェース (validate-samples からも利用) */
export interface TableDefinitionForView {
  id: string;
  physicalName?: string;
  name?: string;
  columns?: Array<{
    id: string;
    physicalName?: string;
    name?: string;
    dataType?: string;
  }>;
}

/** DB DataType → FieldType 互換マップ (ViewColumn.type と照合) */
const DATATYPE_TO_FIELDTYPE_COMPATIBLE: Record<string, string[]> = {
  INTEGER: ["integer", "number", "string"],
  BIGINT: ["integer", "number", "string"],
  SMALLINT: ["integer", "number", "string"],
  DECIMAL: ["number", "string"],
  NUMERIC: ["number", "string"],
  FLOAT: ["number", "string"],
  DOUBLE: ["number", "string"],
  REAL: ["number", "string"],
  VARCHAR: ["string"],
  TEXT: ["string"],
  CHAR: ["string"],
  BOOLEAN: ["boolean", "string"],
  DATE: ["date", "string"],
  TIMESTAMP: ["datetime", "date", "string"],
  DATETIME: ["datetime", "date", "string"],
  JSON: ["json", "string"],
  JSONB: ["json", "string"],
  BINARY: ["string"],
  BLOB: ["string"],
};

/** text 系 FieldType で between/in 等の数値系オペレータは不整合 */
const TEXT_OPERATORS_ONLY = new Set(["contains", "startsWith"]);
const NUMERIC_OPERATORS_ONLY = new Set(["between"]);

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeFieldType(type: unknown): string | null {
  if (typeof type === "string") return type;
  const rec = type as Record<string, unknown> | null;
  if (rec && typeof rec.kind === "string") return rec.kind;
  return null;
}

function getViewId(vd: ViewDefinition): string {
  // ViewDefinition extends EntityMeta (flat), so id is at root
  return vd.id ?? "<unknown>";
}

/** Level 判定: query.sql があれば 3、query.from があれば 2、それ以外 (sourceTableId) は 1。 */
function detectLevel(vd: ViewDefinition): 1 | 2 | 3 {
  const q = vd.query;
  if (q && "sql" in q && typeof (q as ViewQueryRawSql).sql === "string") return 3;
  if (q && "from" in q && (q as ViewQueryStructured).from) return 2;
  return 1;
}

/**
 * 単一 ViewDefinition を検証。
 * tables は同プロジェクトのテーブル定義一覧。
 */
export function checkViewDefinition(
  vd: ViewDefinition,
  tables: TableDefinitionForView[],
): ViewDefinitionIssue[] {
  const issues: ViewDefinitionIssue[] = [];
  const viewId = getViewId(vd);
  const level = detectLevel(vd);

  // テーブル索引を事前構築
  const tableById = new Map<string, TableDefinitionForView>();
  for (const t of tables) {
    if (t.id) tableById.set(t.id, t);
  }

  // ─── Level 別: ref 解決対象テーブル集合の決定 ─────────────────────────
  // Level 1: sourceTableId 単独
  // Level 2: from.tableId ∪ joins[].tableId
  // Level 3: 検査対象なし (raw SQL は構文解析せず信頼)
  const refTableIds = new Set<string>();
  if (level === 1 && vd.sourceTableId) {
    refTableIds.add(vd.sourceTableId);
  } else if (level === 2) {
    const sq = vd.query as ViewQueryStructured;
    if (sq.from?.tableId) refTableIds.add(sq.from.tableId);
    for (const j of sq.joins ?? []) {
      if (j.tableId) refTableIds.add(j.tableId);
    }
  }

  // ─── 1. UNKNOWN_SOURCE_TABLE (Level 1 のみ、Level 2 は from.tableId 検査で代替) ────
  if (level === 1) {
    if (!vd.sourceTableId) {
      issues.push({
        path: `ViewDefinition[${viewId}].sourceTableId`,
        code: "UNKNOWN_SOURCE_TABLE",
        severity: "error",
        viewDefinitionId: viewId,
        message: "Level 1 (Simple) では sourceTableId が必須です。Level 2/3 を使う場合は query フィールドを宣言してください。",
      });
    } else if (!tableById.has(vd.sourceTableId)) {
      issues.push({
        path: `ViewDefinition[${viewId}].sourceTableId`,
        code: "UNKNOWN_SOURCE_TABLE",
        severity: "error",
        viewDefinitionId: viewId,
        message: `sourceTableId '${vd.sourceTableId}' が同プロジェクト内のテーブルに存在しません。`,
      });
    }
  } else if (level === 2) {
    const sq = vd.query as ViewQueryStructured;
    if (sq.from?.tableId && !tableById.has(sq.from.tableId)) {
      issues.push({
        path: `ViewDefinition[${viewId}].query.from.tableId`,
        code: "UNKNOWN_SOURCE_TABLE",
        severity: "error",
        viewDefinitionId: viewId,
        message: `query.from.tableId '${sq.from.tableId}' が同プロジェクト内のテーブルに存在しません。`,
      });
    }
    (sq.joins ?? []).forEach((j, ji) => {
      if (j.tableId && !tableById.has(j.tableId)) {
        issues.push({
          path: `ViewDefinition[${viewId}].query.joins[${ji}].tableId`,
          code: "UNKNOWN_SOURCE_TABLE",
          severity: "error",
          viewDefinitionId: viewId,
          message: `query.joins[${ji}].tableId '${j.tableId}' が同プロジェクト内のテーブルに存在しません。`,
        });
      }
    });

    // ─── 5. DUPLICATE_QUERY_ALIAS (#745、Level 2 のみ) ────────────────────
    // from.alias と joins[].alias の集合で重複がないか検査。
    const aliasSeen = new Map<string, string>(); // alias → 最初に出てきた path
    if (sq.from?.alias) {
      aliasSeen.set(sq.from.alias, `query.from.alias`);
    }
    (sq.joins ?? []).forEach((j, ji) => {
      const a = j.alias;
      if (!a) return;
      if (aliasSeen.has(a)) {
        issues.push({
          path: `ViewDefinition[${viewId}].query.joins[${ji}].alias`,
          code: "DUPLICATE_QUERY_ALIAS",
          severity: "error",
          viewDefinitionId: viewId,
          message: `query.joins[${ji}].alias '${a}' が ${aliasSeen.get(a)} と重複しています。alias は from / joins[] 全体で一意にしてください。`,
        });
      } else {
        aliasSeen.set(a, `query.joins[${ji}].alias`);
      }
    });
  }

  // columns の name セットを構築 (後続 sort / filter / groupBy 検査用)
  const columnNames = new Set<string>();

  // ─── 5. DUPLICATE_VIEW_COLUMN_NAME (先にカウント) ─────────────────────
  const columnNameCount = new Map<string, number>();
  for (const col of vd.columns ?? []) {
    const n = asString(col.name);
    if (n) columnNameCount.set(n, (columnNameCount.get(n) ?? 0) + 1);
  }

  // ─── columns 個別検査 ────────────────────────────────────────────────────
  (vd.columns ?? []).forEach((col: ViewColumn, ci: number) => {
    const colName = asString(col.name) ?? `columns[${ci}]`;
    const colPath = `ViewDefinition[${viewId}].columns[${ci}=${colName}]`;

    // 5. DUPLICATE_VIEW_COLUMN_NAME
    if ((columnNameCount.get(colName) ?? 0) > 1) {
      // 初出 (first occurrence) のみ報告 (重複は 1 回のみ)
      if (!columnNames.has(colName)) {
        issues.push({
          path: colPath,
          code: "DUPLICATE_VIEW_COLUMN_NAME",
          severity: "error",
          viewDefinitionId: viewId,
          message: `columns[].name '${colName}' が同 ViewDefinition 内で重複しています。`,
        });
      }
    }
    columnNames.add(colName);

    const ref = col.tableColumnRef;
    // Level 3 (Raw SQL) では tableColumnRef 省略可
    if (!ref) {
      if (level !== 3) {
        // Level 1/2 で tableColumnRef 欠落は別途 schema レベルで検出されるはず
      }
      return;
    }

    const refTableId = asString(ref.tableId);
    const refColumnId = asString(ref.columnId);

    // 3. UNKNOWN_TABLE_REF_IN_VIEW (Level 2 のみ、error)
    // 4. JOIN_NOT_DECLARED (Level 1 のみ、warning)
    if (refTableId) {
      if (level === 1) {
        if (vd.sourceTableId && refTableId !== vd.sourceTableId) {
          issues.push({
            path: `${colPath}.tableColumnRef`,
            code: "JOIN_NOT_DECLARED",
            severity: "warning",
            viewDefinitionId: viewId,
            message: `tableColumnRef.tableId '${refTableId}' が sourceTableId '${vd.sourceTableId}' と異なります (暗黙 join)。Level 2 (query.from + joins) へのアップグレードを推奨します。`,
          });
        }
      } else if (level === 2) {
        if (!refTableIds.has(refTableId)) {
          issues.push({
            path: `${colPath}.tableColumnRef`,
            code: "UNKNOWN_TABLE_REF_IN_VIEW",
            severity: "error",
            viewDefinitionId: viewId,
            message: `tableColumnRef.tableId '${refTableId}' が query.from / query.joins[] のいずれにも含まれていません。joins[] に declarations を追加するか、tableId を修正してください。`,
          });
        }
      }
      // Level 3 では検査しない (raw SQL を信頼)
    }

    // 2. UNKNOWN_TABLE_COLUMN_REF (Level 1/2 共通、Level 3 は ref が optional のため skip)
    if (level !== 3 && refTableId && refColumnId) {
      const refTable = tableById.get(refTableId);
      if (!refTable) {
        issues.push({
          path: `${colPath}.tableColumnRef`,
          code: "UNKNOWN_TABLE_COLUMN_REF",
          severity: "error",
          viewDefinitionId: viewId,
          message: `tableColumnRef.tableId '${refTableId}' が同プロジェクト内のテーブルに存在しません。`,
        });
      } else {
        const refColumn = (refTable.columns ?? []).find((c) => c.id === refColumnId);
        if (!refColumn) {
          issues.push({
            path: `${colPath}.tableColumnRef`,
            code: "UNKNOWN_TABLE_COLUMN_REF",
            severity: "error",
            viewDefinitionId: viewId,
            message: `tableColumnRef.columnId '${refColumnId}' がテーブル '${refTableId}' に存在しません。`,
          });
        } else {
          // 6. FIELD_TYPE_INCOMPATIBLE (warning)
          const dbType = asString(refColumn.dataType)?.toUpperCase();
          const fieldType = normalizeFieldType(col.type);
          if (dbType && fieldType) {
            const compatible = DATATYPE_TO_FIELDTYPE_COMPATIBLE[dbType];
            if (compatible && !compatible.includes(fieldType)) {
              issues.push({
                path: `${colPath}.type`,
                code: "FIELD_TYPE_INCOMPATIBLE",
                severity: "warning",
                viewDefinitionId: viewId,
                message: `ViewColumn.type '${fieldType}' と DB Column.dataType '${dbType}' が互換しません。互換 FieldType: ${compatible.join(", ")}。`,
              });
            }
          }
        }
      }
    }
  });

  // columnNames.has() はコラム名の存在確認のみ。型情報は別途 map で保持
  const columnFieldType = new Map<string, string | null>();
  for (const col of vd.columns ?? []) {
    const n = asString(col.name);
    if (n) columnFieldType.set(n, normalizeFieldType(col.type));
  }

  // ─── 6. UNKNOWN_SORT_COLUMN ────────────────────────────────────────────────
  (vd.sortDefaults ?? []).forEach((sortSpec, si) => {
    const colName = asString(sortSpec.columnName);
    if (colName && !columnNames.has(colName)) {
      issues.push({
        path: `ViewDefinition[${viewId}].sortDefaults[${si}].columnName`,
        code: "UNKNOWN_SORT_COLUMN",
        severity: "error",
        viewDefinitionId: viewId,
        message: `sortDefaults[${si}].columnName '${colName}' が columns[].name に存在しません。`,
      });
    }
  });

  // ─── 7. UNKNOWN_FILTER_COLUMN / 8. FILTER_OPERATOR_TYPE_MISMATCH ────────
  (vd.filterDefaults ?? []).forEach((filterSpec, fi) => {
    const colName = asString(filterSpec.columnName);
    if (!colName) return;

    if (!columnNames.has(colName)) {
      issues.push({
        path: `ViewDefinition[${viewId}].filterDefaults[${fi}].columnName`,
        code: "UNKNOWN_FILTER_COLUMN",
        severity: "error",
        viewDefinitionId: viewId,
        message: `filterDefaults[${fi}].columnName '${colName}' が columns[].name に存在しません。`,
      });
      return;
    }

    // 8. FILTER_OPERATOR_TYPE_MISMATCH
    const operator = asString(filterSpec.operator);
    const fieldType = columnFieldType.get(colName);
    if (operator && fieldType) {
      const isTextType = fieldType === "string";
      const isNumericType = ["integer", "number", "date", "datetime"].includes(fieldType);

      if (isTextType && NUMERIC_OPERATORS_ONLY.has(operator)) {
        issues.push({
          path: `ViewDefinition[${viewId}].filterDefaults[${fi}].operator`,
          code: "FILTER_OPERATOR_TYPE_MISMATCH",
          severity: "warning",
          viewDefinitionId: viewId,
          message: `filterDefaults[${fi}] operator '${operator}' は text 系 FieldType '${fieldType}' では不整合です。`,
        });
      }
      if (isNumericType && TEXT_OPERATORS_ONLY.has(operator)) {
        issues.push({
          path: `ViewDefinition[${viewId}].filterDefaults[${fi}].operator`,
          code: "FILTER_OPERATOR_TYPE_MISMATCH",
          severity: "warning",
          viewDefinitionId: viewId,
          message: `filterDefaults[${fi}] operator '${operator}' は数値/日付系 FieldType '${fieldType}' では不整合です。`,
        });
      }
    }
  });

  // ─── 9. UNKNOWN_GROUP_BY_COLUMN ───────────────────────────────────────────
  if (vd.groupBy) {
    const groupByName = asString(vd.groupBy);
    if (groupByName && !columnNames.has(groupByName)) {
      issues.push({
        path: `ViewDefinition[${viewId}].groupBy`,
        code: "UNKNOWN_GROUP_BY_COLUMN",
        severity: "error",
        viewDefinitionId: viewId,
        message: `groupBy '${groupByName}' が columns[].name に存在しません。`,
      });
    }
  }

  return issues;
}

/**
 * プロジェクト全体の ViewDefinition を検証。
 * viewDefinitions は data/view-definitions/<id>.json 相当のオブジェクト配列。
 */
export function checkViewDefinitions(
  viewDefinitions: ViewDefinition[],
  tables: TableDefinitionForView[],
): ViewDefinitionIssue[] {
  const issues: ViewDefinitionIssue[] = [];
  for (const vd of viewDefinitions ?? []) {
    issues.push(...checkViewDefinition(vd, tables));
  }
  return issues;
}
