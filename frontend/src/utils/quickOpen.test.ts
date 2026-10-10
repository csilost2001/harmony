import { describe, expect, it } from "vitest";
import { buildQuickOpenEntries, loadRecentQuickOpen, normalizeQuery, rememberQuickOpen, searchQuickOpen } from "./quickOpen";

const entries = buildQuickOpenEntries({
  screens: [
    { id: "order-complete", name: "注文完了", path: "/orders/complete" },
    { id: "product-list", name: "商品一覧" },
  ],
  tables: [{ id: "order", name: "注文", physicalName: "orders" }, { id: "order-item", name: "注文明細", physicalName: "order_items" }],
  processFlows: [{ id: "order-confirm", name: "注文確定" }],
  businessFlows: [{ id: "order-to-shipment", name: "注文から出荷まで" }],
  reports: [{ id: "delivery-note", name: "納品書" }],
  pages: [{ id: "document", label: "設計書", route: "/document" }],
});
const keys = (q: string) => searchQuickOpen(entries, q).map((h) => h.entry.key);

describe("quickOpen", () => {
  it("normalizeQuery は全角・大文字・カタカナを揃える", () => {
    expect(normalizeQuery("ＯＲＤＥＲ")).toBe("order");
    expect(normalizeQuery("チュウモン")).toBe(normalizeQuery("ちゅうもん"));
  });

  it("画面ごとに「画面」と「画面項目」の候補ができ、route は ID を符号化する", () => {
    expect(entries.find((e) => e.key === "screen:order-complete")?.route).toBe("/screen/design/order-complete");
    expect(entries.find((e) => e.key === "screen-items:order-complete")?.route).toBe("/screen/items/order-complete");
  });

  it("空の検索語は先頭から limit 件を返す", () => {
    expect(searchQuickOpen(entries, "", 3)).toHaveLength(3);
  });

  it("ID の完全一致が先頭に来る", () => {
    expect(keys("order")[0]).toBe("table:order");
  });

  it("名前 (日本語) でも探せる", () => {
    expect(keys("納品")).toEqual(["report:delivery-note"]);
    expect(keys("注文確定")[0]).toBe("process-flow:order-confirm");
  });

  it("物理名・URL でも探せる", () => {
    expect(keys("order_items")).toEqual(["table:order-item"]);
    expect(keys("/orders/complete")).toContain("screen:order-complete");
  });

  it("空白区切りの語はすべて合うものだけ残る (AND)", () => {
    expect(keys("注文 テーブル")).toEqual(expect.arrayContaining(["table:order", "table:order-item"]));
    expect(keys("注文 テーブル").every((k) => k.startsWith("table:"))).toBe(true);
  });

  it("文字が順に含まれていれば弱く一致する (3 文字以上)", () => {
    expect(keys("ordcnf")).toEqual(["process-flow:order-confirm"]);
    expect(keys("zz")).toEqual([]);
  });

  it("半角カナを全角に揃えて探せる", () => {
    expect(keys("ﾃｰﾌﾞﾙ")).toEqual(expect.arrayContaining(["table:order"]));
  });

  it("検索語が空なら、最近開いたものが先頭に来る (残りは並び順)", () => {
    const hits = searchQuickOpen(entries, "", 5, ["report:delivery-note", "table:order", "gone:none"]).map((h) => h.entry.key);
    expect(hits.slice(0, 2)).toEqual(["report:delivery-note", "table:order"]);
    expect(hits).toHaveLength(5);
    expect(new Set(hits).size).toBe(5);
  });

  it("最近開いたものは新しい順・重複なし・10 件まで保存される", () => {
    localStorage.clear();
    for (let i = 0; i < 12; i++) rememberQuickOpen(`table:t${i}`);
    rememberQuickOpen("table:t5");
    const r = loadRecentQuickOpen();
    expect(r[0]).toBe("table:t5");
    expect(r).toHaveLength(10);
    expect(new Set(r).size).toBe(10);
  });
});
