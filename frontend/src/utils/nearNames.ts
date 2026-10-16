/**
 * 検索で 0 件のときの「近い名前」の候補 (UI 改善提案 続編 第 6 弾 #120)。画面に依存しない純関数。
 * 全角半角・大文字小文字・ひらがな / カタカナの違いを無視し、(1) 検索語を含む名前の一部が合う、(2) 編集距離が小さい、ものを近い順に返す。
 */
function fold(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, "");
}

/** 編集距離 (挿入・削除・置換が 1 ずつ)。上限を超えたら、上限 + 1 を返して打ち切る */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 検索語に近い名前を、近い順に limit 件まで (重複は除く)。検索語が短すぎる (1 文字) ときは出さない */
export function nearNames(query: string, names: readonly string[], limit = 3): string[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const n = fold(name);
    if (!n) continue;
    // 検索語を 2 文字ずつに分けて、名前に含まれる割合 (語の一部だけ合うものを拾う)
    const grams = Array.from({ length: q.length - 1 }, (_, i) => q.slice(i, i + 2));
    const common = grams.filter((g) => n.includes(g)).length / grams.length;
    const dist = editDistance(q, n, Math.max(2, Math.floor(q.length / 2)));
    const near = dist <= Math.max(2, Math.floor(q.length / 2));
    if (common >= 0.5 || near) scored.push({ name, score: common * 10 - dist });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ja"));
  return scored.slice(0, limit).map((s) => s.name);
}
