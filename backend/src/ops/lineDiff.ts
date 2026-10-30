/**
 * 行の差分 (unified diff) と、README の節の切り出し。開発コンテナの雛形の更新 (ops/scaffold.ts) が、人に見せる差分と節の範囲を AI に渡すために使う (#1577)。
 *
 * - リポジトリには行の差分の道具が無いので、小さな LCS (最長共通部分列) の行差分を持つ。前後 3 行の文脈つき、`--- a/<path>` `+++ b/<path>` `@@ -l,n +l,n @@` の形
 * - 改行は LF にそろえてから比べる。末尾の改行の有無の違いは `\ No newline at end of file` で示す
 * - 片方が MAX_DIFF_LINES 行を超えるときは作らない (LCS の表が大きくなりすぎるため。呼ぶ側が `tooLarge` を返す)
 */

/** 行差分を作る行数の上限 (片方でも超えたら作らない) */
export const MAX_DIFF_LINES = 3000;
const CONTEXT = 3;

const lf = (s: string): string => s.replace(/\r\n/g, "\n");
/** 行ごとに分ける (各行は末尾の改行つき。最終行に改行が無ければ、つかない) */
const tokens = (s: string): string[] => lf(s).match(/[^\n]*\n|[^\n]+$/g) ?? [];

type Op = { t: " " | "-" | "+"; s: string };

/** LCS で、a → b の編集列を作る (共通の先頭・末尾は先に除く) */
function editScript(a: string[], b: string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail), bm = b.slice(head, b.length - tail);
  const n = am.length, m = bm.length, w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const ops: Op[] = a.slice(0, head).map((s) => ({ t: " ", s }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) { ops.push({ t: " ", s: am[i] }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ t: "-", s: am[i++] });
    else ops.push({ t: "+", s: bm[j++] });
  }
  while (i < n) ops.push({ t: "-", s: am[i++] });
  while (j < m) ops.push({ t: "+", s: bm[j++] });
  for (const s of a.slice(a.length - tail)) ops.push({ t: " ", s });
  return ops;
}

export interface LineDiff { diff: string; tooLarge: boolean; changed: boolean }

/** a → b の unified diff。同じなら diff は空文字。`path` は `--- a/<path>` `+++ b/<path>` に入れる */
export function unifiedDiff(a: string, b: string, path: string): LineDiff {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length > MAX_DIFF_LINES || tb.length > MAX_DIFF_LINES) return { diff: "", tooLarge: true, changed: lf(a) !== lf(b) };
  const ops = editScript(ta, tb);
  const changes = ops.map((o, i) => (o.t === " " ? -1 : i)).filter((i) => i >= 0);
  if (!changes.length) return { diff: "", tooLarge: false, changed: false };
  // 変更の周りの前後 CONTEXT 行を 1 つの hunk にし、文脈が重なる・隣り合うものはまとめる
  const hunks: Array<[number, number]> = [];
  for (const c of changes) {
    const from = Math.max(0, c - CONTEXT), to = Math.min(ops.length, c + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to); else hunks.push([from, to]);
  }
  // 各 op の手前までの a / b の行数
  const aBefore: number[] = [], bBefore: number[] = [];
  let ai = 0, bi = 0;
  for (const o of ops) { aBefore.push(ai); bBefore.push(bi); if (o.t !== "+") ai++; if (o.t !== "-") bi++; }
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const [from, to] of hunks) {
    const slice = ops.slice(from, to);
    const aCount = slice.filter((o) => o.t !== "+").length, bCount = slice.filter((o) => o.t !== "-").length;
    // 行数が 0 のときの開始は、その直前の行番号 (unified diff の決まり)
    const aStart = aCount === 0 ? aBefore[from] : aBefore[from] + 1, bStart = bCount === 0 ? bBefore[from] : bBefore[from] + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const o of slice) {
      out.push(`${o.t}${o.s.endsWith("\n") ? o.s.slice(0, -1) : o.s}`);
      if (!o.s.endsWith("\n")) out.push("\\ No newline at end of file");
    }
  }
  return { diff: out.join("\n") + "\n", tooLarge: false, changed: true };
}

/** バイト数の上限で、行の境界で切る (切った行は残さない)。日本語の途中では切れない */
export function cutLines(s: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(s) <= maxBytes) return { text: s, truncated: false };
  let used = 0;
  const kept: string[] = [];
  for (const line of s.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    used += Buffer.byteLength(line);
    if (used > maxBytes) break;
    kept.push(line);
  }
  return { text: kept.join(""), truncated: true };
}

// ── README の節 ───────────────────────────────────────────────────────

export interface SectionSlice {
  /** 節の見出しの行 (例: `## 開発環境`) */
  heading: string;
  /** 節の本文 (見出しから、同じか上のレベルの次の見出しの前まで。末尾の空行は除く。改行は LF) */
  text: string;
  /** README の中の位置 (1 始まり、両端を含む) */
  startLine: number;
  endLine: number;
}

const HEADING = /^(#{1,6})[ \t]+\S/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** コードブロックの外にある見出しの行 (行番号は 0 始まり) とレベル */
function headingsOf(lines: string[]): Array<{ at: number; level: number; line: string }> {
  const out: Array<{ at: number; level: number; line: string }> = [];
  let fence: string | null = null;
  lines.forEach((line, at) => {
    const f = FENCE.exec(line);
    if (f) { fence = fence === null ? f[1] : fence === f[1] ? null : fence; return; }
    if (fence) return;
    const h = HEADING.exec(line);
    if (h) out.push({ at, level: h[1].length, line: line.trimEnd() });
  });
  return out;
}

/** snippet の最初の見出し (最初の空でない行が見出しのときだけ)。無ければ null */
export function snippetHeading(snippet: string): { line: string; level: number } | null {
  const first = lf(snippet).split("\n").find((l) => l.trim());
  const h = first ? HEADING.exec(first) : null;
  return first && h ? { line: first.trimEnd(), level: h[1].length } : null;
}

/** README から、snippet の見出しと同じ行の節を切り出す。見出しが無い・README に節が無いときは null */
export function extractSection(readme: string, snippet: string): SectionSlice | null {
  const want = snippetHeading(snippet);
  if (!want) return null;
  const lines = lf(readme).split("\n");
  const heads = headingsOf(lines);
  const idx = heads.findIndex((h) => h.line === want.line);
  if (idx < 0) return null;
  const start = heads[idx].at;
  const next = heads.slice(idx + 1).find((h) => h.level <= heads[idx].level);
  let end = (next ? next.at : lines.length) - 1;
  while (end > start && !lines[end].trim()) end--;
  return { heading: lines[start].trimEnd(), text: lines.slice(start, end + 1).join("\n"), startLine: start + 1, endLine: end + 1 };
}
