#!/usr/bin/env node
/**
 * theme-audit — 起動中の dev server で全主要画面を開き、ライト / ダーク各テーマで
 *   (1) 文字と背景のコントラスト不足 (WCAG 比 < 3.0)
 *   (2) テーマに合わない大きな面 (ライトで暗い面 / ダークで明るい面)
 * を機械検出する。上部ヘッダー (.common-header) と設計キャンバス (iframe) は対象外。
 *
 * 使い方:
 *   node scripts/dev/theme-audit.mjs [--ws <workspace>] [--theme light|dark|both] [--only a,b] [--json out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve("frontend/package.json"));
const { chromium } = require("@playwright/test");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
  return acc;
}, []));
const BASE = args.base ?? "http://localhost:5173";
const wsPath = path.resolve(args.ws ?? "workspaces/dogfood-redesign-20261008");
const themes = (args.theme ?? "both") === "both" ? ["light", "dark"] : [args.theme];
const only = args.only ? new Set(args.only.split(",")) : null;

const harmonyJson = JSON.parse(fs.readFileSync(path.join(wsPath, "harmony.json"), "utf-8"));
const dataDir = path.join(wsPath, harmonyJson.dataDir ?? "harmony");
const firstId = (sub) => {
  const dir = path.join(dataDir, sub);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.includes(".design.") && !n.includes("puck-data")).sort()[0];
  return f ? f.replace(/\.json$/, "") : null;
};
const routes = [
  ["dashboard", "/"], ["screen-flow", "/screen/flow"], ["screen-list", "/screen/list"],
  ["screen-design", "/screen/design/cart"], ["screen-items", "/screen/items/cart"],
  ["table-list", "/table/list"], ["table-edit", "/table/edit/cart"], ["er", "/table/er"],
  ["process-flow-list", "/process-flow/list"], ["process-flow-edit", "/process-flow/edit/order-confirm"],
  ["sequence-list", "/sequence/list"], ["sequence-edit", `/sequence/edit/${firstId("sequences")}`],
  ["view-list", "/view/list"], ["view-edit", `/view/edit/${firstId("views")}`],
  ["view-definition-list", "/view-definition/list"], ["view-definition-edit", `/view-definition/edit/${firstId("view-definitions")}`],
  ["page-layout-list", "/page-layout/list"], ["page-layout-edit", `/page-layout/edit/${firstId("page-layouts")}`],
  ["gadget-list", "/gadget/list"], ["generic-definition", "/generic-definition"],
  ["generic-definition-list", "/generic-definition/message"], ["conventions", "/conventions/catalog"],
  ["extensions", "/extensions"], ["tech-stack", "/project/tech-stack"],
].filter(([n]) => !only || only.has(n));

const auditFn = (theme) => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  };
  const rl = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = ([r, g, b]) => 0.2126 * rl(r) + 0.7152 * rl(g) + 0.0722 * rl(b);
  const blend = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const effectiveBg = (el) => {
    const stack = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.99) break; }
    }
    let bg = theme === "dark" ? [16, 19, 27, 1] : [243, 245, 248, 1];
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
    return bg;
  };
  const selector = (el) => {
    const parts = [];
    for (let e = el, d = 0; e && e.nodeType === 1 && d < 3; e = e.parentElement, d++) {
      const cls = [...e.classList].slice(0, 2).join(".");
      parts.unshift(e.tagName.toLowerCase() + (cls ? "." + cls : ""));
    }
    return parts.join(" > ");
  };
  const skip = (el) => el.closest(".common-header, .react-flow__minimap, iframe, .gjs-frame, [data-theme-audit-skip]");
  const contrast = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || skip(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    if (el.closest("[disabled], .disabled, :disabled")) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = effectiveBg(el);
    const fgc = blend(fg, bg);
    const a = L(fgc), b = L(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3) {
      const key = selector(el);
      if (seen.has(key)) continue;
      seen.add(key);
      contrast.push({ sel: key, text: text.slice(0, 24), ratio: Math.round(ratio * 100) / 100, color: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})` });
    }
  }
  const surfaces = [];
  for (const el of document.querySelectorAll("body *")) {
    if (skip(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 40000 || r.bottom < 0 || r.top > innerHeight) continue;
    const c = parse(getComputedStyle(el).backgroundColor);
    if (!c || c[3] < 0.9) continue;
    const l = L(c);
    if ((theme === "light" && l < 0.08) || (theme === "dark" && l > 0.5)) {
      surfaces.push({ sel: selector(el), bg: getComputedStyle(el).backgroundColor, area: Math.round(r.width * r.height) });
    }
  }
  return { contrast: contrast.slice(0, 25), surfaces: surfaces.slice(0, 10) };
};

const browser = await chromium.launch();
const report = {};
for (const theme of themes) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  const page = await context.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("harmony.appTheme", t); } catch { /* ignore */ } }, theme);
  await page.goto(`${BASE}/workspace/select`);
  await page.getByTestId("workspace-open-or-create").click();
  await page.locator(".tbl-modal input[type='text']").first().fill(wsPath);
  await page.waitForFunction(() => { const b = document.querySelector(".tbl-modal .tbl-btn-primary"); return b && !b.hasAttribute("disabled"); }, null, { timeout: 15000 });
  await page.locator(".tbl-modal .tbl-btn-primary").click();
  await page.waitForURL(/\/w\/[^/]+\//, { timeout: 15000 });
  const wsPrefix = (await page.evaluate(() => location.pathname)).match(/^\/w\/[^/]+/)[0];
  for (const [name, route] of routes) {
    await page.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, `${wsPrefix}${route}`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]'))?.click());
    const r = await page.evaluate(auditFn, theme);
    report[`${theme}:${name}`] = r;
    const issues = r.contrast.length + r.surfaces.length;
    console.log(`${theme.padEnd(5)} ${name.padEnd(24)} 低コントラスト ${String(r.contrast.length).padStart(2)} / 不一致面 ${r.surfaces.length}${issues ? "" : "  ✓"}`);
  }
  await context.close();
}
await browser.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
