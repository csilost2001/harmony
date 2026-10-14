import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FAVORITES_MAX, _resetFavoritesCache, equivalentKeys, isFavorite, loadFavorites, parseFavorites, removeFavorite,
  subscribeFavorites, tabFavoriteKey, toggleFavorite,
} from "./favorites";

beforeEach(() => { localStorage.clear(); _resetFavoritesCache(); });

describe("お気に入り", () => {
  it("追加は先頭へ、もう一度で解除。ワークスペースごとに別", () => {
    expect(toggleFavorite("a", "table:orders")).toBe(true);
    expect(toggleFavorite("a", "screen:cart")).toBe(true);
    expect(loadFavorites("a")).toEqual(["screen:cart", "table:orders"]);
    expect(loadFavorites("b")).toEqual([]);
    expect(toggleFavorite("a", "table:orders")).toBe(false);
    expect(loadFavorites("a")).toEqual(["screen:cart"]);
    expect(isFavorite("a", "screen:cart")).toBe(true);
    expect(isFavorite("b", "screen:cart")).toBe(false);
  });

  it("保存して読み直しても残る。壊れた保存値は空として読む", () => {
    toggleFavorite("a", "report:rp1");
    _resetFavoritesCache();
    expect(loadFavorites("a")).toEqual(["report:rp1"]);
    expect(parseFavorites("{broken")).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    expect(parseFavorites('["table:x", 5, "no-colon", "table:x"]')).toEqual(["table:x"]);
  });

  it("上限を超えたら、いちばん古いものから外れる", () => {
    for (let i = 0; i < FAVORITES_MAX + 3; i++) toggleFavorite("a", `table:t${i}`);
    const fav = loadFavorites("a");
    expect(fav).toHaveLength(FAVORITES_MAX);
    expect(fav[0]).toBe(`table:t${FAVORITES_MAX + 2}`);
    expect(fav).not.toContain("table:t0");
  });

  it("ガジェットと画面は同じ設計として扱う (どちらの印でも固定・解除できる)", () => {
    expect(equivalentKeys("screen:g1")).toEqual(["screen:g1", "gadget:g1"]);
    toggleFavorite("a", "gadget:g1");
    expect(isFavorite("a", "screen:g1")).toBe(true);
    expect(toggleFavorite("a", "screen:g1")).toBe(false);
    expect(loadFavorites("a")).toEqual([]);
  });

  it("removeFavorite は、無いものを外しても何も起こさない。変化は購読者に届く", () => {
    const l = vi.fn();
    const off = subscribeFavorites(l);
    removeFavorite("a", "table:none");
    expect(l).not.toHaveBeenCalled();
    toggleFavorite("a", "table:x");
    expect(l).toHaveBeenCalledTimes(1);
    removeFavorite("a", "table:x");
    expect(l).toHaveBeenCalledTimes(2);
    off();
  });

  it("タブから候補のキーを作る (設計のタブだけ)", () => {
    expect(tabFavoriteKey({ type: "design", resourceId: "cart" })).toBe("screen:cart");
    expect(tabFavoriteKey({ type: "screen-items", resourceId: "cart" })).toBe("screen-items:cart");
    expect(tabFavoriteKey({ type: "table", resourceId: "orders" })).toBe("table:orders");
    expect(tabFavoriteKey({ type: "process-flow", resourceId: "pf" })).toBe("process-flow:pf");
    expect(tabFavoriteKey({ type: "table-list", resourceId: "main" })).toBeNull();
    expect(tabFavoriteKey({ type: "dashboard", resourceId: "main" })).toBeNull();
    expect(tabFavoriteKey(null)).toBeNull();
  });
});
