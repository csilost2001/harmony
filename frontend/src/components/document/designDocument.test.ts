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

  it("処理記述表の分岐の条件は、人が読む言葉になり、もとの式も添える", () => {
    const flow = { meta: { id: "w", name: "語", flowType: "screen" }, actions: [{ id: "a", name: "A", trigger: "click", inputs: [{ name: "n", label: "件数" }], steps: [
      { id: "s1", kind: "dbAccess", description: "取得", operation: "SELECT", tableId: "customer-master", sql: "SELECT id FROM t", outputBinding: { name: "customer", label: "取引先" } },
      { id: "s1b", kind: "log", description: "記録", level: "info", runIf: "@customer != null" },
      { id: "s2", kind: "branch", description: "分ける", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "@customer == null || @inputs.n > 3 && @customer.isActive == false" }, steps: [{ id: "r1", kind: "return", description: "終了" }] }, { id: "b2", code: "B", condition: { kind: "tryCatch", errorCode: "E1" }, steps: [] }] },
    ] }] };
    const html = renderStandaloneDesignDoc({ ...input, flows: [flow as never] });
    expect(html).toContain("取引先 が ない または 件数 が 3 より大きい かつ");
    expect(html).toContain('<code class="hd-cond-raw">@customer == null || @inputs.n &gt; 3');
    // 工程の実行条件 (runIf) も、言葉 + もとの式
    expect(html).toContain("実行条件: 取引先 が ある");
    expect(html).toContain('<code class="hd-cond-raw">@customer != null</code>');
    // 式でない条件 (tryCatch) は、もとの文字のまま (式を添えない)
    expect(html).toContain("エラー「E1」が起きたとき");
    expect(html).not.toContain("hd-cond-raw\">catch");
    // テスト観点の到達条件も、言葉で出る (conditions は、もとの文字のまま)
    expect(html).toMatch(/A \(取引先 が ない または/);
  });

  it("複合条件の分岐は、判定表 (条件の行 × 道の列) と見落としの指摘が出る。条件が 1 つだけの分岐は出ない", () => {
    const flow = { meta: { id: "d", name: "判", flowType: "screen" }, actions: [{ id: "a", name: "A", trigger: "click", inputs: [{ name: "type", label: "種別" }, { name: "amount", label: "金額" }], steps: [
      { id: "s1", kind: "branch", description: "区分", branches: [
        { id: "b1", code: "A", condition: { kind: "expression", expression: "@inputs.type == 'corp' && @inputs.amount > 100" }, steps: [{ id: "x1", kind: "log", description: "上長承認", level: "info" }] },
        { id: "b2", code: "B", condition: { kind: "expression", expression: "@inputs.type == 'corp' && @inputs.amount <= 100" }, steps: [{ id: "x2", kind: "log", description: "自動承認", level: "info" }] },
      ] },
      { id: "s2", kind: "branch", description: "単純", branches: [{ id: "b3", code: "A", condition: { kind: "expression", expression: "@inputs.type == 'x'" }, steps: [] }], elseBranch: { id: "e", code: "B", steps: [] } },
    ] }] };
    const html = renderStandaloneDesignDoc({ ...input, flows: [flow as never] });
    expect(html.match(/<h4 class="hd-sub">判定表/g)).toHaveLength(1);
    expect(html).toContain("種別 が 「corp」 と等しい");
    expect(html).toContain("金額 が 100 より大きい");
    expect(html).toContain('<span class="hd-dt-yes">○</span>');
    expect(html).toContain('<span class="hd-dt-no">×</span>');
    expect(html).toContain("上長承認");
    // 「それ以外」が無いので、どの道にも入らない組み合わせを指摘する
    expect(html).toContain("どの道にも入りません");
  });

  it("判定表: 道の記号も HTML エスケープされる。ガード (それ以外なし) は、抜けの警告を出さない。「A または B」だけの分岐は出ない", () => {
    const flow = { meta: { id: "g", name: "ガ", flowType: "screen" }, actions: [{ id: "a", name: "A", trigger: "click", inputs: [], steps: [
      { id: "g1", kind: "branch", description: "ガード", branches: [{ id: "b1", code: "A", condition: { kind: "expression", expression: "@cust == null || @q == null" }, steps: [{ id: "r1", kind: "return", description: "404" }] }] },
      { id: "g2", kind: "branch", description: "または", branches: [{ id: "b2", code: "A", condition: { kind: "expression", expression: "@a == 1 || @b == 2" }, steps: [] }, { id: "b3", code: "B", condition: { kind: "expression", expression: "@c == 3" }, steps: [] }], elseBranch: { id: "e", code: "X", steps: [] } },
      { id: "g3", kind: "branch", description: "悪意", branches: [{ id: "b4", code: "A", condition: { kind: "expression", expression: "@a == 1 && @b == 2" }, steps: [] }, { id: "b5", code: "B<img src=x onerror=1>", condition: { kind: "tryCatch", errorCode: "E" }, steps: [] }], elseBranch: { id: "e2", code: "X", steps: [] } },
    ] }] };
    const html = renderStandaloneDesignDoc({ ...input, flows: [flow as never] });
    expect(html).not.toContain("<img src=x onerror=1>");
    expect(html).toContain("B&lt;img src=x onerror=1&gt;");
    // ガードの判定表は、「どの道にも入りません」と言わない。「A または B」だけの分岐 (g2) は、表を出さない
    expect(html).not.toContain("どの道にも入りません");
    expect(html.match(/<h4 class="hd-sub">判定表/g)).toHaveLength(2);
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

describe("要確認事項の対象 (ref)", () => {
  it("CRUD の所見はテーブルを指し、設計書の「要確認事項」の対象は該当節へのリンクになる", () => {
    const doc = buildDesignDocument(input);
    const crudIssue = doc.issues.find((i) => i.section.startsWith("CRUD") && i.message.includes("どの処理フローからも使われていません"));
    expect(crudIssue?.ref).toEqual({ kind: "table", id: "customer-master" });
    expect(doc.html).toContain('<a href="#table-customer-master">CRUD');
  });

  it("画面・業務フロー・帳票の指摘は、その設計を指す", () => {
    const doc = buildDesignDocument({
      ...input,
      screens: [...input.screens, { id: "draft-screen", name: "下書き画面", kind: "form", path: "/d", items: [] } as never],
      businessFlows: [{ id: "bf1", name: "業務", lanes: [{ id: "a", name: "A" }], steps: [{ id: "s", lane: "zz", kind: "task", name: "x" }] } as never],
    });
    expect(doc.issues.find((i) => i.section === "画面 下書き画面")?.ref).toEqual({ kind: "screen", id: "draft-screen" });
    expect(doc.issues.find((i) => i.section === "業務フロー 業務")?.ref).toEqual({ kind: "businessFlow", id: "bf1" });
    expect(doc.html).toContain('href="#business-flow-bf1"');
  });
});
