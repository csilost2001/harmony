/**
 * v3 Sequence 型定義 (`schemas/v3/sequence.v3.schema.json` と 1:1 対応)
 *
 * 参考: schemas/v3/sequence.v3.schema.json
 */

import type { Authoring, EntityMeta, PhysicalName, SequenceId, TableColumnRef } from "./common";

/** DB シーケンス 1 件の定義。`@conv.numbering.<key>` から参照される。 */
export interface Sequence extends EntityMeta {
  id: SequenceId;
  $schema?: string;
  /** シーケンス物理名 (例: `seq_order_number`)。 */
  physicalName: PhysicalName;
  startValue?: number;
  increment?: number;
  minValue?: number;
  maxValue?: number;
  /** true で max 到達後 min に巡回。 */
  cycle?: boolean;
  /** キャッシュサイズ。 */
  cache?: number;
  /** 本シーケンスを利用するテーブルカラム参照 (Pattern B 複合参照)。 */
  usedBy?: TableColumnRef[];
  /** `@conv.numbering.<key>` 形式の参照。本シーケンスがどの採番規約を実装するかを示す。 */
  conventionRef?: string;
  authoring?: Authoring;
}
