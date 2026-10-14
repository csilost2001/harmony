import { describe, expect, it } from "vitest";
import { QUICK_CREATE_ACTIONS, buildQuickOpenEntries, clearRecentQuickOpen, loadRecentQuickOpen, normalizeQuery, rememberQuickOpen, resolveFavoriteEntries, searchCommands, searchQuickOpen } from "./quickOpen";

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

describe("新しく作る", () => {
  const entries = buildQuickOpenEntries({
    tables: [{ id: "order", name: "注文", physicalName: "orders" }],
    pages: [{ id: "tables", label: "テーブル一覧", route: "/table/list" }],
  });

  it("検索語がないとき、新規作成の候補は最後に回る (一覧を埋めない)", () => {
    const hits = searchQuickOpen(entries, "", 50);
    const firstCreate = hits.findIndex((h) => h.entry.kind === "create");
    expect(firstCreate).toBeGreaterThan(hits.findIndex((h) => h.entry.kind === "table"));
    expect(hits.slice(0, firstCreate).every((h) => h.entry.kind !== "create")).toBe(true);
  });

  it("「新規 テーブル」「table new」「作成 帳票」で見つかり、先頭になる", () => {
    expect(searchQuickOpen(entries, "新規 テーブル")[0].entry).toMatchObject({ kind: "create", id: "table", route: "/table/list" });
    expect(searchQuickOpen(entries, "table new")[0].entry).toMatchObject({ kind: "create", id: "table" });
    expect(searchQuickOpen(entries, "作成 帳票")[0].entry).toMatchObject({ kind: "create", id: "report" });
  });

  it("すべての種類に、一覧の route と名前がある", () => {
    const creates = entries.filter((e) => e.kind === "create");
    expect(creates).toHaveLength(QUICK_CREATE_ACTIONS.length);
    for (const c of creates) { expect(c.route.startsWith("/")).toBe(true); expect(c.label).toContain("新しく作る"); }
  });
});

describe("ページレイアウト・ガジェット", () => {
  const es = buildQuickOpenEntries({
    pageLayouts: [{ id: "main-layout", name: "メインレイアウト" }],
    gadgets: [{ id: "global-header", name: "グローバルヘッダ" }],
  });
  it("検索の対象になり、それぞれのエディタを開く", () => {
    expect(searchQuickOpen(es, "メインレイアウト")[0].entry).toMatchObject({ kind: "page-layout", route: "/page-layout/edit/main-layout" });
    expect(searchQuickOpen(es, "ヘッダ")[0].entry).toMatchObject({ kind: "gadget", route: "/screen/design/global-header" });
  });
});

describe("contentHitsToEntries (本文検索の結果)", () => {
  const hit = (kind: "table" | "screen", id: string, matches: Array<{ where: string; text: string }>) => ({ kind, id, name: id, matches });

  it("名前検索と同じ key・遷移先で、一致した場所つきの候補にする", async () => {
    const { contentHitsToEntries } = await import("./quickOpen");
    const [e] = contentHitsToEntries([hit("table", "order-item", [{ where: "カラム id", text: "サロゲートキー" }, { where: "カラム x", text: "y" }])]);
    expect(e).toMatchObject({ key: "table:order-item", route: "/table/edit/order-item", detail: "カラム id: サロゲートキー (ほか 1 か所)" });
    expect(contentHitsToEntries([hit("screen", "cart", [{ where: "項目 qty", text: "数量" }])])[0].route).toBe("/screen/design/cart");
  });

  it("名前検索ですでに出ているもの・一致のないものは除く", async () => {
    const { contentHitsToEntries } = await import("./quickOpen");
    const hits = [hit("table", "a", [{ where: "w", text: "t" }]), hit("table", "b", [{ where: "w", text: "t" }]), hit("table", "c", [])];
    expect(contentHitsToEntries(hits, new Set(["table:a"])).map((e) => e.id)).toEqual(["b"]);
  });
});


describe("お気に入り (検索語が空のとき先頭に出る)", () => {
  const es = buildQuickOpenEntries({
    screens: [{ id: "cart", name: "カート" }],
    tables: [{ id: "orders", name: "注文" }, { id: "items", name: "商品" }],
    gadgets: [{ id: "global-header", name: "ヘッダ" }],
  });

  it("お気に入り → 最近開いた順 → 残り。同じものは 1 度だけ", () => {
    const hits = searchQuickOpen(es, "", 50, ["table:items", "table:orders"], ["table:orders", "screen:cart"]).map((h) => h.entry.key);
    expect(hits.slice(0, 3)).toEqual(["table:orders", "screen:cart", "table:items"]);
    expect(new Set(hits).size).toBe(hits.length);
  });

  it("画面の印で固定したガジェットも、実在する側の候補として出る。語があるときは通常の検索", () => {
    expect(searchQuickOpen(es, "", 50, [], ["screen:global-header"])[0].entry.key).toBe("gadget:global-header");
    expect(searchQuickOpen(es, "商品", 50, [], ["table:orders"])[0].entry.key).toBe("table:items");
  });

  it("resolveFavoriteEntries は固定した順に結びつけ、見つからないもの (削除・改名) は entry が null", () => {
    const r = resolveFavoriteEntries(es, ["table:gone", "table:orders", "screen:global-header"]);
    expect(r.map((x) => [x.key, x.entry?.key ?? null])).toEqual([["table:gone", null], ["table:orders", "table:orders"], ["screen:global-header", "gadget:global-header"]]);
  });
});

describe("最近開いたものの履歴を消す", () => {
  it("消すと空になる", () => {
    rememberQuickOpen("table:orders");
    expect(loadRecentQuickOpen()).toContain("table:orders");
    clearRecentQuickOpen();
    expect(loadRecentQuickOpen()).toEqual([]);
  });
});

describe("searchCommands (コマンドパレットの操作の検索)", () => {
  const cmds = [
    { id: "save", label: "保存", keywords: ["ほぞん", "save"] },
    { id: "undo", label: "元に戻す", keywords: ["もとにもどす", "undo"] },
    { id: "theme-dark", label: "配色: ダーク", keywords: ["はいしょく", "theme", "dark"] },
    { id: "font-large", label: "文字サイズ: 大", keywords: ["もじ", "font", "size"] },
  ];
  it("語が空なら渡した順のまま、語があれば名前・読み・英語のどれでも見つかる", () => {
    expect(searchCommands(cmds, "").map((c) => c.id)).toEqual(["save", "undo", "theme-dark", "font-large"]);
    expect(searchCommands(cmds, "ほぞん").map((c) => c.id)).toEqual(["save"]);
    expect(searchCommands(cmds, "ホゾン").map((c) => c.id)).toEqual(["save"]); // カタカナでも
    expect(searchCommands(cmds, "dark").map((c) => c.id)).toEqual(["theme-dark"]);
    expect(searchCommands(cmds, "配色 ダーク").map((c) => c.id)).toEqual(["theme-dark"]);
  });
  it("空白で区切った語はすべて合う必要がある。合わなければ空", () => {
    expect(searchCommands(cmds, "文字 ダーク")).toEqual([]);
    expect(searchCommands(cmds, "zzz")).toEqual([]);
  });
  it("件数を絞れる", () => {
    expect(searchCommands(cmds, "", 2)).toHaveLength(2);
  });
});
