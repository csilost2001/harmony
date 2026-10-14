/**
 * 画面項目を貼り付けるときの下ごしらえ (純関数)。別の画面からのコピーでも、同じ画面の中でのコピーでも、
 * 既にある項目 ID と重なる ID には「Copy」(重なる間は Copy2, Copy3…) を付ける。元の項目は書き換えない。
 */
import type { Identifier } from "../types/v3";
import type { ScreenItem } from "../types/v3/screen-item";

export interface ItemPastePlan {
  items: ScreenItem[];
  /** ID を付け替えたもの (元の ID → 新しい ID) */
  renamed: Array<{ from: string; to: string }>;
}

/** 貼ると ID が重なる項目の ID (確認の文言に使う) */
export function conflictingItemIds(existing: readonly ScreenItem[], pasted: readonly ScreenItem[]): string[] {
  const ids = new Set(existing.map((i) => i.id as string));
  return pasted.map((i) => i.id as string).filter((id, k, a) => id !== "" && ids.has(id) && a.indexOf(id) === k);
}

export function planItemPaste(existing: readonly ScreenItem[], pasted: readonly ScreenItem[]): ItemPastePlan {
  const ids = new Set(existing.map((i) => i.id as string));
  const renamed: ItemPastePlan["renamed"] = [];
  const items = pasted.map((src) => {
    let id = src.id as string;
    if (id !== "" && ids.has(id)) {
      let n = 1;
      let candidate = `${id}Copy`;
      while (ids.has(candidate)) { n++; candidate = `${id}Copy${n}`; }
      renamed.push({ from: id, to: candidate });
      id = candidate;
    }
    if (id !== "") ids.add(id);
    return { ...src, id: id as Identifier } as ScreenItem;
  });
  return { items, renamed };
}
