#!/usr/bin/env node
/**
 * auto-place-items — 業務部品レイアウトを持つ画面で、どこにも置かれていない画面項目を自動配置する。
 *
 * 使い方:
 *   node scripts/dev/auto-place-items.mjs <workspace> [--apply]
 *
 * 既定は確認だけ (ファイルは変えない)。--apply で screens/<id>.json の layout を書き換え、
 * 一覧の「デザイン済」(hasDesign) も合わせる。配置規則は shared/src/layoutAutoPlace.ts
 * (docs/spec/screen-layout.md「未配置の項目の自動配置」)。置き場所は業務部品デザイナで動かせる。
 */
import fs from "node:fs";
import path from "node:path";
import { autoPlaceItems } from "../../shared/dist/index.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? "");
const harmonyPath = path.join(dir, "harmony.json");
if (!fs.existsSync(harmonyPath)) { console.error(`harmony.json が見つかりません: ${dir}`); process.exit(1); }
const harmony = JSON.parse(fs.readFileSync(harmonyPath, "utf8"));
const dataDir = path.join(dir, harmony.dataDir ?? "harmony");
const screensDir = path.join(dataDir, "screens");
const compFile = path.join(dataDir, "layout-components.json");
const defs = fs.existsSync(compFile) ? JSON.parse(fs.readFileSync(compFile, "utf8")).components ?? [] : [];

let total = 0, screens = 0;
for (const f of fs.readdirSync(screensDir).filter((n) => n.endsWith(".json") && !n.includes(".design."))) {
  const p = path.join(screensDir, f);
  const raw = fs.readFileSync(p, "utf8");
  const screen = JSON.parse(raw);
  if (!screen.layout) continue;
  const { layout, placements } = autoPlaceItems(screen.layout, screen.items ?? [], defs);
  if (!placements.length) continue;
  screens++; total += placements.length;
  console.log(`${screen.id}: ${placements.map((x) => `${x.itemId} → ${x.where}`).join(" / ")}`);
  if (apply) {
    screen.layout = layout;
    fs.writeFileSync(p, JSON.stringify(screen, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  }
}
console.log(`${apply ? "配置しました" : "配置できます (--apply で実行)"}: ${screens} 画面 / ${total} 項目`);
