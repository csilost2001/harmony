import { describe, it, expect } from "vitest";
import { designToLayout, toIdentifier, validateLayout, type LayoutNode } from "@harmony/shared";
import { htmlToSimple } from "./domToSimple";

const flat = (nodes: LayoutNode[]): LayoutNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);

describe("designToLayout", () => {
  it("アプリ共通の枠を除き main の中身だけを変換する", () => {
    const html = `<div class="app-shell"><header class="app-header"><h1>システム名</h1></header>
      <aside class="app-sidebar"><a href="/">ホーム</a></aside>
      <main class="app-main"><h1 class="page-title">顧客検索</h1></main></div>`;
    const { layout } = designToLayout(htmlToSimple(html), []);
    expect(layout.nodes).toEqual([expect.objectContaining({ type: "heading", props: { text: "顧客検索", level: 1 } })]);
  });

  it("ラベル付き入力欄を既存の画面項目に結び付け、無ければ項目を作る", () => {
    const html = `<form id="searchForm">
      <div class="search-field"><label for="code">商品コード</label><input id="code" name="productCode" data-item-id="productCode" maxlength="20"></div>
      <div class="search-field"><label for="st">店舗</label><select id="st" name="storeCode"><option value="">全店舗</option><option value="S-001">東京本店</option></select></div>
      <button type="button" class="btn btn-outline-secondary">クリア</button>
      <button type="submit" class="btn btn-primary" data-item-id="searchButton">検索</button>
    </form>`;
    const { layout, newItems } = designToLayout(htmlToSimple(html), [{ id: "productCode", label: "商品コード" }]);
    const panel = layout.nodes[0];
    expect(panel.type).toBe("search-panel");
    expect(panel.props?.columns).toBe(2);
    expect(flat(layout.nodes).filter((n) => n.type === "field").map((n) => n.itemRef)).toEqual(["productCode", "storeCode"]);
    expect(newItems.find((i) => i.id === "storeCode")).toMatchObject({ label: "店舗", options: [{ value: "S-001", label: "東京本店" }] });
    const bar = flat(layout.nodes).find((n) => n.type === "button-bar");
    expect(bar?.children?.map((b) => b.id)).toEqual(["clearButton", "searchButton"]);
    expect(bar?.children?.[1].props?.variant).toBe("primary");
  });

  it("見出し行のある表は一覧項目にし、列見出しを列定義にする", () => {
    const html = `<h1>注文一覧</h1><table><thead><tr><th>注文番号</th><th>金額</th></tr></thead><tbody><tr><td>1</td><td>100</td></tr></tbody></table>`;
    const { layout, newItems } = designToLayout(htmlToSimple(html), [], { screenId: "order-list" });
    expect(layout.nodes[1]).toMatchObject({ type: "table", itemRef: "orderListRows" });
    expect(newItems[0]).toMatchObject({ id: "orderListRows", label: "注文一覧 一覧", presentation: { kind: "table" } });
    expect((newItems[0].presentation?.columns ?? []).map((c) => c.label)).toEqual(["注文番号", "金額"]);
  });

  it("viewer 差し込み位置の直後にある見本表は重複させない", () => {
    const html = `<div data-item-id="rowsItem"></div><table><thead><tr><th>A</th></tr></thead></table>`;
    const { layout, newItems } = designToLayout(htmlToSimple(html), [{ id: "rowsItem", presentation: { kind: "table" } }]);
    expect(layout.nodes).toEqual([expect.objectContaining({ type: "table", itemRef: "rowsItem" })]);
    expect(newItems).toEqual([]);
  });

  it("業務部品にならない要素は html 部品として原文を残す", () => {
    const html = `<ul class="pagination"><li>1</li><li>2</li></ul>`;
    const { layout, stats } = designToLayout(htmlToSimple(html), []);
    expect(layout.nodes[0].type).toBe("html");
    expect(layout.nodes[0].props?.html).toContain("pagination");
    expect(stats.html).toBe(1);
  });

  it("ガジェット画面では枠要素も変換する", () => {
    const html = `<footer class="app-footer"><small>© 2026 リテール</small></footer>`;
    expect(designToLayout(htmlToSimple(html), []).layout.nodes).toEqual([]);
    expect(designToLayout(htmlToSimple(html), [], { keepShell: true }).layout.nodes[0]).toMatchObject({ type: "text", props: { tone: "muted" } });
  });

  it("変換結果は検証で error を出さない", () => {
    const html = `<main><h1>カート</h1><div class="card"><div class="card-header">商品を追加</div><div class="card-body"><form>
      <div class="row"><div class="col-md-6"><label for="a">商品コード</label><input id="a" name="addProductCode"></div>
      <div class="col-md-6"><label for="b">数量</label><input id="b" type="number" name="addQuantity" required></div></div>
      <div class="alert alert-danger">エラー</div></form></div></div></main>`;
    const { layout, newItems } = designToLayout(htmlToSimple(html), []);
    const form = flat(layout.nodes).find((n) => n.type === "form");
    expect(form?.props).toMatchObject({ title: "商品を追加", columns: 2 });
    expect(newItems.find((i) => i.id === "addQuantity")).toMatchObject({ type: "integer", required: true });
    expect(validateLayout(layout, newItems).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("toIdentifier", () => {
  it("kebab / snake / 空白を lowerCamelCase にする", () => {
    expect(toIdentifier("search-form")).toBe("searchForm");
    expect(toIdentifier("order_list rows")).toBe("orderListRows");
    expect(toIdentifier("日本語", "fallback")).toBe("fallback");
  });
});
