/**
 * 補完で選んだ候補の履歴 (ブラウザ内だけ。設計の中身には入れない)。
 *
 * よく使う候補・直近に使った候補を、同じ一致の強さの中で上位に出すために使う。
 */
import type { Candidate } from "./reference-completer/types";

const STORAGE_KEY = "harmony.completionHistory";
const MAX_PER_RESOLVER = 200;
const DAY = 24 * 60 * 60 * 1000;

interface Entry { n: number; t: number }
type History = Record<string, Record<string, Entry>>;

function load(): History {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as History) : {};
  } catch {
    return {};
  }
}

function save(h: History): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
  } catch {
    /* 保存できなくても補完は使える */
  }
}

/** 候補を選んだことを覚える。 */
export function recordCompletionPick(resolverId: string, value: string, now = Date.now()): void {
  const h = load();
  const bucket = (h[resolverId] ??= {});
  const prev = bucket[value];
  bucket[value] = { n: (prev?.n ?? 0) + 1, t: now };
  const keys = Object.keys(bucket);
  if (keys.length > MAX_PER_RESOLVER) {
    keys.sort((a, b) => bucket[a].t - bucket[b].t);
    for (const k of keys.slice(0, keys.length - MAX_PER_RESOLVER)) delete bucket[k];
  }
  save(h);
}

/** 履歴の点数: 使った回数 + 直近 1 日以内なら加点。履歴が無ければ 0。 */
export function historyScore(entry: Entry | undefined, now = Date.now()): number {
  if (!entry) return 0;
  return entry.n + (now - entry.t < DAY ? 3 : 0);
}

/**
 * 同じ一致の強さの候補どうしを、履歴の点数が高い順に並べ替える。履歴が無い候補は元の順のまま。
 * rankOf は一致の強さ (小さいほど強い)。一致の強さの順は崩さない。
 */
export function applyCompletionHistory(
  resolverId: string,
  candidates: Candidate[],
  rankOf: (c: Candidate) => number,
  now = Date.now(),
): Candidate[] {
  const bucket = load()[resolverId];
  if (!bucket || candidates.length < 2) return candidates;
  return candidates
    .map((c, i) => ({ c, i, r: rankOf(c), s: historyScore(bucket[c.value], now) }))
    .sort((a, b) => a.r - b.r || b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
