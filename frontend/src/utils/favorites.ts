/**
 * お気に入り (よく使う設計の固定)。クイックオープンの候補のキー (`<種類>:<id>`) を、ワークスペースごとに持つ。
 * ブラウザごとの設定 (localStorage) で、設計の原本には関係しない。タブの「ピン留め」(タブの並びの固定) とは別。
 */
import { useSyncExternalStore } from "react";
import type { TabItem } from "../store/tabStore";

export const FAVORITES_MAX = 30;
const PREFIX = "harmony-favorites:";

const listeners = new Set<() => void>();
const cache = new Map<string, readonly string[]>();
const keyOf = (wsId: string | undefined) => `${PREFIX}${wsId ?? "default"}`;

/** 保存値を読む。壊れた値・文字列でないものは捨てる (重複も除く) */
export function parseFavorites(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((k): k is string => typeof k === "string" && k.includes(":")))].slice(0, FAVORITES_MAX);
  } catch { return []; }
}

export function loadFavorites(wsId: string | undefined): readonly string[] {
  const k = keyOf(wsId);
  const hit = cache.get(k);
  if (hit) return hit;
  let raw: string | null = null;
  try { raw = localStorage.getItem(k); } catch { /* 読めなければ空 */ }
  const v = parseFavorites(raw);
  cache.set(k, v);
  return v;
}

function save(wsId: string | undefined, next: readonly string[]): void {
  const k = keyOf(wsId);
  cache.set(k, next);
  try { if (next.length === 0) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(next)); } catch { /* 保存できなくても、この画面の中では効く */ }
  listeners.forEach((l) => l());
}

/** 同じ設計を指す候補のキー (ガジェットは画面と同じタブで開くので、どちらの印でも同じものとして扱う) */
export function equivalentKeys(key: string): string[] {
  if (key.startsWith("screen:")) return [key, `gadget:${key.slice("screen:".length)}`];
  if (key.startsWith("gadget:")) return [key, `screen:${key.slice("gadget:".length)}`];
  return [key];
}

export function isFavorite(wsId: string | undefined, key: string): boolean {
  const fav = loadFavorites(wsId);
  return equivalentKeys(key).some((k) => fav.includes(k));
}

/** お気に入りの追加 / 解除。追加は先頭へ。上限を超えたら、いちばん古いものから外れる。追加したら true */
export function toggleFavorite(wsId: string | undefined, key: string): boolean {
  const fav = loadFavorites(wsId);
  const same = equivalentKeys(key);
  if (fav.some((k) => same.includes(k))) {
    save(wsId, fav.filter((k) => !same.includes(k)));
    return false;
  }
  save(wsId, [key, ...fav].slice(0, FAVORITES_MAX));
  return true;
}

/** お気に入りを、指定のとおりにする (すでにそうなら何もしない)。まとめての操作用 */
export function setFavorite(wsId: string | undefined, key: string, on: boolean): void {
  if (on) { if (!isFavorite(wsId, key)) toggleFavorite(wsId, key); }
  else removeFavorite(wsId, key);
}

export function removeFavorite(wsId: string | undefined, key: string): void {
  const same = equivalentKeys(key);
  const fav = loadFavorites(wsId);
  if (fav.some((k) => same.includes(k))) save(wsId, fav.filter((k) => !same.includes(k)));
}

export function subscribeFavorites(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith(PREFIX)) { cache.delete(e.key); l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export function useFavorites(wsId: string | undefined): readonly string[] {
  return useSyncExternalStore(subscribeFavorites, () => loadFavorites(wsId), () => loadFavorites(wsId));
}

/** テスト用: 読み込み済みの値を捨てる */
export function _resetFavoritesCache(): void { cache.clear(); }

/** タブが指す設計の、候補のキー。設計以外のタブ (一覧・ダッシュボードなど) は null */
export function tabFavoriteKey(tab: Pick<TabItem, "type" | "resourceId"> | null | undefined): string | null {
  if (!tab) return null;
  switch (tab.type) {
    case "design": return `screen:${tab.resourceId}`;
    case "screen-items": return `screen-items:${tab.resourceId}`;
    case "table": case "process-flow": case "sequence": case "view": case "view-definition": case "page-layout": case "business-flow": case "report":
      return `${tab.type}:${tab.resourceId}`;
    default: return null;
  }
}
