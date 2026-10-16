import { describe, it, expect, beforeEach } from "vitest";
import { MAX_NOTES, loadNotes, noteRef, saveNote, todayNotes } from "./personalNotes";

beforeEach(() => localStorage.clear());

describe("personalNotes", () => {
  it("書いて読める。ワークスペースごとに別々", () => {
    saveNote("a", noteRef("table", "orders"), "桁数を確認", false);
    expect(loadNotes("a")["table:orders"]).toMatchObject({ text: "桁数を確認", today: false });
    expect(loadNotes("b")).toEqual({});
  });
  it("空にすると消える", () => {
    saveNote("a", "table:x", "メモ", true);
    saveNote("a", "table:x", "  ", true);
    expect(loadNotes("a")).toEqual({});
  });
  it("今日の印のあるものだけ、新しい順に出る", () => {
    saveNote("a", "table:old", "古い", true, new Date("2026-10-01T00:00:00Z"));
    saveNote("a", "table:new", "新しい", true, new Date("2026-10-02T00:00:00Z"));
    saveNote("a", "table:no", "印なし", false);
    expect(todayNotes(loadNotes("a")).map((n) => n.ref)).toEqual(["table:new", "table:old"]);
  });
  it("件数の上限を超える新しいメモは書けない (すでにあるものの更新はできる)", () => {
    for (let i = 0; i < MAX_NOTES; i++) saveNote("a", `table:t${i}`, "x", false);
    expect(saveNote("a", "table:over", "x", false).ok).toBe(false);
    expect(saveNote("a", "table:t0", "更新", false).ok).toBe(true);
  });
  it("壊れた保存内容は、空として読む", () => {
    localStorage.setItem("harmony-personal-notes:a", "{not json");
    expect(loadNotes("a")).toEqual({});
    localStorage.setItem("harmony-personal-notes:a", JSON.stringify({ "table:x": { text: 3 }, "table:y": { text: "ok" } }));
    expect(Object.keys(loadNotes("a"))).toEqual(["table:y"]);
  });
});
