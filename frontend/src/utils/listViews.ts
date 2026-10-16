/**
 * 一覧の「保存した絞り込み」(UI 改善提案 続編 第 6 弾 #101 #105)。
 * 検索語・絞り込み (種別・成熟度など)・並びの組に名前を付けて、ワークスペースと一覧ごとにブラウザへ覚える。
 * 設計の原本には書かない (お気に入りと同じ置き場)。
 */
import { useSyncExternalStore } from "react";

export interface ListViewSortKey { columnKey: string; direction: "asc" | "desc" }

export interface ListViewState {
  /** 検索語 */
  query: string;
  /** 検索語以外の絞り込み (キー → 値。空の値は「絞っていない」) */
  facets: Record<string, string>;
  sort: ListViewSortKey[];
}

export interface SavedListView { id: string; name: string; state: ListViewState }

export const LIST_VIEWS_MAX = 12;
export const LIST_VIEW_NAME_MAX = 24;
const PREFIX = "harmony-list-views:";

const listeners = new Set<() => void>();
const cache = new Map<string, readonly SavedListView[]>();
const keyOf = (wsId: string | undefined, listKey: string) => `${PREFIX}${wsId ?? "default"}:${listKey}`;

/** 空の値の絞り込みを除いた形にそろえる (比較・保存のため) */
export function normalizeView(state: Partial<ListViewState>): ListViewState {
  const facets: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.facets ?? {})) if (typeof v === "string" && v !== "") facets[k] = v;
  return {
    query: (state.query ?? "").trim(),
    facets,
    sort: (state.sort ?? []).filter((s) => s && typeof s.columnKey === "string" && (s.direction === "asc" || s.direction === "desc")).map((s) => ({ columnKey: s.columnKey, direction: s.direction })),
  };
}

/** 何も絞っていない (検索語も絞り込みも無い) */
export function hasFilter(state: ListViewState): boolean {
  return state.query !== "" || Object.keys(state.facets).length > 0;
}

/** 検索語・絞り込み・並びが同じか */
export function sameView(a: ListViewState, b: ListViewState): boolean {
  return JSON.stringify(normalizeView(a)) === JSON.stringify(normalizeView(b));
}

export function parseListViews(raw: string | null): SavedListView[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    const out: SavedListView[] = [];
    for (const x of v) {
      if (!x || typeof x.id !== "string" || typeof x.name !== "string" || !x.name || typeof x.state !== "object" || !x.state) continue;
      out.push({ id: x.id, name: x.name.slice(0, LIST_VIEW_NAME_MAX), state: normalizeView(x.state) });
    }
    return out.slice(0, LIST_VIEWS_MAX);
  } catch { return []; }
}

export function loadListViews(wsId: string | undefined, listKey: string): readonly SavedListView[] {
  const k = keyOf(wsId, listKey);
  const hit = cache.get(k);
  if (hit) return hit;
  let raw: string | null = null;
  try { raw = localStorage.getItem(k); } catch { /* 読めなければ空 */ }
  const v = parseListViews(raw);
  cache.set(k, v);
  return v;
}

function save(wsId: string | undefined, listKey: string, next: readonly SavedListView[]): void {
  const k = keyOf(wsId, listKey);
  cache.set(k, next);
  try { if (next.length === 0) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(next)); } catch { /* 保存できなくても、この画面の中では効く */ }
  listeners.forEach((l) => l());
}

/** 名前を付けて保存する。同じ名前があれば上書き。名前が空なら何もしない。上限を超えたら古いものから外れる */
export function addListView(wsId: string | undefined, listKey: string, name: string, state: ListViewState): SavedListView | null {
  const n = name.trim().slice(0, LIST_VIEW_NAME_MAX);
  if (!n) return null;
  const cur = loadListViews(wsId, listKey);
  const same = cur.find((v) => v.name === n);
  const view: SavedListView = { id: same?.id ?? `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: n, state: normalizeView(state) };
  save(wsId, listKey, [...cur.filter((v) => v.name !== n), view].slice(-LIST_VIEWS_MAX));
  return view;
}

export function removeListView(wsId: string | undefined, listKey: string, id: string): void {
  save(wsId, listKey, loadListViews(wsId, listKey).filter((v) => v.id !== id));
}

export function useListViews(wsId: string | undefined, listKey: string): readonly SavedListView[] {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => loadListViews(wsId, listKey),
    () => loadListViews(wsId, listKey),
  );
}

/** テスト専用 */
export function _resetListViewsForTests(): void { cache.clear(); listeners.clear(); }
