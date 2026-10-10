/** id を持つ要素の並べ替え (ドラッグ & ドロップ用の純関数) */

/** `activeId` の要素を `overId` の位置へ動かす (配列を直接並べ替える)。動いたら true */
export function moveById<T extends { id: string }>(list: T[], activeId: string, overId: string): boolean {
  const from = list.findIndex((x) => x.id === activeId);
  const to = list.findIndex((x) => x.id === overId);
  if (from < 0 || to < 0 || from === to) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}
