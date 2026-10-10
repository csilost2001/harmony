#!/usr/bin/env node
/**
 * export-test-viewpoints — ワークスペースの設計データ (JSON) から、テスト観点表 (テスト仕様書の元) を書き出す。
 * 画面入力 (必須・桁数・範囲・形式の正常 / 異常 / 境界値) と、処理 (分岐と終了) の両方を、決まった ID つきで出す。
 * Playwright 等のテストコードは、この表を入力にして AI (/generate-tests) または人が書く。
 *
 * 使い方:
 *   node scripts/export-test-viewpoints.mjs <workspace-dir> [--format csv|json|md] [--out <file>] [--screen <id>] [--flow <id>]
 *     --format  既定は csv (Excel で開ける。UTF-8 BOM つき)。md は画面ごとの Markdown の表
 *     --out     出力先 (省略すると標準出力)
 *     --screen / --flow  その画面・処理だけに絞る (複数指定可)
 */
import fs from "node:fs";
import { deriveTestViewpointSheet, testViewpointSheetToCsv } from "@harmony/shared";
import { loadWorkspaceInput } from "./lib/load-workspace.mjs";

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(["--format", "--out", "--screen", "--flow"]);
const dir = args.find((a, i) => !a.startsWith("--") && !VALUE_OPTS.has(args[i - 1]));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const all = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
if (!dir) {
  console.error("usage: export-test-viewpoints.mjs <workspace-dir> [--format csv|json|md] [--out file] [--screen id] [--flow id]");
  process.exit(2);
}
const format = opt("--format") ?? "csv";
if (!["csv", "json", "md"].includes(format)) { console.error(`--format は csv / json / md のどれかです: ${format}`); process.exit(2); }

const loaded = loadWorkspaceInput(dir, (m) => console.error(m));
if (!loaded) { console.error(`harmony.json が読めません: ${dir}`); process.exit(2); }
const onlyScreens = all("--screen"), onlyFlows = all("--flow");
const pick = (items, ids, idOf) => (ids.length ? items.filter((x) => ids.includes(idOf(x))) : items);
const sheet = deriveTestViewpointSheet({
  limits: loaded.input.limits, regex: loaded.input.regex, messages: loaded.input.messages,
  screens: pick(loaded.input.screens.filter((s) => s.purpose !== "gadget"), onlyScreens, (s) => s.id),
  flows: pick(loaded.input.flows, onlyFlows, (f) => f.meta.id),
});
for (const id of onlyScreens) if (!loaded.input.screens.some((s) => s.id === id)) console.error(`警告: 画面「${id}」がありません`);
for (const id of onlyFlows) if (!loaded.input.flows.some((f) => f.meta.id === id)) console.error(`警告: 処理フロー「${id}」がありません`);

const md = () => {
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [`# テスト観点表: ${loaded.input.project.name}`, "", `全 ${sheet.total} 件`];
  for (const s of sheet.screens) {
    lines.push("", `## 画面: ${s.screenName ?? s.screenId} (\`${s.screenId}\`)`, "", "| ID | 項目 | 区分 | 観点 | 入力 | 入力値 | 期待結果 |", "|---|---|---|---|---|---|---|");
    for (const c of s.cases) lines.push(`| \`${c.id}\` | ${cell(c.itemLabel)} | ${c.category} | ${cell(c.viewpoint)} | ${cell(c.input)} | ${c.value === undefined ? "" : `\`${cell(typeof c.value === "string" && c.value.length > 24 ? c.value.slice(0, 24) + "…" : c.value)}\``} | ${cell(c.expected + (c.expectedMessage ? ` (メッセージ: ${c.expectedMessage})` : ""))} |`);
  }
  for (const f of sheet.flows) {
    lines.push("", `## 処理: ${f.flowName ?? f.flowId} (\`${f.flowId}\`)`, "", "| ID | 区分 | 条件 | 期待結果 | 終了ステップ |", "|---|---|---|---|---|");
    for (const c of f.cases) lines.push(`| \`${c.id}\` | ${c.category} | ${cell(c.conditions.join(" かつ "))} | ${cell(c.expected)} | \`${c.stepNo}\` |`);
  }
  return lines.join("\n") + "\n";
};

const text = format === "json" ? JSON.stringify(sheet, null, 2) + "\n" : format === "md" ? md() : "﻿" + testViewpointSheetToCsv(sheet);
const out = opt("--out");
if (out) {
  fs.writeFileSync(out, text);
  console.log(`書き出しました: ${out} (画面 ${sheet.screens.length} 件 / 処理 ${sheet.flows.length} 件、テストケース ${sheet.total} 件)`);
} else {
  process.stdout.write(text);
}
