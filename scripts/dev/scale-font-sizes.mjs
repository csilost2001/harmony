#!/usr/bin/env node
/**
 * scale-font-sizes — frontend の CSS の `font-size: 13px` を `font-size: calc(13px * var(--hm-font-scale))` にそろえる。
 * 表示設定の「文字サイズ」(小 / 標準 / 大 / 特大) が、アプリの文字すべてに効くようにするため。rem / em は、html の文字サイズ
 * (`html { font-size: calc(16px * var(--hm-font-scale)) }`) と親から引き継がれるので、そのままでよい。
 *
 *   node scripts/dev/scale-font-sizes.mjs --check   px の直書きが残っていれば終了コード 1 (npm run check の工程)
 *   node scripts/dev/scale-font-sizes.mjs --write   直書きを機械的に直す
 *
 * 紙面 (画面デザインの見本・帳票の見本) は、設計対象のアプリの見た目なので、文字サイズの設定を受けない
 * (その部分だけ `--hm-font-scale: 1` に戻している。styles/tokens.css)。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(root, "frontend/src");
const write = process.argv.includes("--write");
// 数値の px だけを対象にする (calc(...) の中・var(...) は対象外)
const RE = /(font-size:\s*)(\d*\.?\d+)px(\s*(?:;|\}|!important))/g;

function* cssFiles(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* cssFiles(p);
    else if (e.name.endsWith(".css")) yield p;
  }
}

let remaining = 0;
let changed = 0;
for (const f of cssFiles(dir)) {
  const src = fs.readFileSync(f, "utf8");
  if (write) {
    const out = src.replace(RE, (_, a, n, z) => `${a}calc(${n}px * var(--hm-font-scale))${z}`);
    if (out !== src) { fs.writeFileSync(f, out); changed++; }
  } else {
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      RE.lastIndex = 0;
      if (RE.test(line)) { remaining++; console.log(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`); }
    });
  }
}
if (write) console.log(`${changed} ファイルを直しました`);
else if (remaining) { console.error(`\nfont-size の px の直書きが ${remaining} 行あります。calc(Npx * var(--hm-font-scale)) にしてください (node scripts/dev/scale-font-sizes.mjs --write)`); process.exit(1); }
else console.log("font-size の px の直書きはありません");
