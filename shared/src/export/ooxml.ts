/**
 * Word (.docx)・Excel (.xlsx) の書き出し。外部の依存なしに、必要な最小の OOXML を組み立てて ZIP にする。
 * 入力は、設計書の HTML から作ったブロック (htmlBlocks.ts)。図 (SVG)・紙面の見本は、含めない。
 */
import { createZip } from "./zip.js";
import type { DocBlock } from "./htmlBlocks.js";

/** XML 1.0 で使えない文字 (制御文字・単独のサロゲートなど) を除き、& < > を逃がす */
export function xmlText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const ok = c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
    if (!ok) continue;
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : ch;
  }
  return out;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ── Word ────────────────────────────────────────────────────────────────

export interface DocxOptions {
  /** 文書の題 (表紙・ヘッダー) */
  title: string;
  /** ヘッダーの文字 (省略時は、題) */
  header?: string;
  /** フッターの文字 (ページ番号の前) */
  footer?: string;
  /** 表紙に出す項目 (項目名 → 値) */
  cover?: Array<[string, string]>;
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function runs(text: string, rPr = ""): string {
  const lines = text.split("\n");
  return lines.map((l, i) => `${i > 0 ? `<w:r><w:br/></w:r>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlText(l)}</w:t></w:r>`).join("");
}
const para = (text: string, style?: string, extra = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${runs(text)}</w:p>`;

function tableXml(rows: string[][], header: boolean): string {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join("")}</w:tblGrid>`;
  const b = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="9AA3B2"/>`;
  const props = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(b).join("")}</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const trs = rows.map((r, ri) => {
    const head = header && ri === 0;
    const cells = Array.from({ length: cols }, (_, ci) => {
      const text = r[ci] ?? "";
      const shade = head ? '<w:shd w:val="clear" w:color="auto" w:fill="E7EBF2"/>' : "";
      const p = `<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr>${runs(text, head ? "<w:b/>" : "")}</w:p>`;
      return `<w:tc><w:tcPr>${shade}</w:tcPr>${p}</w:tc>`;
    }).join("");
    return `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells}</w:tr>`;
  }).join("");
  return `<w:tbl>${props}${grid}${trs}</w:tbl><w:p/>`;
}

export function buildDocx(blocks: readonly DocBlock[], opts: DocxOptions): Uint8Array {
  const body: string[] = [];
  // 表紙
  body.push(para(opts.title, "Title"));
  if (opts.cover?.length) body.push(tableXml(opts.cover.map(([k, v]) => [k, v]), false));
  body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  for (const b of blocks) {
    if (b.type === "heading") body.push(para(b.text, `Heading${b.level}`));
    else if (b.type === "paragraph") body.push(para(b.text));
    else if (b.type === "list") for (const it of b.items) body.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${runs(it)}</w:p>`);
    else if (b.type === "table") body.push(tableXml(b.rows, b.header));
    else body.push(tableXml(b.pairs.map(([k, v]) => [k, v]), false));
  }
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1021" w:bottom="1134" w:left="1021" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  const document = `${XML}<w:document ${W_NS}><w:body>${body.join("")}${sect}</w:body></w:document>`;
  const font = '<w:rFonts w:ascii="Yu Gothic" w:hAnsi="Yu Gothic" w:eastAsia="Yu Gothic" w:cs="Yu Gothic"/>';
  const heading = (n: number, sz: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 200}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  const styles = `${XML}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="21"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="480"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
${heading(1, 32)}${heading(2, 26)}${heading(3, 23)}${heading(4, 21)}
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/><w:color w:val="5D677A"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="16"/><w:color w:val="5D677A"/></w:rPr></w:style>
</w:styles>`;
  const numbering = `${XML}<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="・"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="420" w:hanging="260"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const header = `${XML}<w:hdr ${W_NS}>${para(opts.header ?? opts.title, "Header")}</w:hdr>`;
  const footer = `${XML}<w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${opts.footer ? runs(`${opts.footer}  `) : ""}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  return createZip([
    { name: "[Content_Types].xml", data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>` },
    { name: "_rels/.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>` },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    { name: "word/numbering.xml", data: numbering },
    { name: "word/header1.xml", data: header },
    { name: "word/footer1.xml", data: footer },
  ]);
}

