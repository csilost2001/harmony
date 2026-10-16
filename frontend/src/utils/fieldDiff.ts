/**
 * 保存した内容と違う欄の判定 (UI 改善提案 第 5 弾 #84)。画面に依存しない純関数。
 * 空 (undefined・null・空文字・false) は、同じとみなす (チェックを外したのと、項目が無いのは、同じ状態)。
 */
const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || v === false;

export const sameValue = (a: unknown, b: unknown): boolean => (isEmpty(a) && isEmpty(b)) || JSON.stringify(a) === JSON.stringify(b);

/** current のうち、base と値が違う項目 (keys の中だけ)。base が無ければ、空 (新しい行は、別の印で示す) */
export function changedKeys<T extends object, K extends keyof T>(current: T, base: T | undefined, keys: readonly K[]): Set<K> {
  const out = new Set<K>();
  if (!base) return out;
  for (const k of keys) if (!sameValue(current[k], base[k])) out.add(k);
  return out;
}
