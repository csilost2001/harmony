import { describe, it, expect } from "vitest";
import { layoutWithGroups, neighborIds, viewportShows, alignNodes, distributeNodes, layeredLayout, neighborhood, searchNodeIds, snapToOthers, type GeomNode } from "./diagramGeom";

const n = (id: string, x: number, y: number, w = 100, h = 50): GeomNode => ({ id, x, y, w, h });

describe("alignNodes (続編 第 7 弾 #121)", () => {
  const nodes = [n("a", 0, 0, 100, 50), n("b", 40, 100, 60, 30), n("c", 200, 40, 80, 80)];
  it("左・右・上・下・中央にそろえる", () => {
    expect(alignNodes(nodes, "left").get("b")).toEqual({ x: 0, y: 100 });
    expect(alignNodes(nodes, "left").has("a")).toBe(false); // 動かないものは返さない
    expect(alignNodes(nodes, "right").get("a")).toEqual({ x: 180, y: 0 });
    expect(alignNodes(nodes, "top").get("c")).toEqual({ x: 200, y: 0 });
    expect(alignNodes(nodes, "bottom").get("a")).toEqual({ x: 0, y: 80 });
    expect(alignNodes(nodes, "center").get("a")).toEqual({ x: 90, y: 0 });
    expect(alignNodes(nodes, "middle").get("b")).toEqual({ x: 40, y: 50 });
  });
  it("1 つだけなら何もしない", () => { expect(alignNodes([n("a", 5, 5)], "left").size).toBe(0); });
});

describe("distributeNodes", () => {
  it("両端を動かさず、すき間を等しくする", () => {
    const r = distributeNodes([n("a", 0, 0), n("b", 120, 0), n("c", 400, 0)], "x");
    // 全体 500、幅の合計 300、すき間 100 ずつ → b は 200
    expect(r.get("b")).toEqual({ x: 200, y: 0 });
    expect(r.has("a")).toBe(false);
    expect(r.has("c")).toBe(false);
  });
  it("縦も。2 つ以下は何もしない", () => {
    expect(distributeNodes([n("a", 0, 0), n("b", 0, 10), n("c", 0, 250)], "y").get("b")).toEqual({ x: 0, y: 125 });
    expect(distributeNodes([n("a", 0, 0), n("b", 9, 9)], "x").size).toBe(0);
  });
});

describe("snapToOthers", () => {
  const others = [n("o", 300, 200, 100, 50)];
  it("しきい値以内なら端・中央に吸い付き、そろった線を返す", () => {
    const r = snapToOthers(n("d", 297, 120), others, 6);
    expect(r.x).toBe(300);
    expect(r.vertical).toContain(300);
  });
  it("遠ければ動かさない", () => {
    const r = snapToOthers(n("d", 100, 100), others, 6);
    expect(r).toMatchObject({ x: 100, y: 100, vertical: [], horizontal: [] });
  });
  it("縦も吸い付く (中央どうし)", () => {
    const r = snapToOthers(n("d", 10, 203, 100, 50), others, 6);
    expect(r.y).toBe(200);
    expect(r.horizontal).toContain(200);
  });
});

describe("neighborhood", () => {
  const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "d", target: "c" }, { source: "x", target: "y" }];
  it("向きを問わず depth 段まで", () => {
    expect([...neighborhood(edges, ["a"], 1)].sort()).toEqual(["a", "b"]);
    expect([...neighborhood(edges, ["a"], 2)].sort()).toEqual(["a", "b", "c"]);
    expect([...neighborhood(edges, ["c"], 1)].sort()).toEqual(["b", "c", "d"]);
    expect([...neighborhood(edges, ["a"], 9)].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("depth 0・つながりの無いノードは自分だけ", () => {
    expect([...neighborhood(edges, ["a"], 0)]).toEqual(["a"]);
    expect([...neighborhood(edges, ["z"], 3)]).toEqual(["z"]);
  });
});

describe("searchNodeIds", () => {
  const items = [{ id: "t1", texts: ["顧客マスタ", "customers"] }, { id: "t2", texts: ["注文", "orders"] }, { id: "t3", texts: ["ＯＲＤＥＲ明細", "order_items"] }];
  it("名前・ID の部分一致 (全角半角・大文字小文字・かな無視)、空白は AND", () => {
    expect(searchNodeIds(items, "order")).toEqual(["t2", "t3"]);
    expect(searchNodeIds(items, "order 明細")).toEqual(["t3"]);
    expect(searchNodeIds(items, "ますた")).toEqual(["t1"]);
    expect(searchNodeIds(items, "")).toEqual([]);
  });
});

describe("layeredLayout (続編 第 7 弾 #126)", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((id) => n(id, 0, 0));
  it("つながりの向きに沿って左から右の層に並ぶ", () => {
    const pos = layeredLayout(nodes, [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "a", target: "d" }]);
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeLessThan(pos.get("c")!.x);
    expect(pos.get("d")!.x).toBe(pos.get("b")!.x); // a から 1 段
    expect(pos.get("b")!.y).not.toBe(pos.get("d")!.y); // 同じ層は縦に並ぶ
    expect(pos.get("e")!.x).toBe(0); // つながりの無いものは先頭の層
  });
  it("輪 (a→b→a) があっても止まり、全ノードが置かれる", () => {
    const pos = layeredLayout(nodes.slice(0, 3), [{ source: "a", target: "b" }, { source: "b", target: "a" }, { source: "b", target: "c" }]);
    expect(pos.size).toBe(3);
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
  });
  it("同じ入力は同じ配置 (決まった結果)", () => {
    const e = [{ source: "a", target: "c" }, { source: "b", target: "c" }];
    expect([...layeredLayout(nodes, e)]).toEqual([...layeredLayout(nodes, e)]);
  });
  it("存在しないノードへの辺・自己ループは無視", () => {
    const pos = layeredLayout(nodes.slice(0, 2), [{ source: "a", target: "zzz" }, { source: "a", target: "a" }]);
    expect(pos.size).toBe(2);
  });
});

