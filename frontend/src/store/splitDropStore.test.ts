import { describe, it, expect, beforeEach } from "vitest";
import { pointInZone, splitDrop, zoneOf } from "./splitDropStore";

const main = { left: 0, top: 100, width: 1000, height: 600 };

describe("zoneOf / pointInZone", () => {
  it("本文の右の 4 割を、並べる領域にする", () => {
    expect(zoneOf(main)).toEqual({ left: 600, top: 100, width: 400, height: 600 });
  });
  it("領域の中だけ、真", () => {
    const z = zoneOf(main);
    expect(pointInZone(z, 700, 300)).toBe(true);
    expect(pointInZone(z, 500, 300)).toBe(false);
    expect(pointInZone(z, 700, 50)).toBe(false); // タブの列の高さ (本文の上)
    expect(pointInZone(null, 700, 300)).toBe(false);
  });
});

describe("splitDrop", () => {
  beforeEach(() => splitDrop.end());
  it("ドラッグ中だけ領域があり、ポインタが入ると hot になり、終わると戻る", () => {
    splitDrop.begin(main);
    expect(splitDrop.isHot()).toBe(false);
    expect(splitDrop.move(100, 300)).toBe(false);
    expect(splitDrop.move(800, 300)).toBe(true);
    expect(splitDrop.isHot()).toBe(true);
    splitDrop.end();
    expect(splitDrop.isHot()).toBe(false);
    expect(splitDrop.move(800, 300)).toBe(false); // 領域が無い
  });
});
