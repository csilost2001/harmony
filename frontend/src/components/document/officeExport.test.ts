import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { MAX_ZIP_ENTRY_BYTES, buildDesignDocument, buildDocx, buildXlsx, blocksToSheets, createZip, crc32, htmlToBlocks, readZip, sheetName, xmlText, type DesignDocInput } from "@harmony/shared";

const inflate = async (b: Uint8Array) => new Uint8Array(zlib.inflateRawSync(b));
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** createZip (無圧縮) の項目を deflate に差し替えた zip (Excel / Word が作る zip と同じ形) */
function deflateZip(name: string, raw: Uint8Array): Uint8Array {
  const zip = createZip([{ name, data: new Uint8Array(zlib.deflateRawSync(raw)) }]);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 4; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50) dv.setUint16(i + 8, 8, true);
    if (sig === 0x02014b50) dv.setUint16(i + 10, 8, true);
  }
  return zip;
}

describe("zip", () => {
  it("crc32 は既知の値と一致する", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("書いたものを読み戻せる (日本語の名前・空のファイル)", async () => {
    const zip = createZip([{ name: "日本語/設計.txt", data: "こんにちは" }, { name: "empty.txt", data: "" }]);
    const entries = await readZip(zip, inflate);
    expect([...entries.keys()]).toEqual(["日本語/設計.txt", "empty.txt"]);
    expect(dec(entries.get("日本語/設計.txt")!)).toBe("こんにちは");
    expect(entries.get("empty.txt")!.length).toBe(0);
  });
  it("deflate の項目は、渡された inflate で展開して読む", async () => {
    const raw = new TextEncoder().encode("あいう".repeat(500));
    const entries = await readZip(deflateZip("a.txt", raw), inflate);
    expect(dec(entries.get("a.txt")!)).toBe("あいう".repeat(500));
  });
  it("展開後が大きすぎる項目 (ZIP 爆弾) は止める", async () => {
    const zip = deflateZip("bomb.bin", new Uint8Array(10));
    await expect(readZip(zip, async () => new Uint8Array(MAX_ZIP_ENTRY_BYTES + 1))).rejects.toThrow(/大きすぎ/);
  });
  it("壊れた・途中で切れた zip は日本語の理由で失敗する", async () => {
    await expect(readZip(new Uint8Array([1, 2, 3]), inflate)).rejects.toThrow(/ZIP として読めません/);
    const zip = createZip([{ name: "a.txt", data: "x".repeat(100) }]);
    await expect(readZip(zip.subarray(0, 40), inflate)).rejects.toThrow(/ZIP/);
  });
});

describe("htmlToBlocks", () => {
  it("見出し・段落・箇条書き・表・基本情報を読み、svg と紙面の見本は読まない", () => {
    const html = `<article><h2 class="hd-title">章 &amp; 1</h2><p>本文<br>2 行目</p><ul><li>a</li><li>b</li></ul>
      <dl class="hd-info"><dt>名前</dt><dd>値</dd></dl>
      <table><tr><th>列1</th><th>列2</th></tr><tr><td>x</td><td>y</td></tr></table>
      <svg><text>図の文字</text></svg><div class="lv-paper"><p>見本</p></div><script>alert(1)</script></article>`;
    const blocks = htmlToBlocks(html);
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "章 & 1" },
      { type: "paragraph", text: "本文\n2 行目" },
      { type: "list", items: ["a", "b"] },
      { type: "pairs", pairs: [["名前", "値"]] },
      { type: "table", rows: [["列1", "列2"], ["x", "y"]], header: true },
    ]);
  });
});

describe("docx / xlsx", () => {
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
    version: "test",
    generatedAt: "2026-10-08T00:00:00.000Z",
  };
  const blocks = htmlToBlocks(buildDesignDocument(input).html);

  it("設計書から、見出しと表のブロックが取れる", () => {
    expect(blocks.filter((b) => b.type === "heading").length).toBeGreaterThan(5);
    expect(blocks.filter((b) => b.type === "table").length).toBeGreaterThan(3);
  });
  it("docx は必要な部品を持ち、本文が XML として整っている", async () => {
    const entries = await readZip(buildDocx(blocks, { title: "テスト設計書", cover: [["版", "1.0"]] }), inflate);
    const names = [...entries.keys()];
    for (const n of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml"]) expect(names).toContain(n);
    const doc = dec(entries.get("word/document.xml")!);
    expect(doc).toContain("テスト設計書");
    expect(doc).toContain("<w:tbl>");
    expect(doc.match(/<w:p[ >]/g)!.length).toBeGreaterThan(20);
  });
  it("xlsx は章ごとのシートを持つ (シート名は 31 文字以内・重複なし・禁止文字なし)", async () => {
    const sheets = blocksToSheets(blocks, [["版", "1.0"]]);
    const entries = await readZip(buildXlsx(sheets), inflate);
    const wb = dec(entries.get("xl/workbook.xml")!);
    const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names.length).toBe(sheets.length);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const n of names) { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[\[\]:*?/\\]/); }
  });
  it("sheetName は禁止文字・長さ・重複を直す", () => {
    const used = new Set<string>();
    expect(sheetName("a/b:c*d", used)).toBe("a b c d");
    expect(sheetName("a/b:c*d", used)).toBe("a b c d_2");
    expect(sheetName("あ".repeat(50), used).length).toBeLessThanOrEqual(31);
    expect(sheetName("", used)).toBe("シート");
  });
  it("xmlText は XML に使えない文字を落とし、記号を逃がす", () => {
    expect(xmlText("a<b>&\u0001\u0008c\ud800")).toBe("a&lt;b&gt;&amp;c");
  });
});
