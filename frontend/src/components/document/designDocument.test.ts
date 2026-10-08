import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildDesignDocument, deriveCrud, esc, prose, renderStandaloneDesignDoc, type DesignDocInput } from "@harmony/shared";

const root = path.resolve(__dirname, "../../../../examples/retail");
const readDir = (d: string, f = (n: string) => n.endsWith(".json")) =>
  fs.readdirSync(path.join(root, "harmony", d)).filter(f).map((n) => JSON.parse(fs.readFileSync(path.join(root, "harmony", d, n), "utf-8")));
const harmony = JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8"));
const input: DesignDocInput = {
  project: { id: "retail", name: harmony.meta.name },
  screens: readDir("screens", (n) => n.endsWith(".json") && !n.includes(".design.")),
  flows: readDir("process-flows"),
  tables: readDir("tables"),
  transitions: harmony.entities.screenTransitions,
  messages: JSON.parse(fs.readFileSync(path.join(root, "harmony", "conventions", "catalog.json"), "utf-8")).msg,
  version: "test",
  generatedAt: "2026-10-08T00:00:00.000Z",
};

describe("deriveCrud (retail 実データ)", () => {
  const crud = deriveCrud(input.flows, input.tables);
  const cell = (flow: string, table: string) => crud.rows.find((r) => r.flowId === flow)?.cells[table] ?? [];

  it("DB アクセスの操作から CRUD を導出する (UPSERT=C+U、在庫減算=U)", () => {
    expect(cell("cart-add", "cart-item")).toEqual(["C", "R", "U"]);
    expect(cell("order-confirm", "cart-item")).toEqual(["D"]);
    expect(cell("order-confirm", "inventory-by-store")).toEqual(["U"]);
    expect(cell("order-confirm", "order")).toEqual(["C", "R"]);
  });

  it("所見: 未使用・登録なし・参照なしのテーブルを検出する", () => {
    const msg = (t: string) => crud.findings.filter((f) => f.tableId === t).map((f) => f.message);
    expect(msg("customer-master")).toEqual(["どの処理フローからも使われていません"]);
    expect(msg("product-master")).toContain("登録 (C) する処理フローがありません");
    expect(msg("order-item")).toContain("参照 (R) する処理フローがありません");
  });
});

describe("buildDesignDocument", () => {
  const doc = buildDesignDocument(input);

  it("表紙・各章・画面/処理/テーブル個別の目次を作る", () => {
    const ids = doc.toc.map((t) => t.id);
    expect(ids.slice(0, 3)).toEqual(["cover", "screens", "transitions"]);
    expect(ids).toEqual(expect.arrayContaining(["screen-cart", "flow-order-confirm", "table-cart", "crud", "messages", "issues"]));
  });

  it("画面設計にレイアウトと項目定義、処理設計に図と処理記述表を含む", () => {
    expect(doc.html).toContain('id="screen-cart"');
    expect(doc.html).toContain("lv-paper");
    expect(doc.html).toContain("addProductCode");
    expect(doc.html).toMatch(/<svg class="hd-diagram"/);
    expect(doc.html).toContain("hd-outline");
    expect(doc.html).toContain("@conv.msg.stockShortage");
  });

  it("利用者の入力は HTML エスケープされる", () => {
    const d = buildDesignDocument({ ...input, project: { name: "<script>alert(1)</script>" }, screens: [], flows: [], tables: [] });
    expect(d.html).not.toContain("<script>alert");
    expect(d.html).toContain("&lt;script&gt;");
    expect(esc(`a&"'<>`)).toBe("a&amp;&quot;&#39;&lt;&gt;");
  });

  it("単体 HTML は目次と CSS を同梱する", () => {
    const html = renderStandaloneDesignDoc(input);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<nav class="hd-nav"');
    expect(html).toContain(".hd-doc{");
  });
});

describe("影響範囲 (列を参照している画面項目)", () => {
  it("binding.kind=tableColumn の画面項目をテーブル定義に列挙する", () => {
    const doc = buildDesignDocument({
      project: { name: "t" },
      screens: [{ id: "store-edit", name: "店舗編集", items: [{ id: "storeName", label: "店舗名", binding: { kind: "tableColumn", ref: { tableId: "store-master", columnId: "c-name" } } }] }],
      flows: [],
      tables: [{ id: "store-master", name: "店舗マスタ", physicalName: "stores", columns: [{ id: "c-name", physicalName: "name", name: "店舗名" }] }],
    });
    const section = doc.html.slice(doc.html.indexOf('id="table-store-master"'));
    expect(section).toContain("列を参照している画面項目");
    expect(section).toContain("storeName");
    expect(section).toContain("店舗名 (name)");
  });
});