describe("viewportShows", () => {
  const bounds = { x: 0, y: 0, width: 400, height: 300 };
  const size = { width: 1000, height: 600 };
  it("図が画面に入っていれば true、画面の外に出ていれば false", () => {
    expect(viewportShows({ x: 100, y: 100, zoom: 1 }, bounds, size)).toBe(true);
    expect(viewportShows({ x: 900, y: 100, zoom: 1 }, bounds, size)).toBe(true); // 一部だけでも
    expect(viewportShows({ x: 1200, y: 100, zoom: 1 }, bounds, size)).toBe(false);
    expect(viewportShows({ x: -500, y: 0, zoom: 1 }, bounds, size)).toBe(false);
    expect(viewportShows({ x: 0, y: 0, zoom: 0.01 }, { x: 5000, y: 5000, width: 100, height: 100 }, size)).toBe(true);
  });
});

describe("neighborIds (続編 第 7 弾 #139)", () => {
  const edges = [{ source: "a", target: "c" }, { source: "b", target: "a" }, { source: "a", target: "a" }, { source: "c", target: "d" }];
  it("向きを問わず、直接つながるノードを返す (自己ループ・重複なし)", () => {
    expect(neighborIds(edges, "a")).toEqual(["b", "c"]);
    expect(neighborIds(edges, "c")).toEqual(["a", "d"]);
    expect(neighborIds(edges, "z")).toEqual([]);
  });
  it("順を渡せば、その順", () => {
    expect(neighborIds(edges, "a", ["c", "b"])).toEqual(["c", "b"]);
  });
});

describe("layoutWithGroups (続編 第 7 弾 #126)", () => {
  const g = (id: string, x: number, y: number, w = 400, h = 300) => ({ id, x, y, w, h, isGroup: true });
  const s = (id: string, parentId?: string) => ({ id, x: 0, y: 0, w: 120, h: 60, ...(parentId ? { parentId } : {}) });
  const nodes = [g("g1", 100, 100), g("g2", 100, 500), s("a", "g1"), s("b", "g1"), s("c", "g2"), s("solo")];
  const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "solo" }];
  const pos = layoutWithGroups(nodes, edges);
  it("グループと、グループに入っていない画面を、つながりの向きに階層配置する", () => {
    expect(pos.get("g1")!.x).toBeLessThan(pos.get("g2")!.x); // g1 → g2 (b → c)
    expect(pos.get("g2")!.x).toBeLessThan(pos.get("solo")!.x);
    // 原点は、いまの最上位の左上
    expect(Math.min(...["g1", "g2", "solo"].map((id) => pos.get(id)!.x))).toBe(0);
  });
  it("グループの中の画面は、グループの左上から、遷移の向きに並ぶ (グループの枠の中に収まる)", () => {
    const a = pos.get("a")!, b = pos.get("b")!;
    expect(a.x).toBeGreaterThanOrEqual(24);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x + 120).toBeLessThanOrEqual(400);
    expect(Math.max(a.y, b.y) + 60).toBeLessThanOrEqual(300);
  });
  it("枠に入りきらないときは、間隔を縮めて収める", () => {
    const many = [g("big", 0, 0, 260, 200), ...["a", "b", "c", "d"].map((id) => s(id, "big"))];
    const chain = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "d" }];
    const p = layoutWithGroups(many, chain);
    for (const id of ["a", "b", "c", "d"]) expect(p.get(id)!.x).toBeGreaterThanOrEqual(24);
    // 縮めた結果、右端がはみ出しすぎない (縮小率の下限 0.3 で、画面の幅 120 を越えて重ならないことまでは求めない)
    expect(p.get("d")!.x).toBeLessThan(260);
  });
  it("グループが無くても動く / 空でも動く", () => {
    expect(layoutWithGroups([s("x"), s("y")], [{ source: "x", target: "y" }]).get("x")!.x).toBeLessThan(layoutWithGroups([s("x"), s("y")], [{ source: "x", target: "y" }]).get("y")!.x);
    expect(layoutWithGroups([], []).size).toBe(0);
  });
});
