import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildDesignDocument, deriveCrud, esc, renderStandaloneDesignDoc, type DesignDocInput } from "@harmony/shared";

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
