#!/usr/bin/env node
/**
 * clean-junk-screen-items — 旧デザイナの不具合 (開くだけで GrapesJS 内部 id を項目登録) で
 * 混入した画面項目を検出・削除する。
 *
 * 削除条件 (すべて満たすもの): id が GrapesJS 内部 id 形式 (^i[a-z0-9]{3,6}$) または
 * 種別+連番 (button1 等)、かつ label が空、かつ説明・入力規則等の設計情報を持たない。
 *
 * 使い方: node scripts/dev/clean-junk-screen-items.mjs <workspace-dir> [--apply]
 *   --apply なしは検出のみ (dry-run)
 */
import fs from "node:fs";
import path from "node:path";

const [dir, ...rest] = process.argv.slice(2);
if (!dir) { console.error("usage: clean-junk-screen-items.mjs <workspace-dir> [--apply]"); process.exit(2); }
const apply = rest.includes("--apply");
const hj = path.join(dir, "harmony.json");
const dataDir = fs.existsSync(hj) ? path.join(dir, JSON.parse(fs.readFileSync(hj, "utf8")).dataDir ?? "harmony") : dir;
const screensDir = path.join(dataDir, "screens");
if (!fs.existsSync(screensDir)) { console.error(`screens/ が見つかりません: ${screensDir}`); process.exit(2); }

const JUNK_ID = /^(i[a-z0-9]{3,6}|(button|textInput|numberInput|select|textarea|checkbox|radio|dateInput)\d+)$/;
const DESIGN_KEYS = ["description", "pattern", "required", "maxLength", "minLength", "min", "max", "options", "errorMessages", "placeholder", "events", "valueFrom"];
let total = 0;
for (const f of fs.readdirSync(screensDir).filter((n) => n.endsWith(".json") && !n.includes(".design.") && !n.includes("puck"))) {
  const p = path.join(screensDir, f);
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(doc.items)) continue;
  const junk = doc.items.filter((i) => JUNK_ID.test(i.id) && !i.label && !DESIGN_KEYS.some((k) => i[k] !== undefined));
  if (junk.length === 0) continue;
  total += junk.length;
  console.log(`${f}: ${junk.length} 件 (${junk.map((i) => i.id).join(", ")})`);
  if (apply) {
    doc.items = doc.items.filter((i) => !junk.includes(i));
    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
  }
}
console.log(total === 0 ? "混入した項目はありません" : `${apply ? "削除" : "検出 (dry-run)"}: 計 ${total} 件`);
