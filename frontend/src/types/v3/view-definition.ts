/**
 * v3 ViewDefinition 型定義 (`schemas/v3/view-definition.v3.schema.json` と 1:1 対応)
 *
 * - 画面側の一覧 UI viewer 設定 (list / detail / kanban / calendar 等)
 * - DB View (view.ts) とは axis が異なる: viewer は画面コンポーネント内 render
 * - Screen は items[] の `direction: "viewer"` screen-item から `viewDefinitionId` で参照される
 *
 * 参考: schemas/v3/view-definition.v3.schema.json
 */

import type {
  Authoring,
  Brand,
  DisplayName,
  EntityMeta,
  ExpressionString,
  FieldType,
  Identifier,
  TableColumnRef,
  TableId,
  Uuid,
} from "./common";

/** ViewDefinition の永続識別子 (branded UUID)。 */
export type ViewDefinitionId = Brand<Uuid, "ViewDefinitionId">;

/** 組み込み viewer 種別 (4 種)。 */
export type BuiltinViewDefinitionKind = "list" | "detail" | "kanban" | "calendar";

/**
 * viewer 種別。組み込み + 拡張参照 (`namespace:kindName`)。
 * 例: `retail:storefront`
 */
export type ViewDefinitionKind = BuiltinViewDefinitionKind | string;

/** ソート 1 列。columnName は ViewColumn.name を参照。 */
export interface SortSpec {
  columnName: Identifier;
  order: "asc" | "desc";
}

/** フィルタの比較演算子。 */
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "in"
  | "between";

/** フィルタ 1 件。columnName は ViewColumn.name を参照。 */
export interface FilterSpec {
  columnName: Identifier;
  operator: FilterOperator;
  /** 比較リテラル (operator に応じて型が変わる)。 */
  value?: unknown;
  /** 比較値を式で渡す場合 (例: `@conv.numbering.lowStockThreshold`)。 */
  valueExpression?: ExpressionString;
}

/**
 * viewer 1 列。table カラムへの複合参照 + 画面表示型 (FieldType)。
 *
 * - Level 1: `tableColumnRef.tableId === ViewDefinition.sourceTableId`。
 * - Level 2: `tableColumnRef.tableId` は `query.from.tableId` / `query.joins[].tableId` のいずれか。
 * - Level 3 (Raw SQL): `tableColumnRef` 省略可 (`name` + `type` のみで列を宣言)。
 */
export interface ViewColumn {
  /** 列識別子 (camelCase)。同 ViewDefinition 内で一意。 */
  name: Identifier;
  /** 参照する table カラム (Pattern B)。Level 3 では省略可。 */
  tableColumnRef?: TableColumnRef;
  displayName?: DisplayName;
  /** 画面表示型 (FieldType)。Level 1/2 では Column.dataType と互換であること (validator が検査)。 */
  type: FieldType;
  /** 表示書式。例: `'#,##0'`, `'YYYY-MM-DD'`。 */
  displayFormat?: string;
  /** 列幅 (CSS 表記、例: `'120px'`, `'1fr'`)。 */
  width?: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  filterable?: boolean;
  /** 列表示条件式。 */
  visibleWhen?: ExpressionString;
  /** セル click で navigate する path (例: `'/orders/:id'`)。 */
  linkTo?: string;
}

/**
 * Level 2 (Structured) の起点テーブル (#745)。
 *
 * `alias` は WHERE / JOIN / columns[].displayFormat の SQL fragment 内で参照される。
 */
export interface ViewQueryFrom {
  tableId: TableId;
  alias: string;
}

/** Level 2 (Structured) の join 1 件 (#745)。on は AND 結合される SQL fragment 配列。 */
export interface ViewQueryJoin {
  kind: "INNER" | "LEFT" | "RIGHT" | "FULL";
  tableId: TableId;
  alias: string;
  /** ON 条件式 (SQL fragment、複数要素は AND 結合)。例: `"o.customer_id = c.id"`。 */
  on: string[];
}

/**
 * Level 3 (Raw SQL) の `@param.<name>` 参照宣言 (#745)。
 *
 * fieldType は呼び出し側 (画面 filter 等) が値の型整合を判断するために使う。
 */
export interface ViewQueryParameterRef {
  name: Identifier;
  fieldType: FieldType;
  description?: string;
}

/**
 * Level 2 (Structured) の query 定義 (#745)。
 *
 * sql は持たない (持つ場合は ViewQueryRawSql として Level 3 扱い)。
 */
export interface ViewQueryStructured {
  from: ViewQueryFrom;
  joins?: ViewQueryJoin[];
  /** WHERE 条件式 (SQL fragment、複数要素は AND 結合)。 */
  where?: string[];
  /** GROUP BY 列式 (SQL fragment)。 */
  groupBy?: string[];
  /** HAVING 条件式 (SQL fragment、複数要素は AND 結合)。 */
  having?: string[];
  /** ORDER BY 式 (SQL fragment)。runtime ソートは sortDefaults を優先利用、orderBy は SQL 段の固定ソートに用途を限る。 */
  orderBy?: string[];
}

/**
 * Level 3 (Raw SQL) の query 定義 (#745)。
 *
 * window 関数 / CTE / 再帰 / UNION 等 Level 2 で書けない SQL を直接記述する。
 * 式補間は ProcessFlow.dbAccess と同じく `@<var>` / `@conv.*` / `@env.*` / `@param.<name>`。
 */
export interface ViewQueryRawSql {
  sql: string;
  parameterRefs?: ViewQueryParameterRef[];
}

/** Level 2 または Level 3 の query 定義 (#745)。from と sql は排他。 */
export type ViewQuery = ViewQueryStructured | ViewQueryRawSql;

/**
 * ViewDefinition entity 本体 (#745: 3 レベル DSL)。
 *
 * - Level 1 (Simple): `sourceTableId` のみ (既存形式)。
 * - Level 2 (Structured): `query: { from, joins, where, ... }`。
 * - Level 3 (Raw SQL): `query: { sql, parameterRefs }`。
 *
 * sourceTableId と query は排他 (oneOf)。
 */
export interface ViewDefinition extends EntityMeta {
  $schema?: string;
  kind: ViewDefinitionKind;
  /** Level 1 (Simple) の主要ソーステーブル。Level 2/3 では使わない。 */
  sourceTableId?: TableId;
  /** Level 2 (Structured) または Level 3 (Raw SQL) の query 定義。sourceTableId と排他。 */
  query?: ViewQuery;
  columns: ViewColumn[];
  /** 既定ソート順 (複数列対応)。 */
  sortDefaults?: SortSpec[];
  /** 初期フィルタ条件。 */
  filterDefaults?: FilterSpec[];
  /** ページング初期件数 (1..1000)。 */
  pageSize?: number;
  /** kanban / グルーピング表示時の集約キー。columns[].name を参照。 */
  groupBy?: Identifier;
  authoring?: Authoring;
}
