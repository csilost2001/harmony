/**
 * listOrder.ts — 一覧系アイテムの No (物理順フィールド) を管理するユーティリティ。
 *
 * 仕様: docs/spec/list-common.md §3.10
 *
 * 各一覧系アイテム (TableMeta / ScreenNode / ProcessFlowMeta / TableColumn) は `no: number`
 * フィールドを持ち、連番 1..N を厳密に維持する。D&D / 新規作成 / 削除 / Ctrl+V / Ctrl+D /
 * Alt+↑↓ などの物理順変更操作のたびに全体を再採番する。
 */

/** 一覧アイテムが持つべき最小フィールド */
export interface HasNo {
  no: number;
}

/**
 * 配列の現在の順序に基づいて `no` を 1..N で再採番して返す。
 *
 * - 既に 1..N 連番になっている場合も新しい配列を返す (浅い比較用)
 * - 既存データ移行: `no` が欠落している場合も配列 index から埋まる
 * - idempotent: 何度呼んでも同じ結果
 */
export function renumber<T extends Partial<HasNo>>(items: T[]): (T & HasNo)[] {
  return items.map((item, index) => ({ ...item, no: index + 1 }));
}

/**
 * 配列の最大 no + 1 を返す (新規追加時の採番用)。
 * 空配列なら 1。
 */
export function nextNo<T extends Partial<HasNo>>(items: T[]): number {
  let max = 0;
  for (const item of items) {
    const n = item.no ?? 0;
    if (n > max) max = n;
  }
  return max + 1;
}
