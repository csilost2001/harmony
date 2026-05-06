/**
 * v3 Table 型定義 (`schemas/v3/table.v3.schema.json` と 1:1 対応)
 *
 * - EntityMeta + 物理名 + カラム + 制約 + インデックス + DEFAULT + トリガー + コメント + authoring
 * - FK は ConstraintDefinition に集約 (TableColumn に inline foreignKey は持たない)
 * - Constraint は discriminated union (unique / check / foreignKey)
 *
 * 参考: schemas/v3/table.v3.schema.json
 */

import type {
  Authoring,
  Description,
  DisplayName,
  EntityMeta,
  LocalId,
  PhysicalName,
  TableId,
} from "./common";

// ─── DataType ────────────────────────────────────────────────────────────

/** 組み込み DataType (SQL 業界慣習に従い UPPER)。 */
export type BuiltinDataType =
  | "VARCHAR"
  | "CHAR"
  | "TEXT"
  | "INTEGER"
  | "BIGINT"
  | "SMALLINT"
  | "DECIMAL"
  | "FLOAT"
  | "BOOLEAN"
  | "DATE"
  | "TIME"
  | "TIMESTAMP"
  | "BLOB"
  | "JSON";

/**
 * DB データ型。プリミティブ enum + 拡張参照 (`namespace:UPPER_SNAKE`)。
 * 例: `oracle:VARCHAR2`, `postgres:JSONB`
 */
export type DataType = BuiltinDataType | string;

// ─── Column ──────────────────────────────────────────────────────────────

/** カラム 1 件。physicalName (snake_case) と name (表示名、自由) を分離。 */
export interface Column {
  id: LocalId;
  /** 物理順 (1..N)。 */
  no?: number;
  physicalName: PhysicalName;
  /** 表示名 (例: `ユーザーID`, `ログインID`)。 */
  name: DisplayName;
  dataType: DataType;
  /** VARCHAR / CHAR / DECIMAL の長さ。 */
  length?: number;
  /** DECIMAL のスケール (小数桁)。 */
  scale?: number;
  notNull?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  /** DDL DEFAULT 句に出す値 (リテラル / 関数式)。 */
  defaultValue?: string;
  /** DDL カラムコメント。 */
  comment?: string;
  description?: Description;
}

// ─── Index ───────────────────────────────────────────────────────────────

/** インデックス内のカラム参照。 */
export interface IndexColumn {
  /** Column.id (LocalId) を参照。 */
  columnId: LocalId;
  order?: "asc" | "desc";
}

/** インデックス定義。 */
export interface Index {
  id: LocalId;
  /** インデックス物理名 (例: `idx_users_email`)。 */
  physicalName: PhysicalName;
  columns: IndexColumn[];
  unique?: boolean;
  /** インデックスアルゴリズム。 */
  method?: "btree" | "hash" | "gin" | "gist";
  /** Partial Index の WHERE 句。 */
  where?: string;
  description?: Description;
}

// ─── Constraint (discriminated union) ────────────────────────────────────

export interface UniqueConstraint {
  id: LocalId;
  kind: "unique";
  physicalName?: PhysicalName;
  columnIds: LocalId[];
  description?: Description;
}

export interface CheckConstraint {
  id: LocalId;
  kind: "check";
  physicalName?: PhysicalName;
  /** SQL CHECK 式 (例: `price > 0`, `status IN ('active', 'inactive')`)。 */
  expression: string;
  description?: Description;
}

/** FK 違反時のアクション。lowerCamelCase 統一 (v1 の `NO ACTION` / `SET NULL` のスペース含み廃止)。 */
export type FkAction = "cascade" | "setNull" | "setDefault" | "restrict" | "noAction";

/** 外部キー制約。単一カラム / 複合カラムを統一表現。referencedTableId は Uuid (物理名直書きは廃止)。 */
export interface ForeignKeyConstraint {
  id: LocalId;
  kind: "foreignKey";
  physicalName?: PhysicalName;
  /** 本テーブルの Column.id 配列。 */
  columnIds: LocalId[];
  /** 参照先 Table の Uuid。 */
  referencedTableId: TableId;
  /** 参照先 Column.id 配列。 */
  referencedColumnIds: LocalId[];
  onDelete?: FkAction;
  onUpdate?: FkAction;
  /** true なら DDL に FK 制約を出力しない (論理 FK のみ、ER 図表示用)。 */
  noConstraint?: boolean;
  description?: Description;
}

/** テーブル制約 (discriminated union: unique / check / foreignKey)。 */
export type Constraint = UniqueConstraint | CheckConstraint | ForeignKeyConstraint;

// ─── DefaultDefinition / TriggerDefinition ───────────────────────────────

/**
 * カラム DEFAULT 値の構造化定義。Column.defaultValue の代替として使用可。
 * - `literal`: リテラル
 * - `function`: DB 関数 (NOW() 等)
 * - `sequence`: シーケンス参照
 * - `convention`: `@conv.numbering.<key>` 参照
 */
export interface DefaultDefinition {
  columnId: LocalId;
  kind: "literal" | "function" | "sequence" | "convention";
  value: string;
  description?: Description;
}

/** トリガー定義。 */
export interface TriggerDefinition {
  id: LocalId;
  physicalName: PhysicalName;
  timing: "BEFORE" | "AFTER" | "INSTEAD_OF";
  events: ("INSERT" | "UPDATE" | "DELETE" | "TRUNCATE")[];
  /** WHEN 句 (省略可)。 */
  whenCondition?: string;
  /** トリガー本体 (PL/pgSQL 等の DB 方言依存)。 */
  body: string;
  description?: Description;
}

// ─── Table root ─────────────────────────────────────────────────────────

/** Table entity 本体。EntityMeta + 物理名 + カラム + 制約 + インデックス + 等。 */
export interface Table extends EntityMeta {
  /** Sequence / View と同じく id を TableId に narrow (compile-time 識別)。schema 上は Uuid。 */
  id: TableId;
  $schema?: string;
  /** DB 物理名 (snake_case)。例: `users`, `order_items` */
  physicalName: PhysicalName;
  /** テーブルカテゴリ (例: `マスタ`, `トランザクション`, `中間テーブル`, `ログ` 等)。 */
  category?: string;
  /** DDL レベルのテーブルコメント (DB に COMMENT として出力)。 */
  comment?: string;
  columns: Column[];
  indexes?: Index[];
  constraints?: Constraint[];
  defaults?: DefaultDefinition[];
  triggers?: TriggerDefinition[];
  authoring?: Authoring;
}
