/**
 * v3 View 型定義 (`schemas/v3/view.v3.schema.json` と 1:1 対応)
 *
 * 参考: schemas/v3/view.v3.schema.json
 */

import type {
  Authoring,
  Description,
  DisplayName,
  EntityMeta,
  PhysicalName,
  Uuid,
  ViewId,
} from "./common";
import type { DataType } from "./table";

/** View 出力カラム 1 件。 */
export interface OutputColumn {
  physicalName: PhysicalName;
  name?: DisplayName;
  dataType: DataType;
  description?: Description;
}

/** DB ビュー 1 件の定義。SELECT 文 + 出力カラム + 依存テーブル/ビュー。 */
export interface View extends EntityMeta {
  id: ViewId;
  $schema?: string;
  physicalName: PhysicalName;
  /** ビューを定義する SELECT 文 (DB 方言依存)。 */
  selectStatement: string;
  outputColumns: OutputColumn[];
  /** 依存する Table / View entity の Uuid 一覧。 */
  dependencies?: Uuid[];
  /** true でマテリアライズドビュー。 */
  materialized?: boolean;
  authoring?: Authoring;
}
