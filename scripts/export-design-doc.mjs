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
import { loadWorkspaceInput } from "./lib/load-workspace.mjs";

const [dir, ...rest] = process.argv.slice(2);
if (!dir) {
  console.error("usage: export-design-doc.mjs <workspace-dir> [--out file.html] [--version v]");
  process.exit(2);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const loaded = loadWorkspaceInput(dir);
if (!loaded) { console.error(`harmony.json が読めません: ${dir}`); process.exit(2); }
const { input, counts } = loaded;

let version = opt("--version");
if (!version) {
  try { version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(); } catch { version = "-"; }
}

const html = renderStandaloneDesignDoc({ ...input, version });
const out = opt("--out") ?? path.join(dir, "design-document.html");
fs.writeFileSync(out, html);
console.log(`書き出しました: ${out} (画面 ${counts.screens} / 処理フロー ${counts.flows} / テーブル ${counts.tables} / 業務フロー ${counts.businessFlows} / 帳票 ${counts.reports}, ${Math.round(html.length / 1024)} KB)`);
