/**
 * v3 ErLayout 型定義 (`schemas/v3/er-layout.v3.schema.json` と 1:1 対応)
 *
 * Designer (ER 図エディタ) 専用。
 * `data/er-layout.json` に対応。
 */

import type { LocalId, TableId, Timestamp } from "./common";

/** Table の UI 座標 (シンプルな x/y のみ)。 */
export interface ErPosition {
  x: number;
  y: number;
}

/** FK 未定義の論理リレーション (概念設計段階)。 */
export interface LogicalRelation {
  id: LocalId;
  sourceTableId: TableId;
  sourceColumnId?: LocalId;
  targetTableId: TableId;
  targetColumnId?: LocalId;
  /** ER モデリング業界慣習に従い kebab-case。 */
  cardinality: "one-to-one" | "one-to-many" | "many-to-many";
  /** リレーション説明 (例: `顧客は複数の注文を持つ`)。 */
  label?: string;
}

/** ER 図 UI 座標 + 論理リレーション。 */
export interface ErLayout {
  $schema?: string;
  /** Table の Uuid をキーとし、UI 座標を値とする。 */
  positions: Record<string, ErPosition>;
  logicalRelations?: LogicalRelation[];
  updatedAt: Timestamp;
}
