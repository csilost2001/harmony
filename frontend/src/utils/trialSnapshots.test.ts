import { describe, it, expect, beforeEach } from "vitest";
import { MAX_TRIALS_PER_DESIGN, addTrial, loadTrials, removeTrial } from "./trialSnapshots";

beforeEach(() => localStorage.clear());
const snap = { id: "orders", name: "注文", columns: [{ id: "c1" }] };

describe("trialSnapshots", () => {
  it("名前をつけて残し、新しい順に読める。内容は複製で持つ", () => {
    const body = structuredClone(snap);
    const r1 = addTrial("w", "table:orders", " 案 A ", body, new Date("2026-10-17T00:00:00Z"), () => "a");
    expect(r1.ok).toBe(true);
    body.name = "あとから変えた";
    addTrial("w", "table:orders", "案 B", snap, new Date("2026-10-17T01:00:00Z"), () => "b");
    const list = loadTrials("w")["table:orders"];
    expect(list.map((t) => [t.id, t.name])).toEqual([["b", "案 B"], ["a", "案 A"]]);
    expect((list[1].snapshot as { name: string }).name).toBe("注文");
    expect(loadTrials("other")).toEqual({});
  });
  it("名前が空・件数の上限・大きさの上限は、残さずに理由を返す", () => {
    expect(addTrial("w", "table:x", " ", snap)).toMatchObject({ ok: false, reason: "name" });
    for (let i = 0; i < MAX_TRIALS_PER_DESIGN; i++) addTrial("w", "table:x", `n${i}`, snap);
    expect(addTrial("w", "table:x", "あふれ", snap)).toMatchObject({ ok: false, reason: "limit" });
    expect(addTrial("w", "table:big", "大", { text: "x".repeat(500 * 1024) })).toMatchObject({ ok: false, reason: "size" });
  });
  it("消せる。最後の 1 件を消すと、設計の項目ごと無くなる", () => {
    addTrial("w", "table:x", "a", snap, new Date(), () => "a");
    expect(removeTrial("w", "table:x", "a")).toEqual({});
    expect(loadTrials("w")).toEqual({});
  });
  it("壊れた保存内容は空として読む", () => {
    localStorage.setItem("harmony-trials:w", "[1,2");
    expect(loadTrials("w")).toEqual({});
    localStorage.setItem("harmony-trials:w", JSON.stringify({ "table:a": [{ id: 1 }, { id: "ok", name: "n", snapshot: 1 }], "table:b": "x" }));
    expect(Object.keys(loadTrials("w"))).toEqual(["table:a"]);
  });
});
