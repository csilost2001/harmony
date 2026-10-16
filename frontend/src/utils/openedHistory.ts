/**
 * いつ開いたか (UI 改善提案 続編 第 6 弾 #111)。一覧の「最近開いた順」の並びに使う。
 * タブを開いた・切り替えたときに、タブの id (例: table:orders) ごとに時刻を覚える。このブラウザにだけ保存し、設計の原本には書かない。
 */
const KEY = "harmony-opened-at";
const MAX = 400;

let cache: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const out: Record<string, number> = {};
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, t] of Object.entries(v)) if (typeof t === "number" && Number.isFinite(t)) out[k] = t;
    cache = out;
  } catch { cache = {}; }
  return cache!;
}

/** タブ id を「いま開いた」と覚える。多くなったら古いものから捨てる */
export function recordOpened(tabId: string, now: number = Date.now()): void {
  if (!tabId) return;
  const m = load();
  m[tabId] = now;
  const keys = Object.keys(m);
  if (keys.length > MAX) for (const k of keys.sort((a, b) => m[a] - m[b]).slice(0, keys.length - MAX)) delete m[k];
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 保存できなくても、この画面の中では効く */ }
}

/** 最後に開いた時刻 (ミリ秒)。開いたことが無ければ 0 */
export function openedAtOf(tabId: string): number {
  return load()[tabId] ?? 0;
}

/** 覚えた時刻をすべて消す (ワークスペースを切り替えるとき) */
export function clearOpenedHistory(): void {
  cache = null;
  try { localStorage.removeItem(KEY); } catch { /* 消せなくても動作は妨げない */ }
}

/** テスト専用 */
export function _resetOpenedForTests(): void { cache = null; }
