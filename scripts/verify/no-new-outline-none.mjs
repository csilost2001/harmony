#!/usr/bin/env node
/**
 * フォーカスの輪郭 (outline) を消す宣言を、増やさない (UI 改善提案 続編 第 10 弾 #182)。
 * キーボードで操作するとき、どこにフォーカスがあるかが見えなくなるため。`outline: none` / `outline: 0` を使うなら、
 * 代わりの見た目 (box-shadow・border-color) を同じ規則に書く必要がある。既存の宣言は baseline に控え、ファイルごとに件数が増えたら失敗する。
 * 新しい部品は、styles/a11y.css の共通のフォーカスリング (--hm-focus-ring) に任せる (何も書かない)。
 *
 * 使い方: node scripts/verify/no-new-outline-none.mjs [--update]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stylesDir = path.join(root, "frontend/src/styles");
const baselineFile = path.join(root, "scripts/verify/no-new-outline-none.baseline.json");
const RE = /outline\s*:\s*(none|0)\b/g;

export function countOutlineNone(css) {
  // コメントは数えない
  return (css.replace(/\/\*[\s\S]*?\*\//g, "").match(RE) ?? []).length;
}

function scan() {
  const out = {};
  for (const f of fs.readdirSync(stylesDir).filter((n) => n.endsWith(".css")).sort()) {
    const n = countOutlineNone(fs.readFileSync(path.join(stylesDir, f), "utf8"));
    if (n > 0) out[f] = n;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = scan();
  if (process.argv.includes("--update")) {
    fs.writeFileSync(baselineFile, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`baseline を更新しました (${Object.values(now).reduce((a, b) => a + b, 0)} 件)`);
    process.exit(0);
  }
  const base = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : {};
  const bad = Object.entries(now).filter(([f, n]) => n > (base[f] ?? 0));
  if (bad.length) {
    console.error("フォーカスの輪郭を消す宣言 (outline: none / 0) が増えています:");
    for (const [f, n] of bad) console.error(`  frontend/src/styles/${f}: ${base[f] ?? 0} → ${n} 件`);
    console.error("\n新しい部品は、共通のフォーカスリング (styles/a11y.css) に任せてください (outline を書かない)。消すなら、同じ規則に代わりの見た目 (box-shadow・border-color) を書き、--update で baseline を更新してください。");
    process.exit(1);
  }
  const total = Object.values(now).reduce((a, b) => a + b, 0);
  console.log(`OK (outline を消す宣言 ${total} 件。増えていません)`);
}
