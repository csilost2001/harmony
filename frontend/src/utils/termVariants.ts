/**
 * 用語の書き方のゆれ (カタカナの長音 ユーザ / ユーザー など) を、入力中に見つける (続編 第 8 弾 #160)。画面に依存しない純関数。
 * ほかの設計で使われている書き方を基準にし、入力した語がどこにも使われていない書き方で、同じ語の別の書き方が使われているときだけ示す。
 * (同じ書き方がすでにほかで使われていれば、それは利用者の選んだ書き方なので示さない)
 */

const KATAKANA_RUN = /[ァ-ヶー]{2,}/g;

/** 同じ語かを比べる印。語の終わりの長音を除き、ヴ をブにそろえる (語の途中の長音は残す: ビル と ビール は別の語) */
export function termKey(run: string): string {
  return run.replace(/ヴ([ァィェォ])/g, (_, v: string) => "バビベボ"["ァィェォ".indexOf(v)]).replace(/ヴ/g, "ブ").replace(/ー+$/, "");
}

function runsOf(text: string): string[] {
  return text.normalize("NFKC").match(KATAKANA_RUN) ?? [];
}

export interface TermHint {
  /** 入力された書き方 */
  from: string;
  /** ほかでいちばん多く使われている書き方 */
  to: string;
  /** ほかでの使われている数 */
  count: number;
}

/** 入力 `text` の語のうち、ほかの名前 `known` で別の書き方をされているものを返す */
export function termVariantHints(text: string, known: readonly string[]): TermHint[] {
  const inputRuns = runsOf(text);
  if (inputRuns.length === 0) return [];
  // 印 → 書き方 → 使われている数
  const spellings = new Map<string, Map<string, number>>();
  for (const name of known) {
    for (const r of runsOf(name)) {
      const k = termKey(r);
      if (k.length < 2) continue;
      const m = spellings.get(k) ?? new Map<string, number>();
      m.set(r, (m.get(r) ?? 0) + 1);
      spellings.set(k, m);
    }
  }
  const out: TermHint[] = [];
  const seen = new Set<string>();
  for (const r of inputRuns) {
    const k = termKey(r);
    const m = spellings.get(k);
    if (!m || m.has(r) || seen.has(r)) continue;
    seen.add(r);
    const [to, count] = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))[0];
    out.push({ from: r, to, count });
  }
  return out;
}

/** 入力の中の語を、統一先の書き方に置き換える (全角半角をそろえた上で) */
export function applyTermHint(text: string, hint: TermHint): string {
  return text.normalize("NFKC").split(hint.from).join(hint.to);
}
