import { describe, it, expect, beforeEach } from "vitest";
import { componentPart, loadRecentParts, nodePart, rememberPart } from "./recentParts";

beforeEach(() => localStorage.clear());

describe("recentParts (続編 第 8 弾 #144)", () => {
  it("新しい順に覚え、同じ部品は先頭へ移す。最大 6 件", () => {
    for (const t of ["a", "b", "c", "d", "e", "f", "g"]) rememberPart("w", nodePart(t));
    expect(loadRecentParts("w")).toEqual(["node:g", "node:f", "node:e", "node:d", "node:c", "node:b"]);
    rememberPart("w", nodePart("d"));
    expect(loadRecentParts("w")[0]).toBe("node:d");
    expect(new Set(loadRecentParts("w")).size).toBe(6);
  });
  it("ワークスペースごとに分かれ、独自部品も覚える。壊れた保存値は空", () => {
    rememberPart("w1", componentPart("x"));
    expect(loadRecentParts("w1")).toEqual(["component:x"]);
    expect(loadRecentParts("w2")).toEqual([]);
    localStorage.setItem("harmony-recent-parts:w3", "{");
    expect(loadRecentParts("w3")).toEqual([]);
  });
});
