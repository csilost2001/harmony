import { describe, it, expect, beforeEach } from "vitest";
import { markNoteSeen, noteKeyOf, pickNewNotes, readSeenNote } from "./updateNotice";

const n = (d: string, t: string) => ({ date: d, title: t });
const notes = [n("2026-10-17", "第 9 弾"), n("2026-10-16", "第 8 弾"), n("2026-10-15", "第 7 弾"), n("2026-10-14", "第 6 弾")];

beforeEach(() => localStorage.clear());

describe("pickNewNotes (続編 第 10 弾 #190)", () => {
  it("前に見たものより新しいものだけ (新しい順)", () => {
    expect(pickNewNotes(notes, noteKeyOf(notes[2])).map((x) => x.title)).toEqual(["第 9 弾", "第 8 弾"]);
    expect(pickNewNotes(notes, noteKeyOf(notes[0]))).toEqual([]);
  });
  it("前に見たものが一覧に無いときは、新しい 5 件まで。一覧が空なら空", () => {
    const many = Array.from({ length: 9 }, (_, i) => n(`2026-10-${20 - i}`, `v${i}`));
    expect(pickNewNotes(many, "x|y")).toHaveLength(5);
    expect(pickNewNotes(many, null)).toHaveLength(5);
    expect(pickNewNotes([], "x|y")).toEqual([]);
  });
  it("見たものを覚えて、読める", () => {
    markNoteSeen(notes[1]);
    expect(readSeenNote()).toBe("2026-10-16|第 8 弾");
    markNoteSeen(undefined);
    expect(readSeenNote()).toBe("2026-10-16|第 8 弾");
  });
});
