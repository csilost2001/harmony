/**
 * 表の行のドラッグ並べ替え (UI 改善提案 第 3 弾 #48) の、番号の計算。画面に依存しない純関数。
 */

/** from の行を、to の位置 (取り除いたあとの番号) へ動かした配列 */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return [...arr];
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

/**
 * ドロップした位置 (行 over の、前 = after:false / 後ろ = after:true) から、動かした先の番号 (取り除いたあとの番号) を決める。
 * 自分の直前・直後に落としたときは、動かさない (from と同じ番号が返る)
 */
export function dropIndex(from: number, over: number, after: boolean): number {
  const dest = after ? over + 1 : over;
  return from < dest ? dest - 1 : dest;
}

/** 行 i は、from の行を to へ動かしたあと、何番になるか */
export function remapIndex(i: number, from: number, to: number): number {
  if (i === from) return to;
  if (from < to && i > from && i <= to) return i - 1;
  if (from > to && i >= to && i < from) return i + 1;
  return i;
}

/** 番号の集まり (選択・展開している行など) を、動かしたあとの番号に直す */
export function remapIndexSet(set: ReadonlySet<number>, from: number, to: number): Set<number> {
  return new Set([...set].map((i) => remapIndex(i, from, to)));
}
