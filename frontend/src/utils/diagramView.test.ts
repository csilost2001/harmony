import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { DEFAULT_DIAGRAM_VIEW, decorateDiagram, diffAgainst, fingerprint, makeBaseline, persistedPart, type DiagramConfig, type DiagramViewState } from "./diagramView";

const node = (id: string, extra: Partial<Node> = {}): Node => ({ id, position: { x: 0, y: 0 }, data: { name: id.toUpperCase() }, ...extra });
const edge = (id: string, source: string, target: string, data?: Record<string, unknown>): Edge => ({ id, source, target, ...(data ? { data } : {}) });
const cfg: DiagramConfig = { textsOf: (n) => [n.id, String((n.data as { name?: string }).name ?? "")], kindOfEdge: (e) => ((e.data as { physical?: boolean } | undefined)?.physical ? "physical" : "logical"), fingerprintOf: (n) => fingerprint(JSON.stringify(n.data)) };
const view = (v: Partial<DiagramViewState>): DiagramViewState => ({ ...DEFAULT_DIAGRAM_VIEW, ...v });

const nodes = [node("a", { selected: true }), node("b"), node("c"), node("d")];
const edges = [edge("ab", "a", "b", { physical: true }), edge("bc", "b", "c"), edge("cd", "c", "d")];

describe("decorateDiagram (続編 第 7 弾)", () => {
  it("何もしなければ、元の配列のまま", () => {
    const r = decorateDiagram(nodes, edges, view({}), cfg, null);
    expect(r.nodes).toBe(nodes);
    expect(r.edges).toBe(edges);
  });
  it("検索 (#122): 一致を強調し、ほかを薄くする", () => {
    const r = decorateDiagram(nodes, edges, view({ search: "b" }), cfg, null);
    expect(r.matchIds).toEqual(["b"]);
    expect(r.nodes.find((n) => n.id === "b")!.className).toContain("dgm-hit");
    expect(r.nodes.find((n) => n.id === "c")!.className).toContain("dgm-dim");
    expect(r.edges.find((e) => e.id === "cd")!.className).toContain("dgm-dim");
    expect(r.edges.find((e) => e.id === "ab")!.className ?? "").not.toContain("dgm-dim");
  });
  it("つながりの強調 (#123): 選んだノードから N 段だけ濃く", () => {
    const r = decorateDiagram(nodes, edges, view({ focus: 1 }), cfg, null);
    expect(r.nodes.filter((n) => (n.className ?? "").includes("dgm-focus")).map((n) => n.id)).toEqual(["a", "b"]);
    expect(r.nodes.find((n) => n.id === "d")!.className).toContain("dgm-dim");
    const r2 = decorateDiagram(nodes, edges, view({ focus: 2 }), cfg, null);
    expect(r2.nodes.filter((n) => (n.className ?? "").includes("dgm-focus")).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
  it("選んだノードが無ければ、つながりの強調は何もしない", () => {
    const r = decorateDiagram(nodes.map((n) => ({ ...n, selected: false })), edges, view({ focus: 1 }), cfg, null);
    expect(r.nodes.every((n) => !(n.className ?? "").includes("dgm"))).toBe(true);
  });
  it("関連 N 段への絞り込み (#124): 範囲の外のノードと、その線を隠す", () => {
    const r = decorateDiagram(nodes, edges, view({ scope: { ids: ["a"], depth: 1 } }), cfg, null);
    expect(r.nodes.filter((n) => n.hidden).map((n) => n.id)).toEqual(["c", "d"]);
    expect(r.edges.filter((e) => e.hidden).map((e) => e.id)).toEqual(["bc", "cd"]);
    expect(r.hiddenNodeCount).toBe(2);
  });
  it("線の種類の表示・非表示 (#140) と、線の形 (#130)", () => {
    const r = decorateDiagram(nodes, edges, view({ hiddenKinds: ["physical"], edgeShape: "step" }), cfg, null);
    expect(r.edges.find((e) => e.id === "ab")!.hidden).toBe(true);
    expect(r.edges.find((e) => e.id === "bc")!.hidden).toBeFalsy();
    expect(r.edges.every((e) => e.type === "step")).toBe(true);
    expect(r.hiddenEdgeCount).toBe(1);
  });
  it("ER のカラム表示 (#125): ER のノードの data に入る", () => {
    const er = [node("t", { type: "erTableNode" }), node("u")];
    const r = decorateDiagram(er, [], view({ columnMode: "keys" }), cfg, null);
    expect((r.nodes[0].data as { columnMode?: string }).columnMode).toBe("keys");
    expect((r.nodes[1].data as { columnMode?: string }).columnMode).toBeUndefined();
  });
  it("グループの折りたたみ (#131): 中身のノードと線を隠し、グループを小さくする", () => {
    const g = [node("grp", { type: "groupNode", style: { width: 400, height: 300 } }), node("s1", { parentId: "grp" }), node("s2", { parentId: "grp" }), node("out")];
    const e = [edge("x", "s1", "s2"), edge("y", "s2", "out")];
    const r = decorateDiagram(g, e, view({ collapsedGroups: ["grp"] }), { ...cfg, collapsedGroupHeight: 40 }, null);
    expect(r.nodes.filter((n) => n.hidden).map((n) => n.id)).toEqual(["s1", "s2"]);
    expect(r.edges.every((x) => x.hidden)).toBe(true);
    expect(r.nodes[0].style).toMatchObject({ width: 400, height: 40 });
    expect((r.nodes[0].data as { collapsed?: boolean }).collapsed).toBe(true);
  });
  it("読み上げ用の名前 (#139) を付ける", () => {
    const r = decorateDiagram(nodes, edges, view({}), { ...cfg, labelOf: (n) => `テーブル ${n.id}` }, null);
    expect(r.nodes[1].ariaLabel).toBe("テーブル b");
  });
});

describe("基準との差分 (#137)", () => {
  const base = makeBaseline(nodes, cfg, "2026-10-16T00:00:00Z");
  it("増えた・変わったノードに色の印、消えたものは一覧に", () => {
    const now = [node("a", { selected: true }), node("b", { data: { name: "B2" } }), node("e")];
    const d = diffAgainst(now, base, cfg);
    expect(d.kinds.get("b")).toBe("changed");
    expect(d.kinds.get("e")).toBe("added");
    expect(d.kinds.has("a")).toBe(false);
    expect(d.removed.map((r) => r.id).sort()).toEqual(["c", "d"]);
    const r = decorateDiagram(now, [], view({ diff: true }), cfg, base);
    expect(r.nodes.find((n) => n.id === "e")!.className).toContain("dgm-added");
    expect(r.nodes.find((n) => n.id === "b")!.className).toContain("dgm-changed");
    expect(r.diff!.removed).toHaveLength(2);
  });
  it("基準が無ければ差分は出さない", () => {
    expect(decorateDiagram(nodes, edges, view({ diff: true }), cfg, null).diff).toBeNull();
  });
});

describe("保存する見え方", () => {
  it("検索・強調・範囲・差分は保存しない", () => {
    expect(Object.keys(persistedPart(view({ search: "x", focus: 2, diff: true, edgeShape: "step" })))).toEqual(["edgeShape", "hiddenKinds", "columnMode", "collapsedGroups"]);
  });
  it("指紋は同じ入力なら同じ", () => { expect(fingerprint("abc")).toBe(fingerprint("abc")); expect(fingerprint("abc")).not.toBe(fingerprint("abd")); });
});
