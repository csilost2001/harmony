import { describe, it, expect } from "vitest";
import { pickEdgeSides } from "./erUtils";

describe("ER 図の線をつなぐ辺", () => {
  it("参照される側が上にあれば、参照する側の上辺から、参照される側の下辺へ (縦の線)", () => {
    expect(pickEdgeSides({ x: 0, y: 300 }, { x: 0, y: 0 })).toEqual({ sourceHandle: "top", targetHandle: "bottom" });
    expect(pickEdgeSides({ x: 100, y: 0 }, { x: 0, y: 400 })).toEqual({ sourceHandle: "bottom", targetHandle: "top" });
  });
  it("ほぼ同じ高さなら、向かい合う左右の辺", () => {
    expect(pickEdgeSides({ x: 0, y: 100 }, { x: 300, y: 120 })).toEqual({ sourceHandle: "right", targetHandle: "left" });
    expect(pickEdgeSides({ x: 300, y: 100 }, { x: 0, y: 100 })).toEqual({ sourceHandle: "left", targetHandle: "right" });
  });
  it("自分自身へのリレーションは、右から出て左へ入る", () => {
    expect(pickEdgeSides({ x: 0, y: 0 }, { x: 0, y: 0 }, true)).toEqual({ sourceHandle: "right", targetHandle: "left" });
  });
});
