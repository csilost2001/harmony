#!/usr/bin/env node
/**
 * tokenize-color-mix — `color-mix(in srgb, #rrggbb N%, …)` の「直書きの色」を、色相に応じた配色トークンへ置き換える。
 *
 * 機械変換で残った `color-mix(in srgb, #260aff 80%, var(--hm-fg))` などは、ライトテーマの原色を基準にしているため、
 * ダークテーマでは暗い青のまま文字が読みにくくなる。色相に最も近い --hm-hue-* (赤・橙・黄・黄緑・緑・青緑・青・紫) に
 * 置き換えると、種類の見分けを保ったまま、トークンがテーマごとに明るさを調整するため、両テーマで読める。
 *
 * 使い方: node scripts/dev/tokenize-color-mix.mjs [--write]   (既定は変換件数の表示だけ)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src");
const write = process.argv.includes("--write");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

function hue([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return { h: 0, s: 0 };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: d / (mx === 0 ? 1 : mx) };
}
function tokenFor(hex) {
  const v = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  const { h, s } = hue(rgb);
  if (s < 0.15) return "var(--hm-fg-muted)";
  // 色相の区分 (styles/tokens.css の --hm-hue-*)。種類の見分けを保ちつつ、テーマごとの明るさに揃える
  const name = h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 65 ? "amber" : h < 100 ? "lime" : h < 165 ? "green" : h < 200 ? "cyan" : h < 255 ? "blue" : "purple";
  return `var(--hm-hue-${name})`;
}

const counts = {};
let total = 0;
for (const f of walk(root).filter((n) => /\.(css|tsx)$/.test(n) && !n.includes(".test."))) {
  const src = fs.readFileSync(f, "utf8");
  const out = src.replace(/color-mix\(in srgb, #([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g, (_m, hex) => {
    const t = tokenFor(hex);
    counts[t] = (counts[t] ?? 0) + 1; total++;
    return `color-mix(in srgb, ${t}`;
  });
  if (out !== src && write) fs.writeFileSync(f, out);
}
console.log(`${write ? "変換しました" : "変換対象"}: ${total} 件`, counts);
