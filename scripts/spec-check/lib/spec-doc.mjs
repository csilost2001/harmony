// scripts/spec-check/ 用の共通ヘルパー。docs/spec/conversion-guideline-for-ai.md
// から jsonc fence / ts fence / cheatsheet table を抽出する。
//
// test.mjs はこの module を import して spec doc を test input にする。
// (Round 11 review M-1/M-2/M-3 対応 — spec doc 本体を CI gate の input に含める)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "../../..");
export const SPEC_DOC_PATH = join(ROOT, "docs/spec/conversion-guideline-for-ai.md");

export function readSpecDoc() {
  return readFileSync(SPEC_DOC_PATH, "utf8");
}

/**
 * 指定言語の fence を全件抽出する。
 * @param {string} doc spec doc full text
 * @param {string} lang fence 言語 (例: "jsonc", "ts")
 * @param {object} [opts]
 * @param {boolean} [opts.topLevelOnly] true なら 列 0 で始まる top-level fence のみ
 *        (リスト項目内の indented fence は除外)。デフォルト false。
 * @returns {{ line: number, body: string }[]} 1-origin の開始行 + fence 本文
 */
export function extractFences(doc, lang, opts = {}) {
  const { topLevelOnly = false } = opts;
  const lines = doc.split("\n");
  const out = [];
  const openTag = "```" + lang;
  let inFence = false;
  let startLine = -1;
  let buf = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const matches = topLevelOnly ? line === openTag : line.trim() === openTag;
      if (matches) {
        inFence = true;
        startLine = i + 2; // body 開始行 (1-origin)
        buf = [];
      }
    } else {
      // close tag: top-level なら "```"、許容モードなら trim で OK
      const closeMatches = topLevelOnly ? line === "```" : line.trim() === "```";
      if (closeMatches) {
        out.push({ line: startLine, body: buf.join("\n") });
        inFence = false;
        buf = [];
      } else {
        buf.push(line);
      }
    }
  }
  return out;
}

/**
 * jsonc fence の本文から `// ...` 行と inline `// ...` コメントを取り除く。
 * spec §0.5 で AI に「// 行を全削除してから JSON.parse」と約束した契約と一致。
 */
export function stripJsoncComments(body) {
  // 1) `//` で始まる行 (頭が空白でも OK) を行ごと除去
  const lines = body.split("\n").filter((l) => !/^\s*\/\//.test(l));
  // 2) 各行末尾の ` // ...` inline コメントは扱わない (spec contract は行頭のみ)
  return lines.join("\n");
}

/**
 * spec §3.3 の Step kind cheatsheet 表から各 step kind の行を抽出する。
 * 行フォーマット: `| \`<kind>\` | <required-cell> | <use-cell> |`
 *
 * @returns {Map<string, string>} kind → required-cell の中身 (backticks 含む)
 */
export function parseStepCheatsheet(doc) {
  const out = new Map();
  const lines = doc.split("\n");
  // 表内のみを対象: 「| step kind | 追加必須 field | 用途 |」を起点に空行 or 次見出しまで
  let inTable = false;
  for (const line of lines) {
    if (/^\|\s*step kind\s*\|\s*追加必須 field\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (line.trim() === "" || line.startsWith("#") || line.startsWith("**")) {
        inTable = false;
        continue;
      }
      // separator row `|---|---|---|` をスキップ
      if (/^\|[\s|:-]+\|$/.test(line)) continue;
      // `| \`kind\` | <cell> | <cell> |`
      const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (m) out.set(m[1], m[2]);
    }
  }
  return out;
}
