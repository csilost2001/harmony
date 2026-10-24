import { describe, expect, it } from "vitest";
import { shareStructure } from "./storyShare";

describe("shareStructure: 作り直された JSON の、同じ内容の部分を前の参照にする", () => {
  const make = () => ({ name: "a", steps: [{ id: "s1", kind: "x", sub: [{ id: "s1a" }] }, { id: "s2", kind: "y" }, { id: "s3", kind: "z" }] });

  it("まったく同じ内容なら、全体が前と同じ参照", () => {
    const prev = make();
    expect(shareStructure(prev, structuredClone(prev))).toBe(prev);
  });

  it("1 つの工程だけ変えると、その工程と、そこへの道だけが新しく、ほかは前の参照", () => {
    const prev = make();
    const next = structuredClone(prev);
    next.steps[1]!.kind = "changed";
    const out = shareStructure(prev, next);
    expect(out).not.toBe(prev);
    expect(out.steps).not.toBe(prev.steps);
    expect(out.steps[0]).toBe(prev.steps[0]);
    expect(out.steps[1]).not.toBe(prev.steps[1]);
    expect(out.steps[1]).toEqual({ id: "s2", kind: "changed" });
    expect(out.steps[2]).toBe(prev.steps[2]);
  });

  it("入れ子の中の変更でも、外側の変わっていない兄弟は前の参照", () => {
    const prev = make();
    const next = structuredClone(prev);
    next.steps[0]!.sub![0]!.id = "renamed";
    const out = shareStructure(prev, next);
    expect(out.steps[0]).not.toBe(prev.steps[0]);
    expect(out.steps[1]).toBe(prev.steps[1]);
  });

  it("並べ替え・挿入・削除でも、id が同じ工程は前の参照 (中身が同じなら)", () => {
    const prev = make();
    const swapped = structuredClone(prev);
    [swapped.steps[0], swapped.steps[1]] = [swapped.steps[1], swapped.steps[0]];
    const out = shareStructure(prev, swapped);
    expect(out.steps[0]).toBe(prev.steps[1]);
    expect(out.steps[1]).toBe(prev.steps[0]);
    expect(out.steps[2]).toBe(prev.steps[2]);
    expect(out.steps).not.toBe(prev.steps);

    const removed = structuredClone(prev);
    removed.steps.splice(0, 1);
    const out2 = shareStructure(prev, removed);
    expect(out2.steps).toHaveLength(2);
    expect(out2.steps[0]).toBe(prev.steps[1]);
  });

  it("値は書き換えない。型の違い・null・配列と物の取り違えは、あとの値のまま", () => {
    const prev = make();
    const snap = JSON.stringify(prev);
    const next = { ...structuredClone(prev), name: null, steps: { not: "array" } } as unknown;
    expect(shareStructure(prev, next)).toEqual(next);
    expect(JSON.stringify(prev)).toBe(snap);
    expect(shareStructure(undefined, 5)).toBe(5);
    expect(shareStructure({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(shareStructure({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
  });
});
