import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  fieldWidths, nextReportFieldId, nextReportSectionId, parseSource, renameReportRefs, reportToHtml, sampleValue, validateReport,
  buildDesignDocument, type DesignDocInput, type Report, type ReportField,
} from "@harmony/shared";

const report = (over: Partial<Report> = {}): Report => ({
  version: 1, id: "r", name: "テスト帳票",
  output: { format: "pdf", paper: "A4", orientation: "portrait" },
  trigger: { kind: "screen", screenRef: "scr", description: "ボタン" },
  params: [{ id: "orderId", label: "注文番号", required: true }],
  sections: [
    { id: "head", kind: "reportHeader", fields: [{ id: "title", kind: "text", label: "納品書", align: "center" }] },
    { id: "lines", kind: "detail", name: "明細", fields: [
      { id: "name", kind: "field", label: "商品名", source: "order-item.productName", width: 60 },
      { id: "qty", kind: "field", label: "数量", source: "order-item.quantity", format: "#,##0", align: "right", width: 40 },
    ] },
    { id: "total", kind: "reportFooter", fields: [{ id: "sum", kind: "aggregate", label: "合計", source: "order-item.quantity", aggregate: "sum", format: "#,##0" }] },
  ],
  ...over,
});
const tables = new Map([["order-item", new Set(["productName", "quantity"])]]);
const codes = (r: Report, refs = {}) => validateReport(r, refs).map((i) => i.code);

describe("帳票の検証", () => {
  it("整った帳票は問題なし", () => {
    expect(validateReport(report(), { screens: new Set(["scr"]), flows: new Set<string>(), tables })).toEqual([]);
  });
  it("出どころの出力条件・テーブル・列が無い", () => {
    const r = report();
    r.sections[1].fields[0].source = "@param.nope";
    r.sections[1].fields[1].source = "order-item.ghost";
    r.sections[2].fields[0].source = "missing-table.x";
    expect(codes(r, { tables }).sort()).toEqual(["unknown-column", "unknown-param", "unknown-table"]);
  });
  it("グループに groupBy が無い / 出どころ・集計の種類が無い / 明細が無い", () => {
    const r = report({ sections: [
      { id: "g", kind: "groupHeader", fields: [] },
      { id: "x", kind: "reportFooter", fields: [{ id: "a", kind: "aggregate" }, { id: "b", kind: "field" }] },
    ] });
    const c = codes(r);
    expect(c).toEqual(expect.arrayContaining(["group-without-key", "field-without-source", "aggregate-without-func", "no-detail"]));
  });
  it("CSV は明細が無くても警告しない / 重複 ID は error / 幅の超過 / 契機なしは info", () => {
    expect(codes(report({ output: { format: "csv" }, sections: [] }))).not.toContain("no-detail");
    const dup = report(); dup.sections[0].id = "lines";
    expect(validateReport(dup).find((i) => i.code === "duplicate-id")?.severity).toBe("error");
    const wide = report(); wide.sections[1].fields[0].width = 80;
    expect(codes(wide)).toContain("width-over");
    expect(codes(report({ trigger: undefined }))).toContain("no-trigger");
  });
  it("明細部の集計は info。参照先の画面・処理が無いと warning", () => {
    const r = report(); r.sections[1].fields.push({ id: "m", kind: "aggregate", source: "order-item.quantity", aggregate: "sum" });
    expect(codes(r)).toContain("aggregate-in-detail");
    const t = report({ trigger: { screenRef: "ghost", processFlowRef: "gf" } });
    expect(codes(t, { screens: new Set(["scr"]), flows: new Set<string>() }).sort()).toEqual(["unknown-flow", "unknown-screen"]);
  });
});

describe("出どころの分解・見本値・幅", () => {
  it("出どころを分解する", () => {
    expect(parseSource("@param.orderId")).toEqual({ kind: "param", id: "orderId" });
    expect(parseSource("order-item.quantity")).toEqual({ kind: "column", table: "order-item", column: "quantity" });
    expect(parseSource("a + b").kind).toBe("other");
  });
  it("見本値は書式から決まり、同じ入力なら同じ", () => {
    const f = (x: Partial<ReportField>): ReportField => ({ id: "f", kind: "field", ...x });
    expect(sampleValue(f({ format: "¥#,##0" }), 1)).toBe("¥24,680");
    expect(sampleValue(f({ format: "YYYY/MM/DD" }))).toBe("2026/10/09");
    expect(sampleValue(f({ kind: "pageNumber" }))).toBe("1 / 1");
    expect(sampleValue(f({ kind: "text", label: "表題" }))).toBe("表題");
    expect(sampleValue(f({}))).toBe("〇〇〇〇");
  });
  it("幅の指定が無い項目は、残りを均等に分ける", () => {
    expect(fieldWidths([{ id: "a", kind: "text", width: 40 }, { id: "b", kind: "text" }, { id: "c", kind: "text" }])).toEqual([40, 30, 30]);
    expect(fieldWidths([{ id: "a", kind: "text" }, { id: "b", kind: "text" }])).toEqual([50, 50]);
  });
});

