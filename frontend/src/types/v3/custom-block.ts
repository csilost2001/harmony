/**
 * v3 CustomBlock 型定義 (`schemas/v3/custom-block.v3.schema.json` と 1:1 対応)
 *
 * **CustomBlock は EntityMeta を持たない例外** (label ベースの GrapesJS 用構造、業務 entity ではない)。
 *
 * 参考: schemas/v3/custom-block.v3.schema.json
 */

import type { CustomBlockId, Description, Timestamp } from "./common";

/** GrapesJS カスタムブロック 1 件。 */
export interface CustomBlock {
  /** id は Uuid 強制 (v1 timestamp 形式廃止)。 */
  id: CustomBlockId;
  /** ブロック名 (GrapesJS 表示)。 */
  label: string;
  category?: string;
  /** GrapesJS HTML / component tree (JSON) を文字列で持つ。 */
  content: string;
  /** 共有ブロックか (true: プロジェクト横断、false: 個別 screen のみ)。 */
  shared?: boolean;
  description?: Description;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** v3 では root が CustomBlock の配列 (data/custom-blocks.json)。 */
export type CustomBlockArray = CustomBlock[];
