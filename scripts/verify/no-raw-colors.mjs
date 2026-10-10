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
console.log("OK: アプリ UI の色はすべて配色トークン経由です");
