import { describe, it, expect } from "vitest";
import type { LayoutNode } from "@harmony/shared";
import { resizeColumnPair, rightNeighborColumn, spanDeltaFromPixels } from "./layoutResize";

const nodes = (): LayoutNode[] => [{ id: "cols", type: "columns", children: [
  { id: "a", type: "column", props: { span: 4 }, children: [] },
  { id: "b", type: "column", props: { span: 8 }, children: [] },
  { id: "c", type: "column", children: [] },
] }];

describe("resizeColumnPair", () => {
  it("左の段を広げると、右隣が同じだけ狭くなる (合計は変わらない)", () => {
    expect(resizeColumnPair(nodes(), "a", 2)).toEqual({ leftId: "a", rightId: "b", leftSpan: 6, rightSpan: 6 });
    expect(resizeColumnPair(nodes(), "a", -2)).toEqual({ leftId: "a", rightId: "b", leftSpan: 2, rightSpan: 10 });
  });
  it("どちらの段も 1 より狭くならない", () => {
    expect(resizeColumnPair(nodes(), "a", 99)).toMatchObject({ leftSpan: 11, rightSpan: 1 });
    expect(resizeColumnPair(nodes(), "a", -99)).toMatchObject({ leftSpan: 1, rightSpan: 11 });
  });
  it("幅の指定が無い段は 6 として扱う", () => {
    expect(resizeColumnPair(nodes(), "b", 1)).toMatchObject({ leftSpan: 9, rightSpan: 5 });
  });
  it("最後の段・段でない部品は動かせない", () => {
    expect(resizeColumnPair(nodes(), "c", 1)).toBeNull();
    expect(resizeColumnPair(nodes(), "cols", 1)).toBeNull();
    expect(rightNeighborColumn(nodes(), "c")).toBeNull();
    expect(rightNeighborColumn(nodes(), "a")?.id).toBe("b");
  });
});

describe("spanDeltaFromPixels", () => {
  it("段の並びの幅 1200px・合計 12 なら、100px が 1 単位", () => {
    expect(spanDeltaFromPixels(100, 1200, 12)).toBe(1);
    expect(spanDeltaFromPixels(-249, 1200, 12)).toBe(-2);
    expect(spanDeltaFromPixels(40, 1200, 12)).toBe(0);
  });
  it("幅が 0 のときは動かさない", () => {
    expect(spanDeltaFromPixels(100, 0, 12)).toBe(0);
  });
});
