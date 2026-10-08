#!/usr/bin/env node
/**
 * export-design-doc — ワークスペースの設計データ (JSON) から、HTML の設計書
 * (基本設計書・処理設計書) を 1 ファイルで書き出す。
 *
 * 使い方:
 *   node scripts/export-design-doc.mjs <workspace-dir> [--out <file.html>] [--version <版>]
 *   既定の出力先: <workspace-dir>/design-document.html
 *   --version 省略時は git の短縮 SHA (取れなければ "-")
 *
 * 生成は一方向。HTML は閲覧・レビュー用で、修正は Harmony 上で原本 (JSON) に対して行う。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderStandaloneDesignDoc } from "@harmony/shared";

const [dir, ...rest] = process.argv.slice(2);
if (!dir) {
  console.error("usage: export-design-doc.mjs <workspace-dir> [--out file.html] [--version v]");
  process.exit(2);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const listJson = (d, filter = () => true) =>
  fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json") && filter(f)).sort().map((f) => readJson(path.join(d, f))).filter(Boolean) : [];

const harmony = readJson(path.join(dir, "harmony.json"));
if (!harmony) { console.error(`harmony.json が読めません: ${dir}`); process.exit(2); }
const dataDir = path.join(dir, harmony.dataDir ?? "harmony");

// 画面は harmony.json の登録順に並べる
const screensRaw = listJson(path.join(dataDir, "screens"), (f) => !f.includes(".design.") && !f.includes("puck"));
const order = (harmony.entities?.screens ?? []).map((s) => s.id);
const screens = [...screensRaw].sort((a, b) => {
  const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
});
// 処理フロー・テーブルは harmony.json に登録されたものを対象にする (アプリの設計書ビューと同じ)。
// 登録されていないファイルは警告だけ出す。
const pickRegistered = (all, registry, label, idOf) => {
  if (!Array.isArray(registry)) return all;
  const ids = registry.map((e) => e.id);
  const unregistered = all.filter((x) => !ids.includes(idOf(x)));
  for (const u of unregistered) console.warn(`警告: ${label}「${idOf(u)}」は harmony.json に登録されていないため設計書に含めません`);
  return ids.map((id) => all.find((x) => idOf(x) === id)).filter(Boolean);
};
const flows = pickRegistered(listJson(path.join(dataDir, "process-flows")), harmony.entities?.processFlows, "処理フロー", (f) => f.meta?.id);
const tables = pickRegistered(listJson(path.join(dataDir, "tables")), harmony.entities?.tables, "テーブル", (t) => t.id);
const conventions = readJson(path.join(dataDir, "conventions", "catalog.json"));
const layoutComponents = readJson(path.join(dataDir, "layout-components.json"))?.components ?? [];

let version = opt("--version");
if (!version) {
  try { version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(); } catch { version = "-"; }
}

const html = renderStandaloneDesignDoc({
  project: { name: harmony.meta?.name ?? path.basename(dir), description: harmony.meta?.description },
  screens,
  flows,
  tables,
  transitions: harmony.entities?.screenTransitions ?? [],
  messages: conventions?.msg ?? {},
  layoutComponents,
  version,
});
const out = opt("--out") ?? path.join(dir, "design-document.html");
fs.writeFileSync(out, html);
console.log(`書き出しました: ${out} (画面 ${screens.length} / 処理フロー ${flows.length} / テーブル ${tables.length}, ${Math.round(html.length / 1024)} KB)`);
