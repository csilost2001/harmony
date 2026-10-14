#!/usr/bin/env node
/**
 * narrow-audit — 狭い画面 (タブレット幅など) で、全主要画面を開き、操作できなくなる崩れを機械検出する。
 *   (1) ページ全体が横にはみ出す (横スクロールが出る)
 *   (2) スクロールできない入れ物の外へ出てしまっている要素 (右端が画面の外で、途中にスクロールの入れ物が無い)
 *   (3) ヘッダー (.common-header) の操作が画面の外に出ている
 * dev server が起動していなければ自動で起動し、終了時に止める。指摘があれば終了コード 1。
 *
 * 使い方: node scripts/dev/narrow-audit.mjs [--width 1024,768] [--height 768] [--ws <workspace>] [--only a,b] [--json out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ensureDevServers, resolveWorkspace } from "./lib/dev-servers.mjs";

const require = createRequire(path.resolve("frontend/package.json"));
const { chromium } = require("@playwright/test");

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, arr) => {
  if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
  return acc;
}, []));
const BASE = args.base ?? "http://localhost:5173";
const widths = (args.width ?? "1024,768").split(",").map(Number);
const height = Number(args.height ?? 768);
const wsPath = resolveWorkspace(args.ws ?? "workspaces/dogfood-redesign-20261008");
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
  ["sequence-list", "/sequence/list"], ["view-list", "/view/list"], ["view-definition-list", "/view-definition/list"],
  ["page-layout-list", "/page-layout/list"], ["gadget-list", "/gadget/list"], ["generic-definition", "/generic-definition"],
  ["conventions", "/conventions/catalog"], ["extensions", "/extensions"], ["tech-stack", "/project/tech-stack"], ["document", "/document"],
  ["analysis", "/analysis"], ["report-list", "/report/list"], ["report-edit", `/report/edit/${firstId("reports") ?? "delivery-note"}`],
  ["business-flow-list", "/business-flow/list"], ["business-flow-edit", `/business-flow/edit/${firstId("business-flows") ?? "order-to-shipment"}`],
].filter(([n]) => !only || only.has(n));

const auditFn = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const sel = (el) => {
    const parts = [];
    for (let e = el, d = 0; e && e.nodeType === 1 && d < 3; e = e.parentElement, d++) {
      const cls = [...e.classList].slice(0, 2).join(".");
      parts.unshift(e.tagName.toLowerCase() + (cls ? "." + cls : ""));
    }
    return parts.join(" > ");
  };
  if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: "page-overflow", detail: `ページの幅 ${document.documentElement.scrollWidth}px が画面 ${vw}px を超える` });
  const scrollable = (el) => { const o = getComputedStyle(el); return /(auto|scroll)/.test(o.overflowX) || /(auto|scroll)/.test(o.overflow); };
  const clipped = (el) => { const o = getComputedStyle(el); return o.overflowX === "hidden" || o.overflow === "hidden" || o.overflowX === "clip"; };
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("iframe, .react-flow, .gjs-frame, [data-theme-audit-skip], .sld-paper, svg")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.left >= vw || r.bottom < 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.position === "fixed") continue;
    if (r.right <= vw + 1) continue;
    // 途中に、横にスクロールできる入れ物があれば、そこで見られるので、よい。切り取る (hidden) 入れ物の中なら、見えない = 崩れ
    let ok = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (scrollable(p)) { ok = true; break; }
      if (clipped(p) && p.getBoundingClientRect().right <= vw + 1) { ok = false; break; }
    }
    if (ok) continue;
    const key = sel(el);
    if (seen.has(key)) continue;
    seen.add(key);
    if (/^(INPUT|BUTTON|A|SELECT|TEXTAREA|TD|TH|LI|DIV|SPAN|P|H[1-6]|LABEL)$/.test(el.tagName) && (el.textContent ?? "").trim().length + (el.tagName === "INPUT" || el.tagName === "SELECT" ? 1 : 0) > 0) {
      out.push({ kind: "offscreen", detail: `${key} (右端 ${Math.round(r.right)}px / 画面 ${vw}px) 「${(el.textContent ?? "").trim().slice(0, 16)}」` });
    }
  }
  const header = document.querySelector(".common-header");
  if (header) {
    for (const b of header.querySelectorAll("button, a")) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) out.push({ kind: "header-offscreen", detail: `ヘッダーの操作が画面の外 (${(b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "").trim().slice(0, 20)})` });
    }
  }
  return out.slice(0, 12);
};

const servers = await ensureDevServers();
const browser = await chromium.launch();
const report = {};
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
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
    const r = await page.evaluate(auditFn);
    report[`${width}:${name}`] = r;
    console.log(`${String(width).padEnd(5)} ${name.padEnd(24)} ${r.length ? `崩れ ${r.length}` : "✓"}`);
    for (const x of r) console.log(`        - [${x.kind}] ${x.detail}`);
  }
  await context.close();
}
await browser.close();
servers.stop();
if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
const total = Object.values(report).reduce((n, r) => n + r.length, 0);
console.log(total ? `\n崩れ ${total} 件` : "\n崩れ 0 件");
process.exit(total ? 1 : 0);
