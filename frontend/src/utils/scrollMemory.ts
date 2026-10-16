/**
 * 設計ごとのスクロール位置の記憶 (続編 第 8 弾 #157)。画面に依存しない部分。
 * 画面 (パス) ごとに、スクロールした要素の位置を覚える。要素は data-testid / id / 最初の class で見分ける (見分けがつかない要素は覚えない)。
 * sessionStorage にだけ置く (ブラウザを閉じれば消える)。
 */
const KEY = "harmony-scroll-memory";
const MAX_ROUTES = 60;

export type ScrollSpots = Record<string, number>;

/** スクロールした要素の見分け方。document 自身は "#doc"。見分けがつかなければ null */
export function scrollTargetKey(el: Element | Document, scrollingElement: Element | null): string | null {
  if (el instanceof Document || el === scrollingElement) return "#doc";
  const tid = el.getAttribute("data-testid");
  if (tid) return `t:${tid}`;
  if (el.id) return `i:${el.id}`;
  const cls = el.classList[0];
  return cls ? `c:${cls}` : null;
}

function read(): Record<string, ScrollSpots> {
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function write(all: Record<string, ScrollSpots>): void {
  try {
    const keys = Object.keys(all);
    // 古いものから捨てる (オブジェクトの挿入順)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ROUTES))) delete all[k];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* 使えないときは覚えないだけ */ }
}

export function recordScroll(route: string, targetKey: string, top: number): void {
  const all = read();
  const spots = all[route] ?? {};
  delete all[route]; // 末尾へ (新しいものとして)
  if (top <= 0) delete spots[targetKey]; else spots[targetKey] = Math.round(top);
  all[route] = spots;
  write(all);
}

export function recalledScroll(route: string): ScrollSpots {
  return read()[route] ?? {};
}

export function _clearScrollMemory(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* 無視 */ }
}
