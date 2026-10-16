import { describe, it, expect, beforeEach } from "vitest";
import { addListView, hasFilter, loadListViews, normalizeView, parseListViews, removeListView, sameView, _resetListViewsForTests, LIST_VIEWS_MAX } from "./listViews";

beforeEach(() => { localStorage.clear(); _resetListViewsForTests(); });

const st = (query = "", facets: Record<string, string> = {}, sort: Array<{ columnKey: string; direction: "asc" | "desc" }> = []) => ({ query, facets, sort });

describe("保存した絞り込み (続編 第 6 弾 #101)", () => {
  it("名前を付けて保存し、読み戻せる。同じ名前は上書き", () => {
    addListView("w", "table-list", "マスタだけ", st("マスタ"));
    addListView("w", "table-list", "未完成", st("", { maturity: "draft" }));
    addListView("w", "table-list", "マスタだけ", st("マスタ2"));
    const v = loadListViews("w", "table-list");
    expect(v.map((x) => x.name)).toEqual(["未完成", "マスタだけ"]);
    expect(v[1].state.query).toBe("マスタ2");
  });
  it("ワークスペースと一覧ごとに分かれ、再読み込みしても残る", () => {
    addListView("w1", "a", "x", st("1"));
    addListView("w2", "a", "x", st("2"));
    addListView("w1", "b", "x", st("3"));
    _resetListViewsForTests();
    expect(loadListViews("w1", "a")[0].state.query).toBe("1");
    expect(loadListViews("w2", "a")[0].state.query).toBe("2");
    expect(loadListViews("w1", "b")[0].state.query).toBe("3");
  });
  it("名前が空なら保存しない / 削除できる / 上限を超えたら古いものから外れる", () => {
    expect(addListView("w", "l", "  ", st("a"))).toBeNull();
    for (let i = 0; i < LIST_VIEWS_MAX + 3; i++) addListView("w", "l", `n${i}`, st(`${i}`));
    const v = loadListViews("w", "l");
    expect(v).toHaveLength(LIST_VIEWS_MAX);
    expect(v[0].name).toBe("n3");
    removeListView("w", "l", v[0].id);
    expect(loadListViews("w", "l")).toHaveLength(LIST_VIEWS_MAX - 1);
  });
  it("壊れた保存値は空として扱う", () => {
    expect(parseListViews("{")).toEqual([]);
    expect(parseListViews('[{"id":1}]')).toEqual([]);
    expect(parseListViews('{"a":1}')).toEqual([]);
  });
  it("空の絞り込みを除いて比べる", () => {
    expect(normalizeView({ query: " a ", facets: { t: "", u: "x" } })).toEqual({ query: "a", facets: { u: "x" }, sort: [] });
    expect(sameView(st("a", { t: "" }), st("a"))).toBe(true);
    expect(sameView(st("a"), st("b"))).toBe(false);
    expect(sameView(st("a", {}, [{ columnKey: "n", direction: "asc" }]), st("a"))).toBe(false);
    expect(hasFilter(st())).toBe(false);
    expect(hasFilter(st("", { t: "x" }))).toBe(true);
  });
});
