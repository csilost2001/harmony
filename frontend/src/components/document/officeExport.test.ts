import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { MAX_ZIP_ENTRY_BYTES, buildDiagramText, businessFlowSvg, processFlowSvg, parseDocTemplate, buildDesignDocument, buildDocx, buildXlsx, blocksToSheets, createZip, crc32, htmlToBlocks, readZip, sheetName, xmlText, type DesignDocInput } from "@harmony/shared";

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
    for (const n of names) { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[[\]:*?/\\]/); }
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

describe("設計書の体裁 (document-template)", () => {
  const base: DesignDocInput = {
    project: { id: "p", name: "試験" },
    screens: [{ id: "s1", name: "画面1", kind: "list", path: "/a" } as never],
    flows: [], tables: [], version: "1.0", generatedAt: "2026-10-08T00:00:00.000Z",
  };
  it("文書名・押印欄・改訂履歴・強調の色を表紙と本文に反映する", () => {
    const { template } = parseDocTemplate({ documentTitle: "要件定義書", stamps: ["承認", "確認"], accentColor: "#AA3300", docNumber: "D-1", revisions: [{ version: "1.0", date: "2026-10-01", summary: "初版" }, { version: "1.1", date: "2026-10-05", summary: "画面を追加" }] });
    const doc = buildDesignDocument({ ...base, template });
    expect(doc.html).toContain("要件定義書");
    expect(doc.html).toContain("D-1");
    expect(doc.html.match(/<th>(承認|確認)<\/th>/g)).toHaveLength(2);
    expect(doc.html).not.toContain("<th>審査</th>");
    expect(doc.css).toContain("#aa3300");
    expect(doc.toc.some((t) => t.id === "revisions")).toBe(true);
    // 新しい版が上
    expect(doc.html.indexOf("画面を追加")).toBeLessThan(doc.html.indexOf("初版"));
  });
  it("載せない章を除き、章番号を詰める (目次も)", () => {
    const full = buildDesignDocument(base);
    const ids = full.toc.filter((t) => t.level === 1 && t.id !== "cover").map((t) => t.id);
    expect(ids).toContain("transitions");
    const doc = buildDesignDocument({ ...base, template: parseDocTemplate({ excludeChapters: ["transitions"] }).template });
    expect(doc.html).not.toContain('id="transitions"');
    expect(doc.toc.some((t) => t.id === "transitions")).toBe(false);
    const chapters = [...doc.html.matchAll(/<span class="hd-chapter">(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(chapters).toEqual(chapters.map((_, i) => i + 1));
  });
  it("読めない項目は捨てて理由を返す", () => {
    const r = parseDocTemplate({ accentColor: "red", stamps: "x", revisions: [{ version: "1", date: "2026-13-40", summary: "x" }, { version: "2", date: "2026-10-01", summary: "ok" }], excludeChapters: ["a", "BAD!"] });
    expect(r.problems.length).toBe(4);
    expect(r.template.revisions).toHaveLength(1);
    expect(r.template.excludeChapters).toEqual(["a"]);
  });
});

describe("図の書き出し (Mermaid / PlantUML / SVG)", () => {
  const root = path.resolve(__dirname, "../../../../examples/retail");
  const readDir = (d: string, f = (n: string) => n.endsWith(".json")) =>
    fs.readdirSync(path.join(root, "harmony", d)).filter(f).map((n) => JSON.parse(fs.readFileSync(path.join(root, "harmony", d, n), "utf-8")));
  const harmony = JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8"));
  const input: DesignDocInput = {
    project: { id: "retail", name: harmony.meta.name },
    screens: readDir("screens", (n) => n.endsWith(".json") && !n.includes(".design.")), flows: readDir("process-flows"), tables: readDir("tables"),
    businessFlows: readDir("business-flows"), transitions: harmony.entities.screenTransitions,
  };
  it("ER 図: テーブルと外部キーの関係を、Mermaid と PlantUML で出す", () => {
    const m = buildDiagramText(input, { kind: "er" }, "mermaid")!;
    expect(m.startsWith("erDiagram")).toBe(true);
    expect(m).toMatch(/\|\|--o\{/);
    expect(m).toContain("orders {");
    expect(m).toMatch(/BIGINT id PK/);
    const p = buildDiagramText(input, { kind: "er" }, "plantuml")!;
    expect(p.startsWith("@startuml")).toBe(true);
    expect(p.trimEnd().endsWith("@enduml")).toBe(true);
    expect(p).toMatch(/\|\|--o\{/);
  });
  it("画面遷移図・処理フロー図・業務フロー図は、ノードと矢印を出す。記号を含む名前でも、図を壊さない", () => {
    const sf = buildDiagramText(input, { kind: "screenFlow" }, "mermaid")!;
    expect(sf.startsWith("flowchart LR")).toBe(true);
    expect(sf).toMatch(/s1\["/);
    expect(sf).toMatch(/s\d+ -->/);
    const flowId = input.flows[0].meta.id;
    const pf = buildDiagramText(input, { kind: "processFlow", id: flowId }, "mermaid")!;
    expect(pf.startsWith("flowchart TD")).toBe(true);
    expect(pf).toMatch(/p1\(\[/);
    const bf = buildDiagramText(input, { kind: "businessFlow", id: input.businessFlows![0].id }, "plantuml")!;
    expect(bf).toContain("package \"");
    expect(buildDiagramText(input, { kind: "processFlow", id: "none" }, "mermaid")).toBeNull();
    const tricky = buildDiagramText({ ...input, screens: [{ id: "a", name: 'x"y]\n<b>', path: "/p" } as never, { id: "b", name: "B" } as never], transitions: [{ sourceScreenId: "a", targetScreenId: "b", label: 'q"|r' }] }, { kind: "screenFlow" }, "mermaid")!;
    expect(tricky).not.toMatch(/x"y/);
    expect(tricky).toContain("-->|\"q'｜r\"| s2");
  });
  it("分岐は判断の菱形と条件つきの矢印、繰り返しは戻る矢印、return は終端になる", () => {
    const flow = { meta: { id: "f" }, actions: [{ id: "a", name: "処理", trigger: "click", steps: [
      { id: "s1", kind: "branch", description: "在庫あり?", branches: [{ code: "A", label: "あり", condition: "x", steps: [{ id: "s2", kind: "loop", description: "明細", steps: [{ id: "s3", kind: "compute", description: "加算" }] }] }], elseBranch: { code: "B", label: "なし", steps: [{ id: "s4", kind: "return", description: "エラー" }] } },
      { id: "s5", kind: "return", description: "完了" },
    ] }] };
    const out = buildDiagramText({ ...input, flows: [flow as never] }, { kind: "processFlow", id: "f" }, "mermaid")!;
    expect(out).toContain('{"');
    expect(out).toMatch(/\|"A: あり"\|/);
    expect(out).toMatch(/\|"B: なし"\|/);
    expect(out).toMatch(/-\.->/); // 繰り返しの戻り
    expect((out.match(/\(\["/g) ?? []).length).toBe(3); // 開始 + return 2 つ
  });
  it("SVG: 処理フロー・業務フローは、単体で開ける SVG (名前空間・スタイル・背景つき) になる", () => {
    const svg = processFlowSvg(input, input.flows[0].meta.id)!;
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(".fd-node rect");
    expect(svg).toMatch(/<rect width="100%" height="100%" fill="#ffffff"\/>/);
    expect(svg).not.toContain("var(--hm-");
    const bsvg = businessFlowSvg(input, input.businessFlows![0].id)!;
    expect(bsvg).toContain(".bf-lane-bg");
    expect(processFlowSvg(input, "none")).toBeNull();
    expect(businessFlowSvg(input, "none")).toBeNull();
  });
});
