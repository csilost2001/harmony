/**
 * F6 / Shift+F6 で巡回する、画面の領域。ヘッダー → タブ → 画面の中の領域 (`data-region` を付けたもの) の順。
 * マウスやタブキーの連打なしで、一覧・編集・詳細・マーカーなどの間を移る。
 */
export interface Region { el: HTMLElement; name: string }

const isShown = (el: HTMLElement) => {
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  return !el.hidden && getComputedStyle(el).display !== "none";
};

export function collectRegions(doc: Document = document): Region[] {
  const out: Region[] = [];
  const header = doc.querySelector<HTMLElement>("header.common-header");
  if (header) out.push({ el: header, name: "ヘッダー" });
  const tabs = doc.querySelector<HTMLElement>("nav.tabbar");
  if (tabs) out.push({ el: tabs, name: "タブ" });
  doc.querySelectorAll<HTMLElement>("#app-main [data-region]").forEach((el) => {
    if (isShown(el)) out.push({ el, name: el.getAttribute("data-region") || "領域" });
  });
  return out;
}

const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** 領域の中で最初にフォーカスできるもの (無ければ領域そのもの) にフォーカスする */
export function focusRegion(r: Region): void {
  // 領域の中ですでにフォーカスがあれば、その次へ送るのではなく、領域の先頭へ (巡回の起点がぶれないように)
  const target = r.el.matches(FOCUSABLE) ? r.el : r.el.querySelector<HTMLElement>(FOCUSABLE);
  if (target) { target.focus(); target.scrollIntoView?.({ block: "nearest" }); return; }
  r.el.setAttribute("tabindex", "-1");
  r.el.focus();
}

/** いまフォーカスのある領域の番号 (どこにも無ければ -1)。入れ子なら、いちばん内側 */
export function currentRegionIndex(regions: readonly Region[], active: Element | null): number {
  let best = -1;
  regions.forEach((r, i) => { if (active && r.el.contains(active) && (best === -1 || regions[best].el.contains(r.el))) best = i; });
  return best;
}

/** F6 の次の領域の番号 (巡回する)。dir = 1 で次、-1 で前 */
export function nextRegionIndex(count: number, current: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (current === -1) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}