describe("導出した章 (バッチ / 外部 IF / イベント / テスト観点)", () => {
  it("retail: イベント一覧に発行元の処理、各アクションにテスト観点を出す", () => {
    const doc = buildDesignDocument(input);
    const ids = doc.toc.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["batches", "interfaces", "events"]));
    const events = doc.html.slice(doc.html.indexOf('id="events"'), doc.html.indexOf('id="messages"'));
    expect(events).toContain("retail.order.confirmed");
    expect(events).toContain("注文確定");
    expect(doc.html).toContain("hd-tests");
  });

  it("定期処理はバッチ一覧に載る", () => {
    const doc = buildDesignDocument({
      project: { name: "t" }, screens: [], tables: [],
      flows: [{ meta: { id: "streak-reset", name: "連続学習日数リセット", flowType: "scheduled" }, actions: [{ name: "実行", trigger: "timer", description: "毎日 0 時", steps: [] }] }],
    });
    const sec = doc.html.slice(doc.html.indexOf('id="batches"'), doc.html.indexOf('id="interfaces"'));
    expect(sec).toContain("連続学習日数リセット");
    expect(sec).toContain("定期");
  });
});

describe("説明文の描画 (prose)", () => {
  it("**強調** と `コード` だけを描画し、HTML はエスケープする", () => {
    expect(prose("**リリース時** の `id` <b>x</b>")).toBe("<strong>リリース時</strong> の <code>id</code> &lt;b&gt;x&lt;/b&gt;");
  });
});

describe("独自部品 (layout components)", () => {
  const def = {
    id: "keyword-search", label: "キーワード検索", description: "**キーワード**で絞り込む",
    params: [{ id: "keyword", label: "キーワード項目", kind: "item" as const }, { id: "title", label: "表題", kind: "text" as const, default: "検索条件" }],
    nodes: [{ id: "panel", type: "search-panel" as const, props: { title: "{{title}}" }, children: [{ id: "kw", type: "field" as const, itemRef: "{{keyword}}" }] }],
  };
  const withComponent: DesignDocInput = {
    ...input,
    screens: [{
      id: "s1", name: "検索画面", items: [{ id: "q", label: "検索語", type: "string", direction: "in" }, { id: "unused", label: "未使用", type: "string" }],
      layout: { version: 1, nodes: [{ id: "box", type: "component", componentRef: "keyword-search", args: { keyword: "q", title: "商品を探す" } }] },
    }],
    flows: [], tables: [], layoutComponents: [def],
  };

  it("画面レイアウトは展開して描き、独自部品の中で使われている項目は未配置にならない", () => {
    const doc = buildDesignDocument(withComponent);
    expect(doc.html).toContain("lv-component");
    expect(doc.html).toContain("商品を探す");
    expect(doc.html).toContain("検索語");
    const section = doc.html.slice(doc.html.indexOf('id="screen-s1"'), doc.html.indexOf('id="components"'));
    expect(section).toContain("未使用");
    expect(section.match(/未配置/g)?.length).toBe(1); // 「未使用」だけ。「検索語」は独自部品の中で配置済み
  });

  it("「独自部品」の章に定義・差し込み口・見た目・使っている画面を出し、以降の章番号が繰り下がる", () => {
    const doc = buildDesignDocument(withComponent);
    expect(doc.toc.some((t) => t.id === "components")).toBe(true);
    expect(doc.html).toContain("キーワード項目");
    expect(doc.html).toContain('<a href="#screen-s1">検索画面</a>');
    expect(doc.html).toContain("<strong>キーワード</strong>");
    expect(doc.html).toMatch(/hd-chapter">12<\/span>要確認事項/);
  });

  it("定義が無いときは章を出さず、章番号は従来どおり", () => {
    const doc = buildDesignDocument({ ...withComponent, layoutComponents: [] });
    expect(doc.toc.some((t) => t.id === "components")).toBe(false);
    expect(doc.html).toMatch(/hd-chapter">11<\/span>要確認事項/);
    expect(doc.html).toContain("定義が見つかりません");
    expect(doc.issues.some((i) => i.message.includes("keyword-search"))).toBe(true);
  });

  it("どの画面でも使われていない独自部品は要確認事項 (情報) にする", () => {
    const doc = buildDesignDocument({ ...withComponent, screens: [{ ...withComponent.screens[0], layout: { version: 1, nodes: [] } }] });
    expect(doc.issues.some((i) => i.section.includes("キーワード検索") && i.message.includes("使われていません"))).toBe(true);
  });
});
