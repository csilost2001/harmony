/**
 * 編集画面の中の検索 (Ctrl+F)。ブラウザの検索では見つからない、入力欄・選択欄・テキスト欄の「値」も探す。
 * 画面の見えているところだけを、DOM から読む (どの編集画面にも、個別の対応なしで効く)。
 */
import { normalizeForMatch } from "./textMatch";

export type FindHit =
  | { kind: "field"; el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }
  | { kind: "text"; range: Range; scrollTo: HTMLElement };

export const FIND_MAX_HITS = 500;
const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]), textarea, select";
const SKIP_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "SELECT", "OPTION", "INPUT", "SVG"]);

/** 範囲の位置 (範囲の位置を測れない環境では、0 で並びを変えない) */
function rectOf(range: Range): { top: number; left: number } {
  return typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : { top: 0, left: 0 };
}

/** 見えている (隠されていない) か */
export function isVisible(el: Element): boolean {
  const h = el as HTMLElement & { checkVisibility?: (o?: { visibilityProperty?: boolean }) => boolean };
  if (typeof h.checkVisibility === "function") return h.checkVisibility({ visibilityProperty: true });
  // checkVisibility が無い環境 (古いブラウザ・テスト) では、祖先をたどって、隠されていないかを見る
  for (let e: Element | null = el; e; e = e.parentElement) {
    if ((e as HTMLElement).hidden) return false;
    const st = getComputedStyle(e);
    if (st.display === "none" || st.visibility === "hidden") return false;
  }
  return true;
}

/** 欄の、探す対象の文字。選択欄は、選ばれている項目の見えている名前 */
export function fieldText(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent ?? "";
  return el.value ?? "";
}

/**
 * root の中で query に合うものを、画面の上から順に集める (最大 FIND_MAX_HITS 件)。
 * 検索語は、全角半角・大文字小文字・ひらがなカタカナの違いを無視して、部分一致。`data-find-ignore` の中は探さない。
 */
export function collectHits(root: Element, query: string): FindHit[] {
  const q = normalizeForMatch(query.trim());
  if (q === "") return [];
  const hits: Array<{ hit: FindHit; top: number; left: number }> = [];
  const ignored = (el: Element | null) => !!el?.closest("[data-find-ignore]");

  for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(FIELD)) {
    if (hits.length >= FIND_MAX_HITS) break;
    if (ignored(el) || !isVisible(el)) continue;
    if (normalizeForMatch(fieldText(el)).includes(q)) {
      const r = el.getBoundingClientRect();
      hits.push({ hit: { kind: "field", el }, top: r.top, left: r.left });
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TEXT.has(parent.tagName.toUpperCase()) || ignored(parent) || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return (node.nodeValue ?? "").trim() === "" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n && hits.length < FIND_MAX_HITS; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    // 正規化で長さが変わる文字 (NFKC) があるので、1 文字ずつ位置を合わせて探す
    const norm = normalizeForMatch(text);
    if (norm.length !== text.length) {
      if (!norm.includes(q)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = rectOf(range);
      hits.push({ hit: { kind: "text", range, scrollTo: n.parentElement as HTMLElement }, top: r.top, left: r.left });
      continue;
    }
    let from = 0;
    for (let at = norm.indexOf(q, from); at !== -1 && hits.length < FIND_MAX_HITS; at = norm.indexOf(q, from)) {
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + q.length);
      const r = rectOf(range);
      hits.push({ hit: { kind: "text", range, scrollTo: n.parentElement as HTMLElement }, top: r.top, left: r.left });
      from = at + q.length;
    }
  }
  // 画面の上から下、左から右の順
  hits.sort((a, b) => (Math.abs(a.top - b.top) < 4 ? a.left - b.left : a.top - b.top));
  return hits.map((h) => h.hit);
}

/** 編集画面のパス (Ctrl+F を、この画面の検索に使う)。ほかの画面では、ブラウザの検索のまま */
export function isEditorPath(pathname: string): boolean {
  return /\/(edit|items|design)\//.test(pathname) || /\/(conventions\/catalog|generic-definition)(\/|$)/.test(pathname);
}
