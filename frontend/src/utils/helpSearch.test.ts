import { describe, it, expect } from "vitest";
import { relevantTopics, searchHelp, topicRelevant } from "./helpSearch";

describe("searchHelp (続編 第 10 弾 #189)", () => {
  it("題名・本文・ショートカットの説明から探す。題名の一致が先", () => {
    const hits = searchHelp("物理名", "/");
    expect(hits[0]).toMatchObject({ kind: "topic", id: "table.physicalName" });
    // 題名に含むもの (10 点) は、本文だけに含むもの (3 点) より先
    const scores = hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
  it("ショートカットを、キーや説明で探せる", () => {
    expect(searchHelp("閉じたタブ", "/").some((h) => h.kind === "shortcut" && h.keys.includes("T"))).toBe(true);
    expect(searchHelp("ctrl s", "/").some((h) => h.kind === "shortcut" && h.keys.join("+") === "Ctrl+S")).toBe(true);
  });
  it("全角半角・大文字小文字・かなの違いを無視する。空白区切りは、すべてを含む", () => {
    expect(searchHelp("ＣＴＲＬ　ｋ", "/").some((h) => h.kind === "shortcut" && h.keys.join("+") === "Ctrl+K")).toBe(true);
    expect(searchHelp("ぶつりめい", "/").length).toBe(0); // 読み仮名の変換までは、しない (かなの種類の違いだけ)
    expect(searchHelp("データ型 長さ", "/").some((h) => h.kind === "topic" && h.id === "table.dataType")).toBe(true);
    expect(searchHelp("データ型 存在しない語zzz", "/")).toEqual([]);
  });
  it("空の検索語は何も返さない。件数の上限", () => {
    expect(searchHelp("  ", "/")).toEqual([]);
    expect(searchHelp("a", "/", 3).length).toBeLessThanOrEqual(3);
  });
  it("いまの画面に関係するものは、同じ得点なら先に出る", () => {
    const here = searchHelp("名", "/w/retail/table/edit/orders").filter((h) => h.kind === "topic");
    const away = searchHelp("名", "/w/retail/screen/list").filter((h) => h.kind === "topic");
    const idx = (hs: typeof here, id: string) => hs.findIndex((h) => h.kind === "topic" && h.id === id);
    expect(here.find((h) => h.kind === "topic" && h.id === "table.physicalName")?.here).toBe(true);
    expect(away.find((h) => h.kind === "topic" && h.id === "table.physicalName")?.here).toBe(false);
    expect(idx(here, "table.physicalName")).toBeLessThanOrEqual(idx(away, "table.physicalName"));
  });
});

describe("topicRelevant / relevantTopics", () => {
  it("テーブルの画面では、テーブルのヘルプが関係する。画面デザイナでは、部品のヘルプ", () => {
    expect(topicRelevant("table.keys", "/w/x/table/edit/orders")).toBe(true);
    expect(topicRelevant("table.keys", "/w/x/screen/list")).toBe(false);
    expect(topicRelevant("layout.overview", "/w/x/screen/design/cart")).toBe(true);
    expect(relevantTopics("/w/x/table/list").map((t) => t.id)).toContain("table.dataType");
    expect(relevantTopics("/").length).toBe(0);
  });
});
