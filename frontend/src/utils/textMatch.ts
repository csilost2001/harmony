/**
 * 補完・検索の文字の突き合わせ (表記ゆれを吸収する)。
 *
 * 全角 / 半角・大文字 / 小文字・ひらがな / カタカナの違いを無視して比べる。
 * 補完は「前方一致を上位、部分一致を下位」に並べる (どの補完も同じ規則)。
 */

/** 比較用に整える: NFKC (全角英数・半角カナを正規化) → 小文字 → カタカナをひらがなへ。 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * 一致の強さ: 0 = 前方一致 / 1 = 部分一致 / -1 = 一致しない。query が空なら 0。
 * 部分一致を認める最小の文字数は minPartial (既定 1)。
 */
export function matchRank(text: string, query: string, minPartial = 1): 0 | 1 | -1 {
  const q = normalizeForMatch(query);
  if (q === "") return 0;
  const t = normalizeForMatch(text);
  if (t.startsWith(q)) return 0;
  return q.length >= minPartial && t.includes(q) ? 1 : -1;
}

/**
 * 前方一致、または 2 文字以上の部分一致なら true (構造のある名前の補完の絞り込み用)。
 * 1 文字では部分一致にしない (候補が増えすぎて、かえって探しにくいため)。
 */
export function looseMatch(text: string, query: string): boolean {
  return matchRank(text, query, 2) >= 0;
}

/** 候補のどれかの文字が一致する強さのうち、いちばん強いもの。 */
export function bestRank(texts: (string | undefined)[], query: string): 0 | 1 | -1 {
  let best: 0 | 1 | -1 = -1;
  for (const t of texts) {
    if (t === undefined) continue;
    const r = matchRank(t, query);
    if (r === 0) return 0;
    if (r === 1) best = 1;
  }
  return best;
}

/** 前方一致 → 部分一致の順に並べ替える (同順位は元の順を保つ)。一致しないものは落とす。 */
export function rankByMatch<T>(items: T[], query: string, texts: (item: T) => (string | undefined)[]): T[] {
  const scored = items
    .map((item, index) => ({ item, index, rank: bestRank(texts(item), query) }))
    .filter((x) => x.rank >= 0);
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.map((x) => x.item);
}
