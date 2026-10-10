#!/usr/bin/env node
/**
 * prefix-placeholders — 入力欄の入力例 (placeholder) のうち、「値の例」に見えるものの頭に「例: 」を付ける。
 *
 * 入力例は薄い斜体で出すが、色だけでは「入力済みの値」と見分けにくいことがある。値の例 (customers / 1.0.0 / 顧客マスタ など) は
 * 「例: 」を付けて、入力例だと文字でも分かるようにする。操作の案内 (…で絞り込み... / 省略可 / 説明など) には付けない。
 *
 * 使い方: node scripts/dev/prefix-placeholders.mjs [--write | --check]   (既定は一覧の表示だけ。--check は対象があれば終了コード 1 = npm run check で使う)
 *   --write のとき、テストの `placeholder="<旧>"` の完全一致の指定も、新しい文言に合わせて更新する。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const write = process.argv.includes("--write");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

// 操作の案内・項目の説明のような文言 (値の例ではない) には付けない
const HINT = /例|\.\.\.|…|省略|任意|絞り込み|検索|記述|入力|選択|参照|補足|目的|理由|概要|用途|説明|表示名|物理名|メモ|内容|指定|直接|詳細|カンマ|のみ|等|付箋|[（(]/;

// 列の名前・項目名そのもの (表の見出しと同じ語) は、値の例ではなく項目名の案内なので付けない
const FIELD_NAME_HINT = /^(key|label|value|description|name|field|length|min|max|ms|alias|比較値|順序)$/;

const changed = [];
const files = walk(path.join(root, "frontend/src")).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(/placeholder="([^"]+)"/g, (m, text) => {
    if (HINT.test(text) || FIELD_NAME_HINT.test(text)) return m;
    changed.push({ file: path.relative(root, f), from: text });
    return `placeholder="例: ${text}"`;
  });
  if (write && out !== src) fs.writeFileSync(f, out);
}
console.log(`${write ? "変更しました" : "変更対象"}: ${changed.length} 件`);
for (const c of changed) console.log(`  ${c.file}: "${c.from}"`);

if (process.argv.includes("--check") && changed.length) {
  console.error("\n値の例に見える入力例 (placeholder) には「例: 」を付けてください。node scripts/dev/prefix-placeholders.mjs --write で付けられます (案内の文言には付けません)。既定値を薄く出す場合は「既定: 」を付けます。");
  process.exit(1);
}

if (write) {
  // テストの完全一致の指定を新しい文言に合わせる
  const olds = [...new Set(changed.map((c) => c.from))].sort((a, b) => b.length - a.length);
  const tests = walk(path.join(root, "frontend")).filter((f) => /\.(spec|test)\.tsx?$/.test(f) && !f.includes("node_modules"));
  let n = 0;
  for (const f of tests) {
    let s = fs.readFileSync(f, "utf8");
    const before = s;
    for (const o of olds) {
      const esc = o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      s = s.replace(new RegExp(`placeholder=(["'])${esc}\\1`, "g"), (_m, q) => `placeholder=${q}例: ${o}${q}`);
    }
    if (s !== before) { fs.writeFileSync(f, s); n++; }
  }
  console.log(`テストの指定を更新したファイル: ${n} 件`);
}