describe("用紙の見本図 (HTML)", () => {
  it("用紙・向き・部・明細の見本行を出し、名前をエスケープする", () => {
    const r = report(); r.sections[1].fields[0].label = "<b>商品";
    const html = reportToHtml(r);
    expect(html).toContain("rp-A4 rp-portrait");
    expect(html).toContain("aspect-ratio:210 / 297");
    expect(html).toContain("表題部");
    expect(html).toContain("明細部: 明細");
    expect(html).toContain("合計 1,234");
    expect(html).toContain("&lt;b&gt;商品");
    expect(html.match(/rp-row">/g)?.length).toBeGreaterThanOrEqual(5); // 表題 1 + 見出し行を除く明細 3 + 合計 1
    expect(reportToHtml(r)).toBe(html);
  });
  it("横向き・用紙サイズ・見本行数・選択表示", () => {
    const html = reportToHtml(report({ output: { paper: "A3", orientation: "landscape" } }), { detailRows: 1, interactive: true, selected: { sectionId: "lines", fieldId: "qty" } });
    expect(html).toContain("aspect-ratio:420 / 297");
    expect(html).toContain('data-testid="rp-field-qty"');
    expect(html).toMatch(/rp-selected[^>]*data-field="qty"/);
  });
  it("部が無いときは案内を出す", () => { expect(reportToHtml({ sections: [], name: "x" })).toContain("部がありません"); });
});

describe("編集の補助・改名への追従", () => {
  it("ID を重ならないように採る", () => {
    const r = report();
    expect(nextReportSectionId(r)).toBe("section1");
    expect(nextReportFieldId(r)).toBe("field1");
    expect(nextReportFieldId({ sections: [{ id: "s", kind: "detail", fields: [{ id: "field1", kind: "text" }] }] })).toBe("field2");
  });
  it("画面・処理フロー・テーブルの改名を契機と出どころに反映する", () => {
    const r = report({ trigger: { screenRef: "scr", processFlowRef: "pf" }, sort: [{ field: "order-item.productName" }] });
    expect(renameReportRefs(r, "screen", "scr", "scr2")).toBe(true);
    expect(renameReportRefs(r, "processFlow", "pf", "pf2")).toBe(true);
    expect(r.trigger).toMatchObject({ screenRef: "scr2", processFlowRef: "pf2" });
    expect(renameReportRefs(r, "table", "order-item", "order-line")).toBe(true);
    expect(r.sections[1].fields[0].source).toBe("order-line.productName");
    expect(r.sort![0].field).toBe("order-line.productName");
    expect(renameReportRefs(r, "table", "nothing", "x")).toBe(false);
  });
});

describe("retail サンプルの帳票", () => {
  const root = path.resolve(__dirname, "../../../../examples/retail/harmony");
  const dir = path.join(root, "reports");
  const reports: Report[] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf-8"))) : [];
  const ids = (d: string) => fs.readdirSync(path.join(root, d)).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, ""));
  const tableCols = new Map(ids("tables").map((id) => [id, new Set<string>((JSON.parse(fs.readFileSync(path.join(root, "tables", `${id}.json`), "utf-8")).columns ?? []).map((c: { physicalName: string }) => c.physicalName))]));
  it("帳票があり、参照先 (画面・処理フロー・テーブル・列) がすべて実在して指摘が無い", () => {
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(validateReport(r, { screens: new Set(ids("screens")), flows: new Set(ids("process-flows")), tables: tableCols }), r.id).toEqual([]);
    }
  });
  it("設計書に「帳票」の章と用紙の見本が出る", () => {
    const input: DesignDocInput = { project: { name: "t" }, screens: [], flows: [], tables: [], reports, generatedAt: "2026-10-09T00:00:00.000Z" };
    const doc = buildDesignDocument(input);
    expect(doc.toc.map((t) => t.id)).toContain("reports");
    expect(doc.html).toContain('class="rp-paper');
    expect(doc.html).toMatch(/hd-chapter">10<\/span>帳票/);
  });
});
