#!/usr/bin/env node
/**
 * tokenize-colors — アプリ UI の CSS に直書きされた色を、配色トークン
 * (frontend/src/styles/tokens.css) に機械変換する移行スクリプト。
 *
 * 変換規則:
 *  - 無彩色 (彩度が低い色): 用途 (背景 / 文字 / 罫線) と明度、ルールの文脈
 *    (暗色背景のルールか明色背景のルールか) から意味トークンへ置換
 *  - 有彩色の淡色 (明度が高い): 背景・罫線なら color-mix で面の色と混ぜ、
 *    ライト / ダーク両方で自然な淡色にする
 *  - 有彩色の文字色: color-mix で本文色と混ぜ、どちらのテーマでもコントラストを保つ
 *  - 有彩色の中間色の背景・罫線 (ボタン塗り等): そのまま
 *  - 影 (box-shadow / text-shadow) と半透明のオーバーレイ: そのまま
 *
 * 使い方:
 *   node scripts/dev/tokenize-colors.mjs [--dry] [--default-dark a.css,b.css] <file.css>...
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("package.json"));
const postcss = require("postcss");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const ddIdx = argv.indexOf("--default-dark");
const defaultDark = new Set(ddIdx >= 0 ? argv[ddIdx + 1].split(",") : []);
const files = argv.filter((a, i) => !a.startsWith("--") && !(ddIdx >= 0 && i === ddIdx + 1));

// ── color utils ──────────────────────────────────────────────────────────
const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+%?\s*)?\)|\bwhite\b|\bblack\b/g;

function parse(c) {
  if (c === "white") return [255, 255, 255, 1];
  if (c === "black") return [0, 0, 0, 1];
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
  }
  const n = c.match(/[\d.]+%?/g).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x)));
  return [n[0], n[1], n[2], n[3] ?? 1];
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
function midHex([r, g, b]) {
  // 同じ色相で明度 0.52・彩度を維持した代表色 (color-mix の素材)
  const [h, s] = hsl([r, g, b]);
  const sat = Math.max(s, 0.55), l = 0.52;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

// ── role ────────────────────────────────────────────────────────────────
function roleOf(prop) {
  prop = prop.toLowerCase();
  if (prop.includes("shadow")) return "skip";
  if (prop.startsWith("--")) return "skip";
  if (prop === "color" || prop === "fill" || prop === "caret-color" || prop.includes("text-fill") || prop === "text-decoration-color") return "text";
  if (prop.startsWith("background")) return "bg";
  if (prop.startsWith("border") || prop.startsWith("outline") || prop === "stroke" || prop.includes("column-rule") || prop === "accent-color") return "border";
  return "skip";
}

function neutral(role, L, dark, alpha, rule) {
  // ほぼ不透明 (0.85 以上) な半透明色は不透明色として扱う (rgba(255,255,255,0.96) 等)
  if (alpha >= 0.85) alpha = 1;
  if (alpha < 1) {
    if (role === "bg" && alpha <= 0.16) {
      // 薄い黒 (明色文脈) / 薄い白 (暗色文脈) は hover 面
      if ((L < 0.3 && !dark) || (L > 0.7 && dark)) return "var(--hm-hover)";
    }
    // 暗色文脈で半透明の黒を重ねた「一段沈んだ面」(モーダル背景幕 0.45 以上は除く)
    if (role === "bg" && dark && L < 0.3 && alpha < 0.45) return "var(--hm-surface-2)";
    if (role === "border" && alpha <= 0.3) return "var(--hm-border)";
    return null;
  }
  if (role === "bg") {
    if (!dark) {
      if (L >= 0.985) return "var(--hm-surface)";
      if (L >= 0.955) return "var(--hm-surface-2)";
      if (L >= 0.9) return "var(--hm-surface-3)";
      if (L >= 0.6) return "var(--hm-surface-4)";
      if (L < 0.3) return "var(--hm-inverse-bg)";
      return "var(--hm-surface-4)";
    }
    if (L >= 0.9) return "var(--hm-surface)";
    if (L < 0.085) return "var(--hm-bg)";
    if (L < 0.15) return "var(--hm-surface)";
    if (L < 0.2) return "var(--hm-surface-2)";
    if (L < 0.27) return "var(--hm-surface-3)";
    return "var(--hm-surface-4)";
  }
  if (role === "text") {
    if (!dark) {
      if (L < 0.22) return "var(--hm-fg)";
      if (L < 0.4) return "var(--hm-fg-2)";
      if (L < 0.6) return "var(--hm-fg-muted)";
      if (L < 0.86) return "var(--hm-fg-faint)";
      // 明色文脈なのに白い文字 = 塗りの上の文字。塗りが同じルールに無ければ暗色前提の文字とみなす
      return rule.onSolid ? "var(--hm-on-solid)" : "var(--hm-fg)";
    }
    if (L >= 0.86) return rule.onSolid ? "var(--hm-on-solid)" : "var(--hm-fg)";
    if (L >= 0.68) return "var(--hm-fg-2)";
    if (L >= 0.5) return "var(--hm-fg-muted)";
    if (L >= 0.3) return "var(--hm-fg-faint)";
    return "var(--hm-fg)";
  }
  // border
  if (!dark) return L >= 0.88 ? "var(--hm-border)" : "var(--hm-border-strong)";
  return L < 0.3 ? "var(--hm-border)" : "var(--hm-border-strong)";
}

function chromatic(role, rgb, L, alpha, dark, rule = {}) {
  const mid = midHex(rgb);
  if (alpha < 1) {
    if (role === "bg" && alpha <= 0.3) return `color-mix(in srgb, ${mid} ${Math.round(alpha * 100)}%, transparent)`;
    return null;
  }
  if (role === "text") {
    // 暗色文脈の淡い色文字 (例: 紺地の薄紫文字) はテーマに合わせて濃淡を切り替える
    if (L > 0.55 && dark) return `color-mix(in srgb, ${mid} 70%, var(--hm-fg))`;
    if (L > 0.8) return rule.onSolid ? null : `color-mix(in srgb, ${mid} 80%, var(--hm-fg))`;
    return `color-mix(in srgb, ${mid} 80%, var(--hm-fg))`;
  }
  if (role === "bg") {
    if (L >= 0.85) return `color-mix(in srgb, ${mid} ${Math.max(6, Math.round((1 - L) * 100) + 4)}%, var(--hm-surface))`;
    if (L >= 0.72) return `color-mix(in srgb, ${mid} 32%, var(--hm-surface))`;
    if (L < 0.2) return `color-mix(in srgb, ${mid} 22%, var(--hm-surface))`; // 暗色系の色付き面
    return null; // 塗り (ボタン等) はそのまま
  }
  // border
  if (L >= 0.75) return `color-mix(in srgb, ${mid} 38%, var(--hm-surface))`;
  if (L < 0.2) return `color-mix(in srgb, ${mid} 45%, var(--hm-surface))`;
  return null;
}

function mapColor(raw, role, dark, rule) {
  const rgba = parse(raw);
  const [h, s, L0] = hsl(rgba);
  const L = lum(rgba);
  void h; void L0;
  // 鮮やかさ (chroma) が低い色 = 灰・slate 系は無彩色として扱う。HSL 彩度は白に近い色で過大になるため使わない
  const chroma = (Math.max(rgba[0], rgba[1], rgba[2]) - Math.min(rgba[0], rgba[1], rgba[2])) / 255;
  // 紺・墨のような暗い色は彩度があっても無彩色の面・罫線として扱う (暗色テーマ由来の地色)
  const darkNeutral = (role === "bg" || role === "border") && L < 0.22 && s < 0.6;
  if (chroma < 0.17 || darkNeutral) return neutral(role, L, dark, rgba[3], rule);
  return chromatic(role, rgba, L, rgba[3], dark, rule);
}

function ruleInfo(rule, fileDark) {
  let bgL = null, solid = false;
  rule.each((d) => {
    if (d.type !== "decl" || roleOf(d.prop) !== "bg") return;
    for (const m of d.value.match(COLOR_RE) ?? []) {
      const c = parse(m);
      const [, s] = hsl(c);
      if (c[3] < 0.85) continue;
      const chroma = (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255;
      if (chroma < 0.17 || (lum(c) < 0.22 && s < 0.6)) bgL = lum(c);
      else if (lum(c) < 0.7) solid = true;
    }
  });
  const dark = bgL === null ? fileDark : bgL < 0.35;
  return { dark, onSolid: solid };
}

// ── TS / TSX (inline style オブジェクト) ──────────────────────────────────
const TS_PROP_RE = /\b(color|background|backgroundColor|borderColor|border|borderTop|borderBottom|borderLeft|borderRight|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|outline|outlineColor|fill|stroke)\s*:\s*(["'`])([^"'`\n]*?)\2/g;
const camelToKebab = (k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

function enclosingBlock(src, idx) {
  let depth = 0, start = 0, end = src.length;
  for (let i = idx; i >= 0; i--) {
    if (src[i] === "}") depth++;
    else if (src[i] === "{") { if (depth === 0) { start = i; break; } depth--; }
  }
  depth = 0;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { if (depth === 0) { end = i; break; } depth--; }
  }
  return src.slice(start, end);
}

function tsBlockInfo(block, fileDark) {
  let bgL = null, solid = false;
  for (const m of block.matchAll(/\b(?:background|backgroundColor)\s*:\s*["'`]([^"'`]*)["'`]/g)) {
    for (const c of m[1].match(COLOR_RE) ?? []) {
      const rgba = parse(c);
      if (rgba[3] < 0.85) continue;
      const [, sat] = hsl(rgba);
      const L = lum(rgba);
      const chroma = (Math.max(rgba[0], rgba[1], rgba[2]) - Math.min(rgba[0], rgba[1], rgba[2])) / 255;
      if (chroma < 0.17 || (L < 0.22 && sat < 0.6)) bgL = L; else if (L < 0.7) solid = true;
    }
  }
  return { dark: bgL === null ? fileDark : bgL < 0.35, onSolid: solid };
}

function processTs(src, fileDark) {
  let n = 0;
  const out = src.replace(TS_PROP_RE, (whole, prop, q, value, offset) => {
    const role = roleOf(camelToKebab(prop));
    if (role === "skip") return whole;
    const info = tsBlockInfo(enclosingBlock(src, offset), fileDark);
    const next = value.replace(COLOR_RE, (m, off, all) => {
      if (/var\(--[\w-]+,\s*$/.test(all.slice(0, off))) return m;
      if (/color-mix\(in srgb,\s*$/.test(all.slice(0, off))) return m; // 変換済み (冪等)
      const r = mapColor(m, role, info.dark, info);
      if (r) n++;
      return r ?? m;
    });
    return `${prop}: ${q}${next}${q}`;
  });
  return { out, n };
}

let total = 0;
for (const f of files) {
  if (/\.tsx?$/.test(f)) {
    const { out, n } = processTs(fs.readFileSync(f, "utf8"), defaultDark.has(path.basename(f)));
    total += n;
    console.log(`${f}: ${n} 件変換`);
    if (!dry) fs.writeFileSync(f, out);
    continue;
  }
  const src = fs.readFileSync(f, "utf8");
  const root = postcss.parse(src);
  const fileDark = defaultDark.has(path.basename(f));
  let n = 0;
  root.walkRules((rule) => {
    const info = ruleInfo(rule, fileDark);
    rule.each((d) => {
      if (d.type !== "decl") return;
      const role = roleOf(d.prop);
      if (role === "skip") return;
      // var(--x, #fallback) の fallback は変換しない (var 側で解決)
      const next = d.value.replace(COLOR_RE, (m, off, whole) => {
        const before = whole.slice(0, off);
        if (/var\(--[\w-]+,\s*$/.test(before)) return m;
        if (/color-mix\(in srgb,\s*$/.test(before)) return m; // 変換済み (冪等)
        const r = mapColor(m, role, info.dark, info);
        if (r) n++;
        return r ?? m;
      });
      d.value = next;
    });
  });
  total += n;
  console.log(`${f}: ${n} 件変換`);
  if (!dry) fs.writeFileSync(f, root.toString());
}
console.log(`合計 ${total} 件`);
