#!/usr/bin/env node
/**
 * ui-shots — 起動中の dev server (5173 + 5179) に対し、指定ワークスペースを開いて
 * 主要画面のスクリーンショットを一括取得する。UI 改修の目視確認・報告書用。
 *
 * 使い方:
 *   node scripts/dev/ui-shots.mjs --ws workspaces/dogfood-redesign-20261008 --out .tmp/screenshots/before
 *   node scripts/dev/ui-shots.mjs --ws ... --out ... --theme dark --only process-flow-edit,screen-design
 *   node scripts/dev/ui-shots.mjs ... --ls harmony.processFlow.view=diagram   (localStorage の初期値)
 *
 * dev server (5173 / 5179) が起動していなければ自動で起動し、終了時に止める (起動済みならそのまま使う)。
 * --ws のワークスペースがなければ examples/retail の複製を使う。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ensureDevServers, resolveWorkspace } from "./lib/dev-servers.mjs";

const require = createRequire(path.resolve("frontend/package.json"));
const { chromium } = require("@playwright/test");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
    return acc;
  }, []),
);
const BASE = args.base ?? "http://localhost:5173";
const wsPath = resolveWorkspace(args.ws ?? "workspaces/dogfood-redesign-20261008");
const outDir = path.resolve(args.out ?? ".tmp/screenshots/ui-shots");
const theme = args.theme; // "light" | "dark" | undefined
const only = args.only ? new Set(args.only.split(",")) : null;
const width = Number(args.width ?? 1440);
const height = Number(args.height ?? 900);
fs.mkdirSync(outDir, { recursive: true });

const harmonyJson = JSON.parse(fs.readFileSync(path.join(wsPath, "harmony.json"), "utf-8"));
const dataDir = path.join(wsPath, harmonyJson.dataDir ?? "harmony");
const firstId = (sub, filter = () => true) => {
  const dir = path.join(dataDir, sub);
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.includes(".design.") && !n.includes("puck-data")).filter(filter).sort()[0];
  return f ? f.replace(/\.json$/, "") : null;
};
const pick = (sub, prefer) => (fs.existsSync(path.join(dataDir, sub, `${prefer}.json`)) ? prefer : firstId(sub));

const screenId = pick("screens", args.screen ?? "cart");
const flowId = pick("process-flows", args.flow ?? "order-confirm");
const tableId = pick("tables", args.table ?? "cart");

const routes = [
  ["dashboard", "/"],
  ["screen-flow", "/screen/flow"],
  ["screen-list", "/screen/list"],
  ["screen-design", `/screen/design/${screenId}`],
  ["screen-items", `/screen/items/${screenId}`],
  ["table-list", "/table/list"],
  ["table-edit", `/table/edit/${tableId}`],
  ["er", "/table/er"],
  ["process-flow-list", "/process-flow/list"],
  ["process-flow-edit", `/process-flow/edit/${flowId}`],
  ["sequence-list", "/sequence/list"],
  ["view-list", "/view/list"],
  ["view-definition-list", "/view-definition/list"],
  ["page-layout-list", "/page-layout/list"],
  ["page-layout-edit", `/page-layout/edit/${firstId("page-layouts") ?? "main-layout"}`],
  ["gadget-list", "/gadget/list"],
  ["generic-definition", "/generic-definition"],
  ["conventions", "/conventions/catalog"],
  ["extensions", "/extensions"],
  ["tech-stack", "/project/tech-stack"],
  ["document", "/document"],
  ["report-list", "/report/list"],
  ["report-edit", `/report/edit/${firstId("reports") ?? "delivery-note"}`],
  ["business-flow-list", "/business-flow/list"],
  ["business-flow-edit", `/business-flow/edit/${firstId("business-flows") ?? "order-to-shipment"}`],
  ...(args.extra ? args.extra.split(",").map((p) => [p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""), p]) : []),
].filter(([name]) => !only || only.has(name));

const servers = await ensureDevServers();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme === "dark" ? "dark" : "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 300)}`); });

if (theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("harmony.appTheme", t); } catch { /* ignore */ } }, theme);
}
// --ls key=value,key2=value2 : localStorage の初期値 (表示形式の切替などを撮影するため)
if (args.ls) {
  const pairs = args.ls.split(",").map((kv) => kv.split("="));
  await page.addInitScript((ps) => { try { for (const [k, v] of ps) localStorage.setItem(k, v); } catch { /* ignore */ } }, pairs);
}

// workspace を開く
await page.goto(`${BASE}/workspace/select`);
await page.getByTestId("workspace-open-or-create").click();
await page.locator(".tbl-modal input[type='text']").first().fill(wsPath);
const primary = page.locator(".tbl-modal .tbl-btn-primary");
await primary.waitFor({ state: "visible", timeout: 15000 });
await page.waitForFunction(() => !document.querySelector(".tbl-modal .tbl-btn-primary")?.hasAttribute("disabled"), null, { timeout: 15000 });
await primary.click();
await page.waitForURL(/\/w\/[^/]+\//, { timeout: 15000 });
const wsPrefix = (await page.evaluate(() => location.pathname)).match(/^\/w\/[^/]+/)[0];

for (const [name, route] of routes) {
  await page.evaluate((p) => { window.history.pushState({}, "", p); window.dispatchEvent(new PopStateEvent("popstate")); }, `${wsPrefix}${route === "/" ? "/" : route}`);
  await page.waitForTimeout(Number(args.wait ?? 1500));
  // 再開 / 破棄ダイアログが出ていれば破棄
  await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]'))?.click());
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}
if (errors.length) {
  fs.writeFileSync(path.join(outDir, "_errors.txt"), errors.join("\n"));
  console.log(`${errors.length} console errors → ${path.relative(process.cwd(), path.join(outDir, "_errors.txt"))}`);
}
await browser.close();
servers.stop();
