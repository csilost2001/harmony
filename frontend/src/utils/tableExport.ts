/**
 * 一覧の行を、他のアプリ (Excel・AI のチャット) へ渡せる形の文字にする (UI 改善提案 第 3 弾 #52)。画面に依存しない純関数。
 * - tsv: Excel に貼ると、そのまま表になる (セルの中のタブ・改行は、空白にする)
 * - markdown: AI のチャット・Issue・Wiki に貼れる表 (`|` は `\|`、改行は `<br>`)
 * - json: 見出しをキーにした、行の配列
 */
export type ExportFormat = "tsv" | "markdown" | "json";

export const EXPORT_FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: "markdown", label: "Markdown の表" },
  { format: "tsv", label: "TSV (Excel に貼れる)" },
  { format: "json", label: "JSON" },
];

const cell = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

export function toTsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const line = (cells: ReadonlyArray<string | number | null | undefined>) => cells.map((c) => cell(c).replace(/[\t\r\n]+/g, " ")).join("\t");
  return [line(headers), ...rows.map(line)].join("\n");
}

export function toMarkdownTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const esc = (c: string | number | null | undefined) => cell(c).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const line = (cells: ReadonlyArray<string | number | null | undefined>) => `| ${cells.map(esc).join(" | ")} |`;
  return [line(headers), `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

export function toJsonRows(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const objs = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])));
  return JSON.stringify(objs, null, 2);
}

/** CSV (RFC 4180。`,` `"` 改行を含むセルは "…" で囲む)。ファイルにするときは先頭に BOM を付ける (Excel で文字化けしない) */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const esc = (c: string | number | null | undefined) => {
    let t = cell(c);
    // Excel が式として実行する先頭の文字 (= + - @) は、' を付けて文字として開かせる (取り込んだ名前・説明が式にならないように)。数値はそのまま
    if (typeof c === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const line = (cells: ReadonlyArray<string | number | null | undefined>) => cells.map(esc).join(",");
  return [line(headers), ...rows.map(line)].join("\r\n");
}

export function exportRows(format: ExportFormat, headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return format === "tsv" ? toTsv(headers, rows) : format === "markdown" ? toMarkdownTable(headers, rows) : toJsonRows(headers, rows);
}

/** OS のクリップボードへ書く。使えない環境では、見えない入力欄を使う。成功したら true */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
