#!/usr/bin/env node
/**
 * no-raw-colors — アプリ UI にテーマ非対応の直書き色が無いことを検査する。
 *
 * scripts/dev/apply-color-tokens.sh を dry-run で実行し、変換対象 (= トークン化されて
 * いない無彩色・淡色・文字色) が 1 件でもあれば exit 1。
 * 修正方法: `bash scripts/dev/apply-color-tokens.sh` を実行するか、styles/tokens.css の
 * トークン (var(--hm-*)) を直接使う。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = execFileSync("bash", [path.join(root, "scripts/dev/apply-color-tokens.sh")], {
  env: { ...process.env, DRY: "1" },
  encoding: "utf8",
});
const m = out.match(/合計 (\d+) 件/);
const n = m ? Number(m[1]) : -1;
if (n !== 0) {
  console.error(`テーマ非対応の直書き色が ${n} 件あります。bash scripts/dev/apply-color-tokens.sh で変換するか var(--hm-*) を使ってください。`);
  process.exit(1);
}

// color-mix の基準色に 16 進の色を直書きしない (テーマで明るさが変わらず、ダークテーマで文字が読みにくくなる)
import fs from "node:fs";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const bad = walk(path.join(root, "frontend/src"))
  .filter((f) => /\.(css|tsx)$/.test(f) && !f.includes(".test."))
  .flatMap((f) => fs.readFileSync(f, "utf8").split("\n").flatMap((line, i) => (/color-mix\(in srgb, #[0-9a-fA-F]{3,6}\b/.test(line) ? [`${path.relative(root, f)}:${i + 1}`] : [])));
if (bad.length) {
  console.error(`color-mix の基準色に 16 進の色が直書きされています (${bad.length} 件)。var(--hm-accent) / var(--hm-hue-*) などのトークンを使うか、node scripts/dev/tokenize-color-mix.mjs --write で変換してください。`);
  for (const b of bad.slice(0, 10)) console.error(`  ${b}`);
  process.exit(1);
}
console.log("OK: アプリ UI の色はすべて配色トークン経由です");
