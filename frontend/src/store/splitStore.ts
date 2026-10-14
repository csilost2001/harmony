/**
 * 並べて表示 (右ペイン) の状態。ワークスペースごとに、右に出している画面 (URL のパス) と呼び名を持つ。
 * このブラウザのタブの中だけ (sessionStorage)。タブの記録 (localStorage) とは別で、ほかのブラウザのタブへは伝わらない。
 */
import { useSyncExternalStore } from "react";

export interface SplitTarget {
  /** ワークスペースの下のパス (例: /table/edit/orders)。先頭は / で、ワークスペースの部分 (/w/<id>) は含めない */
  path: string;
  label: string;
  /** どのタブから開いたか (そのタブを左で開いたら、右ペインを閉じる) */
  tabId: string | null;
}

const KEY_PREFIX = "harmony.split:";
const listeners = new Set<() => void>();
const cache = new Map<string, SplitTarget | null>();
const keyOf = (wsId: string | undefined) => `${KEY_PREFIX}${wsId ?? "default"}`;

export function parseSplit(raw: string | null): SplitTarget | null {
  try {
    const v = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return null;
    if (typeof v.path !== "string" || !v.path.startsWith("/") || v.path.startsWith("//") || v.path.length > 2000) return null;
    return { path: v.path, label: typeof v.label === "string" && v.label ? v.label.slice(0, 80) : v.path, tabId: typeof v.tabId === "string" ? v.tabId : null };
  } catch { return null; }
}

export function getSplit(wsId: string | undefined): SplitTarget | null {
  const k = keyOf(wsId);
  if (cache.has(k)) return cache.get(k) ?? null;
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(k); } catch { /* 読めなければ、なし */ }
  const v = parseSplit(raw);
  cache.set(k, v);
  return v;
}

export function setSplit(wsId: string | undefined, target: SplitTarget | null): void {
  const k = keyOf(wsId);
  const next = target ? { path: target.path, label: target.label, tabId: target.tabId } : null;
  cache.set(k, next);
  try { if (next) sessionStorage.setItem(k, JSON.stringify(next)); else sessionStorage.removeItem(k); } catch { /* 保存できなくても、この画面の中では効く */ }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

export function useSplit(wsId: string | undefined): SplitTarget | null {
  return useSyncExternalStore(subscribe, () => getSplit(wsId), () => getSplit(wsId));
}

/** テスト用 */
export function _resetSplitCache(): void { cache.clear(); listeners.forEach((l) => l()); }
