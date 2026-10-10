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

/**
 * `activeId` の要素を、`overId` の要素の「前」または「後」へ動かす (配列を直接並べ替える)。動いたら true。
 * 横に並んだ項目へのドロップで、落とした位置の目印 (前 / 後) どおりに入れるために使う。
 * (`moveById` は「相手の元の位置へ入る」ので、前へ動かすと相手の後ろ、後ろへ動かすと相手の前になる。)
 */
export function moveByIdAt<T extends { id: string }>(list: T[], activeId: string, overId: string, place: "before" | "after"): boolean {
  if (activeId === overId) return false;
  const from = list.findIndex((x) => x.id === activeId);
  if (from < 0 || !list.some((x) => x.id === overId)) return false;
  const before = list.map((x) => x.id).join("\u0000");
  const [item] = list.splice(from, 1);
  const at = list.findIndex((x) => x.id === overId);
  list.splice(place === "before" ? at : at + 1, 0, item);
  return list.map((x) => x.id).join("\u0000") !== before;
}