// ── Excel ───────────────────────────────────────────────────────────────

export interface XlsxSheet {
  name: string;
  /** 行ごとの、セルの文字。先頭が空でない行の styles: 1 = 見出し行 (太字・塗り)、2 = 章の題 (太字・大きめ)、0 = 通常 */
  rows: Array<{ cells: string[]; style?: 0 | 1 | 2 }>;
  colWidths?: number[];
}

const CELL_MAX = 32000;
export function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "").slice(0, 28) || "シート";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28 - String(n).length - 1)}_${n}`;
  used.add(name.toLowerCase());
  return name;
}

function colName(i: number): string { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  const used = new Set<string>();
  const list = (sheets.length ? sheets : [{ name: "シート", rows: [] }]).map((s) => ({ ...s, name: sheetName(s.name, used) }));
  const sheetXml = (s: XlsxSheet) => {
    const rows = s.rows.slice(0, 1_048_000).map((r, ri) => {
      const cells = r.cells.slice(0, 16000).map((c, ci) => {
        if (c === "") return "";
        const style = r.style ?? 0;
        const sid = style === 1 ? 1 : style === 2 ? 2 : c.includes("\n") ? 3 : 0;
        return `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${sid ? ` s="${sid}"` : ""}><is><t xml:space="preserve">${xmlText(c.slice(0, CELL_MAX))}</t></is></c>`;
      }).join("");
      return cells ? `<row r="${ri + 1}">${cells}</row>` : "";
    }).join("");
    const cols = s.colWidths?.length ? `<cols>${s.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(80, Math.max(6, w))}" customWidth="1"/>`).join("")}</cols>` : "";
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Yu Gothic"/></font><font><b/><sz val="10"/><name val="Yu Gothic"/></font><font><b/><sz val="13"/><name val="Yu Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EBF2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;
  return createZip([
    { name: "[Content_Types].xml", data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}

/** ブロックを、章 (h2 / h1) ごとのシートにする。表は見出し行つき、基本情報は 2 列。段落は 1 列目に */
export function blocksToSheets(blocks: readonly DocBlock[], cover?: Array<[string, string]>): XlsxSheet[] {
  const sheets: XlsxSheet[] = [];
  let cur: XlsxSheet | null = null;
  const start = (name: string) => { cur = { name, rows: [] }; sheets.push(cur); return cur; };
  if (cover?.length) { const s = start("表紙"); for (const [k, v] of cover) s.rows.push({ cells: [k, v], style: 0 }); }
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) { const s = start(b.text); s.rows.push({ cells: [b.text], style: 2 }); continue; }
    const s: XlsxSheet = cur ?? start("本文");
    if (b.type === "heading") s.rows.push({ cells: [b.text], style: 1 }), s.rows.push({ cells: [] });
    else if (b.type === "paragraph") s.rows.push({ cells: [b.text] });
    else if (b.type === "list") for (const it of b.items) s.rows.push({ cells: [`・${it}`] });
    else if (b.type === "pairs") { for (const [k, v] of b.pairs) s.rows.push({ cells: [k, v] }); s.rows.push({ cells: [] }); }
    else { b.rows.forEach((r, ri) => s.rows.push({ cells: r, style: b.header && ri === 0 ? 1 : 0 })); s.rows.push({ cells: [] }); }
  }
  for (const s of sheets) {
    const widths: number[] = [];
    for (const r of s.rows.slice(0, 400)) r.cells.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 8, Math.min(60, [...c.split("\n").reduce((a, l) => (l.length > a.length ? l : a), "")].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + 2)); });
    s.colWidths = widths;
  }
  return sheets;
}
