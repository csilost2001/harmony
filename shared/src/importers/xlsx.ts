/**
 * Excel (.xlsx) の読み込み。シートごとの、行・セルの文字だけを取り出す (書式・数式・図は読まない)。
 * 取り出した表は、テーブルのカラム・画面項目の貼り付け (タブ区切りの文字) と同じ入口に渡す。
 */
import { readZip } from "../export/zip.js";
import { decodeEntities } from "../export/htmlBlocks.js";

export interface XlsxSheetData { name: string; rows: string[][] }

const MAX_ROWS = 20000;
const MAX_COLS = 200;

const colIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join("");

export async function readXlsx(bytes: Uint8Array, inflate: (raw: Uint8Array) => Promise<Uint8Array>): Promise<XlsxSheetData[]> {
  const files = await readZip(bytes, inflate);
  const dec = new TextDecoder();
  const get = (name: string): string | null => { const b = files.get(name); return b ? dec.decode(b) : null; };
  const wb = get("xl/workbook.xml");
  if (!wb) throw new Error("Excel (.xlsx) として読めません (xl/workbook.xml がありません)");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const t = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const shared = [...(get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheets: XlsxSheetData[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeEntities(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1];
    const path = rid ? target.get(rid) : undefined;
    const xml = path ? get(path) : null;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= MAX_ROWS) break;
      const rowNo = Number(/\br="(\d+)"/.exec(rm[0])?.[1] ?? rows.length + 1) - 1;
      const cells: string[] = [];
      for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const idx = ref ? colIndex(ref) : cells.length;
        if (idx < 0 || idx >= MAX_COLS) continue;
        const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
        const body = cm[2] ?? "";
        let val = "";
        if (type === "s") val = shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1])] ?? "";
        else if (type === "inlineStr") val = textOf(body);
        else if (type === "str" || type === "e") val = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        else if (type === "b") val = /<v>1<\/v>/.test(body) ? "TRUE" : "FALSE";
        else val = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        while (cells.length < idx) cells.push("");
        cells[idx] = val;
      }
      while (rows.length < rowNo && rows.length < MAX_ROWS) rows.push([]);
      rows[rowNo] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/** 表を、貼り付けと同じ、タブ区切りの文字にする (セルの中のタブ・改行は空白にする) */
export function rowsToTsv(rows: readonly string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n").replace(/\n+$/, "");
}
