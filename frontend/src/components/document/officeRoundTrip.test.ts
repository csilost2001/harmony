/**
 * Word / Excel の書き出しを、書き出したあとに**読み戻して**検査する (AI 向け改善 #96)。
 * 実ファイルを Word / Excel で開く代わりに、厳密な XML パーサ (名前空間つき) で全部品を読み、Office が嫌う誤りを探す:
 *   - XML として整っていない・宣言のない接頭辞 (w: r: など)
 *   - [Content_Types] / 関係 (rels) / 参照 (r:id・スタイル・番号) が、実在する部品を指していない
 *   - 本文の文字が、元の設計書の文字と一致しない (落ちる・化ける・順序が違う)
 *   - Word: 表のセルが段落で終わっていない / Excel: 行・セルの番号が昇順でない・スタイルの番号が範囲外・シート名の規則違反
 * 仕様: docs/spec/integration-ops.md (Word / Excel 書き出し)
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { SaxesParser } from "saxes";
import { buildDesignDocument, buildDocx, buildXlsx, blocksToSheets, htmlToBlocks, readZip, type DesignDocInput, type DocBlock } from "@harmony/shared";

const inflate = async (b: Uint8Array) => new Uint8Array(zlib.inflateRawSync(b));
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

interface El { name: string; local: string; uri: string; attrs: Record<string, string>; children: El[]; text: string }

/** 名前空間つきで厳密に読む (整っていない XML・宣言のない接頭辞は例外) */
function parseXml(xml: string, where: string): El {
  const parser = new SaxesParser({ xmlns: true });
  const root: El = { name: "#root", local: "#root", uri: "", attrs: {}, children: [], text: "" };
  const stack: El[] = [root];
  parser.on("error", (e) => { throw new Error(`${where}: XML として読めません — ${e.message}`); });
  parser.on("opentag", (t) => {
    const attrs: Record<string, string> = {};
    for (const a of Object.values(t.attributes)) attrs[a.uri ? `{${a.uri}}${a.local}` : a.name] = a.value;
    const el: El = { name: t.name, local: t.local, uri: t.uri, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(el);
    stack.push(el);
  });
  parser.on("text", (s) => { stack[stack.length - 1].text += s; });
  parser.on("closetag", () => { stack.pop(); });
  parser.write(xml).close();
  if (!root.children[0]) throw new Error(`${where}: 空の XML です`);
  return root.children[0];
}
const all = (e: El, local: string, out: El[] = []): El[] => { if (e.local === local) out.push(e); for (const c of e.children) all(c, local, out); return out; };
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const attr = (e: El, uri: string, local: string) => e.attrs[`{${uri}}${local}`];

const root = path.resolve(__dirname, "../../../../examples/retail");
const readDir = (d: string, f = (n: string) => n.endsWith(".json")) =>
  fs.readdirSync(path.join(root, "harmony", d)).filter(f).map((n) => JSON.parse(fs.readFileSync(path.join(root, "harmony", d, n), "utf-8")));
const harmony = JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8"));
const input: DesignDocInput = {
  project: { id: "retail", name: harmony.meta.name },
  screens: readDir("screens", (n) => n.endsWith(".json") && !n.includes(".design.")),
  flows: readDir("process-flows"), tables: readDir("tables"), businessFlows: readDir("business-flows"), transitions: harmony.entities.screenTransitions,
  version: "test", generatedAt: "2026-10-08T00:00:00.000Z",
};
const designBlocks = htmlToBlocks(buildDesignDocument(input).html);

/** OPC の整合: Content_Types・rels の宛先が実在し、全部品に型がある */
async function checkPackage(zip: Uint8Array, parts: { main: string }) {
  const entries = await readZip(zip, inflate);
  const names = new Set(entries.keys());
  const xmlParts = new Map<string, El>();
  for (const n of names) if (/\.(xml|rels)$/.test(n)) xmlParts.set(n, parseXml(dec(entries.get(n)!), n));
  // Content_Types
  const ct = xmlParts.get("[Content_Types].xml")!;
  const defaults = new Set(all(ct, "Default").map((d) => d.attrs.Extension));
  const overrides = new Set(all(ct, "Override").map((o) => o.attrs.PartName.replace(/^\//, "")));
  for (const o of overrides) expect(names.has(o), `Content_Types の Override ${o} の部品がない`).toBe(true);
  for (const n of names) if (n !== "[Content_Types].xml") expect(overrides.has(n) || defaults.has(n.split(".").pop()!), `${n} に型がない`).toBe(true);
  // rels の宛先
  for (const [n, el] of xmlParts) {
    if (!n.endsWith(".rels")) continue;
    const base = n.replace(/_rels\/[^/]*\.rels$/, "");
    for (const rel of all(el, "Relationship")) expect(names.has(`${base}${rel.attrs.Target}`), `${n} の ${rel.attrs.Id} の宛先 ${rel.attrs.Target} がない`).toBe(true);
  }
  expect(xmlParts.has(parts.main)).toBe(true);
  return { entries, xmlParts };
}

describe("docx の読み戻し", () => {
  const build = async (blocks: readonly DocBlock[], opts = { title: "試験の設計書", cover: [["版", "1.0"], ["作成日", "2026-10-24"]] as Array<[string, string]> }) => {
    const { xmlParts } = await checkPackage(buildDocx(blocks, opts), { main: "word/document.xml" });
    return xmlParts;
  };

  it("全部品が名前空間つきで整っていて、関係・参照・スタイル・番号が実在する (retail の設計書)", async () => {
    const parts = await build(designBlocks);
    const doc = parts.get("word/document.xml")!;
    expect(doc.uri).toBe(W);
    // r:id の参照が、document.xml.rels にある
    const rels = new Set(all(parts.get("word/_rels/document.xml.rels")!, "Relationship").map((r) => r.attrs.Id));
    for (const e of [...all(doc, "headerReference"), ...all(doc, "footerReference")]) expect(rels.has(attr(e, R, "id")!)).toBe(true);
    // 使っているスタイルが styles.xml にある
    const styleIds = new Set(all(parts.get("word/styles.xml")!, "style").map((s) => attr(s, W, "styleId")));
    const used = new Set(all(doc, "pStyle").map((s) => attr(s, W, "val")!));
    for (const u of used) expect(styleIds.has(u), `スタイル ${u} が styles.xml にない`).toBe(true);
    expect(used.has("Heading1") || used.has("Heading2")).toBe(true);
    // 番号 (箇条書き) の参照
    const numIds = new Set(all(parts.get("word/numbering.xml")!, "num").map((n) => attr(n, W, "numId")));
    for (const n of all(doc, "numId")) expect(numIds.has(attr(n, W, "val")!)).toBe(true);
    // 本文の最後は sectPr
    const body = doc.children[0];
    expect(body.local).toBe("body");
    expect(body.children[body.children.length - 1].local).toBe("sectPr");
  });

  it("表: 表の中は tblGrid → tr の順で、どのセルも段落 (w:p) で終わり、どの行も同じ列数。ヘッダー行は tblHeader", async () => {
    const parts = await build(designBlocks);
    const tbls = all(parts.get("word/document.xml")!, "tbl");
    expect(tbls.length).toBeGreaterThan(5);
    for (const t of tbls) {
      const kids = t.children.map((c) => c.local);
      expect(kids[0]).toBe("tblPr");
      expect(kids[1]).toBe("tblGrid");
      const rows = t.children.filter((c) => c.local === "tr");
      const cols = all(t.children[1], "gridCol").length;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const tcs = r.children.filter((c) => c.local === "tc");
        expect(tcs.length).toBe(cols);
        for (const tc of tcs) expect(tc.children[tc.children.length - 1].local, "セルは段落で終わる").toBe("p");
      }
    }
    // 表紙の項目の表は、見出し行の印を持たない。設計書の表は持つ
    expect(tbls.some((t) => all(t, "tblHeader").length === 1)).toBe(true);
  });

  it("本文の文字が、元のブロックの文字と、順序も含めて一致する (見出し・段落・箇条書き・表のセル)", async () => {
    const parts = await build(designBlocks);
    const doc = parts.get("word/document.xml")!;
    const textOf = (p: El) => all(p, "r").map((r) => r.children.map((c) => (c.local === "t" ? c.text : c.local === "br" ? (attr(c, W, "type") === "page" ? "" : "\n") : "")).join("")).join("");
    const body = doc.children[0].children;
    const got: string[] = [];
    for (const el of body) {
      if (el.local === "p") { const t = textOf(el); if (t) got.push(t); }
      else if (el.local === "tbl") for (const tr of el.children.filter((c) => c.local === "tr")) for (const tc of tr.children.filter((c) => c.local === "tc")) for (const p of tc.children.filter((c) => c.local === "p")) got.push(textOf(p));
    }
    const want: string[] = ["試験の設計書", "版", "1.0", "作成日", "2026-10-24"];
    for (const b of designBlocks) {
      if (b.type === "heading" || b.type === "paragraph") want.push(b.text);
      else if (b.type === "list") want.push(...b.items);
      else if (b.type === "table") for (const r of b.rows) { for (let i = 0; i < Math.max(1, ...b.rows.map((x) => x.length)); i++) want.push(r[i] ?? ""); }
      else for (const [k, v] of b.pairs) want.push(k, v);
    }
    // 空のセルの段落は、文字が空なので got に入る (表のセルは空も数える)。順序と内容を比べる
    const strip = (xs: string[]) => xs.filter((x) => x !== "");
    const g = strip(got), w = strip(want);
    const i = g.findIndex((x, k) => x !== w[k]);
    expect(i < 0 ? "" : `差異 ${i}: 読み戻し「${g[i]}」/ 元「${w[i]}」(前: ${g[i - 1]})`).toBe("");
    expect(g).toEqual(w);
  });

  it("危ない文字 (< & \" 制御文字・絵文字・改行・タグらしい文字列) で壊れない。XML に使えない文字だけが落ちる", async () => {
    const nasty = 'a<b>&"c" \u0001\u0008 😀 日本語\n2 行目 <script>alert(1)</script> ]]> <?xml ?>';
    const parts = await build([{ type: "heading", level: 1, text: nasty }, { type: "paragraph", text: nasty }, { type: "table", rows: [[nasty, "x"], ["y", nasty]], header: true }, { type: "list", items: [nasty] }, { type: "pairs", pairs: [[nasty, nasty]] }]);
    const texts = all(parts.get("word/document.xml")!, "t").map((t) => t.text);
    const expected = 'a<b>&"c"  😀 日本語';
    expect(texts.filter((t) => t.startsWith("a<b>")).every((t) => t === expected)).toBe(true);
    expect(texts.filter((t) => t.startsWith("a<b>")).length).toBe(7);
    expect(texts).toContain("2 行目 <script>alert(1)</script> ]]> <?xml ?>");
  });

  it("空の文書・見出し 4 段・空の表でも整った docx になる", async () => {
    await build([]);
    await build([{ type: "heading", level: 1, text: "a" }, { type: "heading", level: 2, text: "b" }, { type: "heading", level: 3, text: "c" }, { type: "heading", level: 4, text: "d" }, { type: "table", rows: [], header: true }, { type: "table", rows: [[]], header: false }, { type: "list", items: [] }]);
  });
});

describe("xlsx の読み戻し", () => {
  const COL = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

  async function build(sheets: ReturnType<typeof blocksToSheets>) {
    return checkPackage(buildXlsx(sheets), { main: "xl/workbook.xml" });
  }

  it("全部品が整っていて、シート・関係・部品・型が一致し、シート名の規則を守る (retail の設計書)", async () => {
    const sheets = blocksToSheets(designBlocks, [["版", "1.0"]]);
    const { xmlParts } = await build(sheets);
    const wb = xmlParts.get("xl/workbook.xml")!;
    const sh = all(wb, "sheet");
    expect(sh.length).toBe(sheets.length);
    const rels = new Map(all(xmlParts.get("xl/_rels/workbook.xml.rels")!, "Relationship").map((r) => [r.attrs.Id, r.attrs.Target]));
    const seen = new Set<string>();
    for (const s of sh) {
      const name = s.attrs.name;
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(31);
      expect(name).not.toMatch(/[[\]:*?/\\]/);
      expect(name).not.toMatch(/^'|'$/);
      expect(seen.has(name.toLowerCase())).toBe(false);
      seen.add(name.toLowerCase());
      const target = rels.get(attr(s, R, "id")!);
      expect(target, `シート ${name} の関係がない`).toBeTruthy();
      expect(xmlParts.has(`xl/${target}`)).toBe(true);
    }
    expect(new Set(sh.map((s) => s.attrs.sheetId)).size).toBe(sh.length);
  });

  it("シートの中身: 行は昇順・セルの番号は行と一致し列は昇順・スタイルの番号は範囲内・文字が元と一致する", async () => {
    const sheets = blocksToSheets(designBlocks, [["版", "1.0"]]);
    const { xmlParts } = await build(sheets);
    const cellXfs = all(xmlParts.get("xl/styles.xml")!, "cellXfs")[0];
    const xfCount = cellXfs.children.filter((c) => c.local === "xf").length;
    expect(Number(cellXfs.attrs.count)).toBe(xfCount);
    sheets.forEach((s, i) => {
      const sheet = xmlParts.get(`xl/worksheets/sheet${i + 1}.xml`)!;
      const rows = all(sheet, "row");
      let prevRow = 0;
      const got: Array<[number, number, string]> = [];
      for (const r of rows) {
        const rn = Number(r.attrs.r);
        expect(rn).toBeGreaterThan(prevRow);
        prevRow = rn;
        let prevCol = 0;
        for (const c of r.children.filter((x) => x.local === "c")) {
          const m = /^([A-Z]+)(\d+)$/.exec(c.attrs.r)!;
          expect(Number(m[2])).toBe(rn);
          const col = COL(m[1]);
          expect(col).toBeGreaterThan(prevCol);
          prevCol = col;
          if (c.attrs.s !== undefined) expect(Number(c.attrs.s)).toBeLessThan(xfCount);
          expect(c.attrs.t).toBe("inlineStr");
          got.push([rn, col, all(c, "t").map((t) => t.text).join("")]);
        }
      }
      const want: Array<[number, number, string]> = [];
      s.rows.forEach((r, ri) => r.cells.forEach((v, ci) => { if (v !== "") want.push([ri + 1, ci + 1, v.slice(0, 32000)]); }));
      expect(got.length, `シート ${s.name}`).toBe(want.length);
      // 文字は xmlText を通る (使えない制御文字は落ちる) ので、落ちない文字だけの設計書では、完全に一致する
      for (let k = 0; k < want.length; k++) expect(got[k]).toEqual(want[k]);
    });
  });

  it("危ない文字・長すぎる文字・改行・同名のシート・長いシート名・多い列で壊れない", async () => {
    const nasty = 'a<b>&"c" \u0001 😀\n2 行目';
    const long = "あ".repeat(40000);
    const sheets = [
      { name: "x/y:z*w?[q]", rows: [{ cells: [nasty, long, ""], style: 1 as const }, { cells: [] }, { cells: ["", "", "c3"] }] },
      { name: "x/y:z*w?[q]", rows: [{ cells: Array.from({ length: 30 }, (_, i) => `v${i}`) }] },
      { name: "あ".repeat(60), rows: [{ cells: ["長い名前"] }] },
      { name: "", rows: [] },
    ];
    const { xmlParts } = await build(sheets);
    const sheet1 = xmlParts.get("xl/worksheets/sheet1.xml")!;
    const ts = all(sheet1, "t").map((t) => t.text);
    expect(ts[0]).toBe("a<b>&\"c\"  😀\n2 行目");
    expect(ts[1].length).toBe(32000); // 長すぎる文字は 32000 文字で切る (Excel の上限 32767)
    const refs = all(xmlParts.get("xl/worksheets/sheet2.xml")!, "c").map((c) => c.attrs.r);
    expect(refs[26]).toBe("AA1"); // 27 列目
    expect(refs[29]).toBe("AD1");
    expect(all(sheet1, "c").find((c) => all(c, "t")[0]?.text.includes("\n"))!.attrs.s).toBeDefined(); // 改行のあるセルは折り返す書式
  });

  it("シートが 0 件でも、整った xlsx (空の 1 枚)", async () => {
    const { xmlParts } = await build([]);
    expect(all(xmlParts.get("xl/workbook.xml")!, "sheet")).toHaveLength(1);
  });
});
