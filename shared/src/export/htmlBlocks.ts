/**
 * 設計書の HTML (buildDesignDocument の出力。この関数群が自分で作る、決まった形の HTML) を、Word・Excel に出すための
 * 「ブロック」(見出し・段落・箇条書き・表) にする。任意の HTML を読む構文解析ではない: 知っているタグだけを扱い、
 * 図 (svg)・紙面の見本 (.lv-paper / .rp-paper)・style・script は、ブロックにしない。
 */
export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; rows: string[][]; header: boolean }
  /** 項目名と値の組 (設計書の基本情報) */
  | { type: "pairs"; pairs: Array<[string, string]> };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const SKIP_TAGS = new Set(["svg", "style", "script", "template"]);
const SKIP_CLASSES = ["lv-paper", "rp-paper", "hd-rp", "hd-diagram"];
const VOID = new Set(["br", "hr", "img", "input", "meta", "link"]);

interface Tok { type: "open" | "close" | "text"; tag: string; attrs: string; text: string }

function tokenize(html: string): Tok[] {
  const out: Tok[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) out.push({ type: "text", tag: "", attrs: "", text: m[4] });
    else out.push({ type: m[1] ? "close" : "open", tag: m[2].toLowerCase(), attrs: m[3] ?? "", text: "" });
  }
  return out;
}

const hasSkipClass = (attrs: string) => {
  const c = /class\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "";
  return SKIP_CLASSES.some((k) => c.split(/\s+/).includes(k));
};
const norm = (s: string) => decodeEntities(s).replace(/[ \t\r\f\v]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/^\s+|\s+$/g, "");

export function htmlToBlocks(html: string): DocBlock[] {
  const toks = tokenize(html);
  const blocks: DocBlock[] = [];
  let i = 0;

  /** 開いたタグの対応する閉じタグの直後の位置 (入れ子を数える)。タグが閉じなければ、末尾 */
  const skipSubtree = (start: number, tag: string): number => {
    let depth = 1;
    for (let j = start; j < toks.length; j++) {
      const t = toks[j];
      if (t.type === "open" && t.tag === tag && !VOID.has(tag)) depth++;
      else if (t.type === "close" && t.tag === tag && --depth === 0) return j + 1;
    }
    return toks.length;
  };

  /** 開いたタグの内側の文字 (入れ子のタグは文字だけ。br は改行、スキップ対象は読み飛ばす) と、閉じタグの直後の位置 */
  const inlineText = (start: number, tag: string): { text: string; next: number } => {
    let depth = 1;
    let text = "";
    let j = start;
    for (; j < toks.length; j++) {
      const t = toks[j];
      if (t.type === "text") text += t.text;
      else if (t.type === "open") {
        if (SKIP_TAGS.has(t.tag) || hasSkipClass(t.attrs)) { j = skipSubtree(j + 1, t.tag) - 1; continue; }
        // 章番号 (`<span class="hd-chapter">1</span>画面一覧`) は、題との間を空ける ("1. 画面一覧" / "付録 テスト観点")
        if (t.tag === "span" && /class\s*=\s*"[^"]*\bhd-chapter\b/.test(t.attrs)) {
          const inner = inlineText(j + 1, "span");
          text += inner.text + (/^\d+$/.test(inner.text) ? ". " : " ");
          j = inner.next - 1;
          continue;
        }
        if (t.tag === "br") text += "\n";
        else if (t.tag === tag) depth++;
        else if (t.tag === "li" || t.tag === "p" || t.tag === "div") text += "\n";
      } else if (t.type === "close" && t.tag === tag && --depth === 0) { j++; break; }
    }
    return { text: norm(text), next: j };
  };

  while (i < toks.length) {
    const t = toks[i];
    if (t.type !== "open") { i++; continue; }
    if (SKIP_TAGS.has(t.tag) || hasSkipClass(t.attrs)) { i = skipSubtree(i + 1, t.tag); continue; }
    const hm = /^h([1-4])$/.exec(t.tag);
    if (hm) {
      const { text, next } = inlineText(i + 1, t.tag);
      if (text) blocks.push({ type: "heading", level: Number(hm[1]) as 1 | 2 | 3 | 4, text: text.replace(/\n/g, " ") });
      i = next; continue;
    }
    if (t.tag === "p") {
      const { text, next } = inlineText(i + 1, "p");
      if (text) blocks.push({ type: "paragraph", text });
      i = next; continue;
    }
    if (t.tag === "ul" || t.tag === "ol") {
      const items: string[] = [];
      let j = i + 1;
      while (j < toks.length) {
        const u = toks[j];
        if (u.type === "close" && u.tag === t.tag) { j++; break; }
        if (u.type === "open" && u.tag === "li") { const r = inlineText(j + 1, "li"); if (r.text) items.push(r.text.replace(/\n+/g, " / ")); j = r.next; continue; }
        j++;
      }
      if (items.length) blocks.push({ type: "list", items });
      i = j; continue;
    }
    if (t.tag === "dl") {
      const pairs: Array<[string, string]> = [];
      let j = i + 1;
      let key = "";
      while (j < toks.length) {
        const u = toks[j];
        if (u.type === "close" && u.tag === "dl") { j++; break; }
        if (u.type === "open" && u.tag === "dt") { const r = inlineText(j + 1, "dt"); key = r.text; j = r.next; continue; }
        if (u.type === "open" && u.tag === "dd") { const r = inlineText(j + 1, "dd"); pairs.push([key, r.text.replace(/\n+/g, " ")]); key = ""; j = r.next; continue; }
        j++;
      }
      if (pairs.length) blocks.push({ type: "pairs", pairs });
      i = j; continue;
    }
    if (t.tag === "table") {
      const rows: string[][] = [];
      let header = false;
      let j = i + 1;
      let depth = 1;
      while (j < toks.length) {
        const u = toks[j];
        if (u.type === "open" && u.tag === "table") depth++;
        else if (u.type === "close" && u.tag === "table" && --depth === 0) { j++; break; }
        else if (u.type === "open" && u.tag === "tr") {
          const cells: string[] = [];
          let k = j + 1;
          while (k < toks.length) {
            const c = toks[k];
            if (c.type === "close" && c.tag === "tr") { k++; break; }
            if (c.type === "open" && (c.tag === "td" || c.tag === "th")) { if (c.tag === "th" && rows.length === 0) header = true; const r = inlineText(k + 1, c.tag); cells.push(r.text.replace(/\n+/g, "\n")); k = r.next; continue; }
            k++;
          }
          rows.push(cells);
          j = k; continue;
        }
        j++;
      }
      if (rows.length) blocks.push({ type: "table", rows, header });
      i = j; continue;
    }
    i++;
  }
  return blocks;
}
