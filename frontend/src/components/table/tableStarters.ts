/**
 * テーブルの新規作成で選べる「スターター」: よくある形のカラムを、最初から入れておく。
 * カラムの中身は tableConstants の COLUMN_TEMPLATES (カラム追加のテンプレート) と同じものを使う。
 */
import { COLUMN_TEMPLATES } from "./tableConstants";
import type { Column } from "../../types/v3";

export interface TableStarter {
  id: string;
  label: string;
  description: string;
  /** COLUMN_TEMPLATES の id (この順にカラムを作る) */
  templateIds: string[];
}

export const TABLE_STARTERS: TableStarter[] = [
  { id: "empty", label: "空 (カラムなし)", description: "カラムは、あとから足します", templateIds: [] },
  { id: "standard", label: "標準 (ID・作成日時・更新日時)", description: "どのテーブルにもある基本の列", templateIds: ["tpl-pk-bigint", "tpl-created-at", "tpl-updated-at"] },
  { id: "master", label: "マスタ (ID・コード・名称・表示順・有効フラグ + 作成・更新日時)", description: "コードで引く、区分・商品などのマスタ向け", templateIds: ["tpl-pk-bigint", "tpl-code", "tpl-name", "tpl-sort-order", "tpl-flag", "tpl-created-at", "tpl-updated-at"] },
  { id: "transaction", label: "トランザクション (ID・ステータス・備考 + 作成・更新日時・削除フラグ)", description: "注文・申請など、状態が変わる記録向け", templateIds: ["tpl-pk-bigint", "tpl-status", "tpl-description", "tpl-created-at", "tpl-updated-at", "tpl-delete-flag"] },
];

/** スターターのカラムの元 (id・no はまだ付けない)。無いテンプレートは飛ばす。 */
export function starterColumns(starterId: string): Array<Omit<Column, "id" | "no">> {
  const starter = TABLE_STARTERS.find((s) => s.id === starterId);
  if (!starter) return [];
  return starter.templateIds.flatMap((tid) => {
    const tpl = COLUMN_TEMPLATES.find((t) => t.id === tid);
    return tpl ? [{ ...tpl.column }] : [];
  });
}
