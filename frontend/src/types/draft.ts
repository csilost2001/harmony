/**
 * DraftResourceType — `@harmony/shared` package を単一定義として re-export (#1375)
 *
 * 旧来 frontend / backend 双方に同一 union 型を手書きで持っていたが、新 resource type 追加時に
 * 2 箇所同期が必要で drift リスクがあった (#1374 で backend 内 4 表現の集約を達成、本 ISSUE で
 * frontend と backend の重複を `@harmony/shared` package 経由で構造的に解消)。
 *
 * 配列定義の本体: `shared/src/draftResourceTypes.ts` (新 resource type 追加は本ファイル 1 箇所のみで完結)
 */
export { type DraftResourceType } from "@harmony/shared";
