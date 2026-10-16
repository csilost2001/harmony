/**
 * 設計書のブロック (htmlToBlocks の出力) を、Markdown にする (UI 改善提案 続編 第 9 弾 #169)。
 * AI・Git・チャットに貼る用の、読みやすい文書。図 (SVG)・画面の見本は、ブロックにならないので含めない。
 */
import type { DocBlock } from "./htmlBlocks.js";

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, "<br>").trim();

export function blocksToMarkdown(blocks: readonly DocBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": out.push(`${"#".repeat(Math.min(Math.max(b.level, 1), 6))} ${b.text}`); break;
      case "paragraph": out.push(b.text.replace(/\n/g, "  \n")); break;
      case "list": out.push(b.items.map((x) => `- ${x}`).join("\n")); break;
      case "pairs": out.push(b.pairs.map(([k, v]) => `- **${k}**: ${v}`).join("\n")); break;
      case "table": {
        const width = Math.max(...b.rows.map((r) => r.length), 1);
        const pad = (r: string[]) => Array.from({ length: width }, (_, i) => cell(r[i] ?? ""));
        const [head, ...body] = b.header ? b.rows : [Array.from({ length: width }, () => ""), ...b.rows];
        out.push([`| ${pad(head).join(" | ")} |`, `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body.map((r) => `| ${pad(r).join(" | ")} |`)].join("\n"));
        break;
      }
    }
  }
  return `${out.join("\n\n")}\n`;
}
