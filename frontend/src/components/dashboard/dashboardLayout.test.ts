import { describe, it, expect } from "vitest";
import { movePanel, panelKeyAction, resizePanel, type PanelItem } from "./dashboardLayout";

const layout: PanelItem[] = [
  { i: "a", x: 0, y: 0, w: 6, h: 3, minW: 4, minH: 3, maxW: 8 },
  { i: "b", x: 6, y: 0, w: 6, h: 4 },
];

describe("movePanel", () => {
  it("1 マスずつ動かし、ほかのパネルは変えない", () => {
    const r = movePanel(layout, "a", 1, 2, 12);
    expect(r[0]).toMatchObject({ x: 1, y: 2 });
    expect(r[1]).toBe(layout[1]);
  });
  it("左端・上端・右端 (列数 − 幅) を越えない。動かせなければ同じ配列の要素のまま", () => {
    expect(movePanel(layout, "a", -1, -1, 12)[0]).toBe(layout[0]);
    expect(movePanel(layout, "b", 1, 0, 12)[1]).toBe(layout[1]);
    expect(movePanel(layout, "a", 99, 0, 12)[0].x).toBe(6);
  });
  it("列数が少ない幅 (スマホ幅など) でも、はみ出さない", () => {
    expect(movePanel([{ i: "a", x: 0, y: 0, w: 4, h: 2 }], "a", 5, 0, 6)[0].x).toBe(2);
  });
});

describe("resizePanel", () => {
  it("最小・最大の大きさに収める", () => {
    expect(resizePanel(layout, "a", -9, -9, 12)[0]).toMatchObject({ w: 4, h: 3 });
    expect(resizePanel(layout, "a", 9, 0, 12)[0].w).toBe(8);
  });
  it("右端 (列数) を越えて広げない", () => {
    expect(resizePanel(layout, "b", 3, 1, 12)[1]).toMatchObject({ w: 6, h: 5 });
  });
  it("変わらなければ同じ要素のまま。知らない ID は何もしない", () => {
    expect(resizePanel(layout, "b", 0, 0, 12)[1]).toBe(layout[1]);
    expect(resizePanel(layout, "zzz", 1, 1, 12)).toEqual(layout);
  });
});

describe("panelKeyAction", () => {
  const k = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...o });
  it("Alt+矢印 = 移動、Alt+Shift+矢印 = 大きさ", () => {
    expect(panelKeyAction(k("ArrowLeft", { altKey: true }))).toEqual({ kind: "move", dx: -1, dy: 0 });
    expect(panelKeyAction(k("ArrowDown", { altKey: true, shiftKey: true }))).toEqual({ kind: "resize", dx: 0, dy: 1 });
  });
  it("Alt が無い・Ctrl 付き・矢印以外は対象外", () => {
    expect(panelKeyAction(k("ArrowLeft"))).toBeNull();
    expect(panelKeyAction(k("ArrowLeft", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(panelKeyAction(k("a", { altKey: true }))).toBeNull();
  });
});
