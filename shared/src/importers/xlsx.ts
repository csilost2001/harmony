/**
 * Excel (.xlsx) の読み込み。シートごとの、行・セルの文字だけを取り出す (書式・数式・図は読まない)。
 * 取り出した表は、テーブルのカラム・画面項目の貼り付け (タブ区切りの文字) と同じ入口に渡す。
 */
import { readZip } from "../export/zip.js";
import { decodeEntities } from "../export/htmlBlocks.js";

export interface XlsxSheetData { name: string; rows: string[][] }

const MAX_ROWS = 20000;
const MAX_COLS = 200;
/** 読む要素の数の上限 (閉じていない・膨らませたデータが、時間を使わせないように)。値が空の要素も数える */
const MAX_ELEMENTS = 400_000;
/** 1 つの sheet の XML の大きさの上限 */
const MAX_SHEET_CHARS = 32 * 1024 * 1024;

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

interface El { attrs: string; inner: string }
/**
 * `<tag ...>…</tag>` と `<tag ... />` を、前から順に切り出す。正規表現ではなく indexOf で進むので、閉じていない要素が多くても、
 * 入力の大きさに比例した時間で済む (閉じタグが見つからなければ、そこで打ち切る)。tag の直後は、空白・`>`・`/` のどれか (`<tr>` を `<t>` と取り違えない)。
 */
function* elements(xml: string, tag: string, limit = MAX_ELEMENTS): Generator<El> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0, count = 0;
  while (count < limit) {
    const at = xml.indexOf(open, pos);
    if (at < 0) return;
    const next = xml.charCodeAt(at + open.length);
    // タグ名の続き (例: `<row` に対する `<rows`) は、別の要素
    if (!(next === 62 /* > */ || next === 47 /* / */ || next === 32 || next === 9 || next === 10 || next === 13)) { pos = at + open.length; continue; }
    const gt = xml.indexOf(">", at + open.length);
    if (gt < 0) return;
    count++;
    const attrs = xml.slice(at + open.length, gt);
    if (xml.charCodeAt(gt - 1) === 47) { pos = gt + 1; yield { attrs: attrs.slice(0, -1), inner: "" }; continue; }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) return;
    pos = end + close.length;
    yield { attrs, inner: xml.slice(gt + 1, end) };
  }
}
const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m?.[1];
};
const textOf = (xml: string): string => { let out = ""; for (const t of elements(xml, "t")) out += decodeEntities(t.inner); return out; };

export async function readXlsx(bytes: Uint8Array, inflate: (raw: Uint8Array) => Promise<Uint8Array>): Promise<XlsxSheetData[]> {
  const files = await readZip(bytes, inflate);
  const dec = new TextDecoder();
  const get = (name: string): string | null => { const b = files.get(name); return b ? dec.decode(b) : null; };
  const wb = get("xl/workbook.xml");
  if (!wb) throw new Error("Excel (.xlsx) として読めません (xl/workbook.xml がありません)");
  const target = new Map<string, string>();
  for (const r of elements(get("xl/_rels/workbook.xml.rels") ?? "", "Relationship", 10_000)) {
    const id = attr(r.attrs, "Id");
    const t = attr(r.attrs, "Target");
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const shared: string[] = [];
  for (const si of elements(get("xl/sharedStrings.xml") ?? "", "si", 1_000_000)) shared.push(textOf(si.inner));
  const sheets: XlsxSheetData[] = [];
  for (const sh of elements(wb, "sheet", 1_000)) {
    const name = decodeEntities(attr(sh.attrs, "name") ?? "");
    const rid = attr(sh.attrs, "r:id");
    const path = rid ? target.get(rid) : undefined;
    const xml = path ? get(path) : null;
    if (!xml) continue;
    if (xml.length > MAX_SHEET_CHARS) throw new Error(`シート「${name}」が大きすぎます`);
    // 行番号 (r) は信用しない: 上限を超える行は読まない (数百バイトのファイルが、巨大な疎な配列を作らないように)
    const rows: string[][] = [];
    for (const row of elements(xml, "row")) {
      const rowNo = Number(attr(row.attrs, "r") ?? rows.length + 1) - 1;
      if (!Number.isInteger(rowNo) || rowNo < 0 || rowNo >= MAX_ROWS) continue;
      const cells: string[] = [];
      for (const c of elements(row.inner, "c", MAX_COLS * 4)) {
        const ref = attr(c.attrs, "r");
        const idx = ref ? colIndex(ref) : cells.length;
        if (idx < 0 || idx >= MAX_COLS) continue;
        const type = attr(c.attrs, "t");
        let val = "";
        if (type === "inlineStr") val = textOf(c.inner);
        else {
          const v = elements(c.inner, "v", 1).next().value;
          const raw = v?.inner ?? "";
          if (type === "s") val = shared[Number(raw)] ?? "";
          else if (type === "b") val = raw === "1" ? "TRUE" : "FALSE";
          else val = decodeEntities(raw);
        }
        while (cells.length < idx) cells.push("");
        cells[idx] = val;
      }
      while (rows.length < rowNo) rows.push([]);
      rows[rowNo] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/** 表を、貼り付けと同じ、タブ区切りの文にする (セルの中のタブ・改行は空白にする) */
export function rowsToTsv(rows: readonly string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n").replace(/\n+$/, "");
}
