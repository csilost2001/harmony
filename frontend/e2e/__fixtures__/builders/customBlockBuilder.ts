/**
 * v3 CustomBlock builder — e2e テスト用 fixture 生成。
 *
 * CustomBlock は EntityMeta を持たない例外 (label ベースの GrapesJS 用構造)。
 * required: id / label / category / content / shared / createdAt / updatedAt
 */

import type {
  CustomBlock,
  CustomBlockId,
  Timestamp,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildCustomBlockOpts {
  id?: string;
  label?: string;
  category?: string;
  content?: string;
  shared?: boolean;
}

export function buildCustomBlock(opts: BuildCustomBlockOpts = {}): CustomBlock {
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as CustomBlockId)
    : (crypto.randomUUID() as unknown as CustomBlockId);

  return {
    id,
    label: opts.label ?? "テストブロック",
    category: opts.category ?? "テスト",
    content: opts.content ?? "<div>テストコンテンツ</div>",
    shared: opts.shared ?? false,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
