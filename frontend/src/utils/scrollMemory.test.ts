import { describe, it, expect, beforeEach } from "vitest";
import { _clearScrollMemory, recalledScroll, recordScroll, scrollTargetKey } from "./scrollMemory";

beforeEach(() => _clearScrollMemory());

describe("scrollMemory", () => {
  it("画面ごと・要素ごとに位置を覚える", () => {
    recordScroll("/w/a/table/list", "t:list", 120.4);
    recordScroll("/w/a/table/list", "#doc", 30);
    recordScroll("/w/a/screen/list", "t:list", 999);
    expect(recalledScroll("/w/a/table/list")).toEqual({ "t:list": 120, "#doc": 30 });
    expect(recalledScroll("/w/a/screen/list")).toEqual({ "t:list": 999 });
    expect(recalledScroll("/none")).toEqual({});
  });
  it("先頭に戻したら、覚えを消す", () => {
    recordScroll("/x", "#doc", 50);
    recordScroll("/x", "#doc", 0);
    expect(recalledScroll("/x")).toEqual({});
  });
  it("覚える画面は 60 まで (古いものから捨てる)", () => {
    for (let i = 0; i < 70; i++) recordScroll("/r" + i, "#doc", 10);
    expect(recalledScroll("/r0")).toEqual({});
    expect(recalledScroll("/r69")).toEqual({ "#doc": 10 });
  });
  it("要素の見分け方: testid > id > class、document は #doc、見分けがなければ null", () => {
    const mk = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild as Element; };
    expect(scrollTargetKey(mk('<div data-testid="a" id="b" class="c"></div>'), null)).toBe("t:a");
    expect(scrollTargetKey(mk('<div id="b" class="c"></div>'), null)).toBe("i:b");
    expect(scrollTargetKey(mk('<div class="c d"></div>'), null)).toBe("c:c");
    expect(scrollTargetKey(mk("<div></div>"), null)).toBeNull();
    expect(scrollTargetKey(document, null)).toBe("#doc");
  });
});
