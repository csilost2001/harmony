#!/usr/bin/env node
/**
 * export-seed-data — ワークスペースの初期データ (汎用定義 seed-data) を、INSERT 文 / JSON に書き出す (#1499)。
 *
 * 使い方:
 *   node scripts/export-seed-data.mjs <workspace-dir> [--format sql|json] [--out <file>] [--name <初期データの名前>]
 *     --format  既定は sql。json は [{ name, table, rows }] (行のキーは物理名)
 *     --name    その初期データだけに絞る (複数指定可)
 * 終了コード: 0 = 書き出した / 2 = 使い方・読めない / 1 = 初期データのテーブルがない・行のキーがテーブルにない (書き出さない)
 */
import fs from "node:fs";
import { normalizeSeedRows, seedDataToSql } from "@harmony/shared";
import { loadWorkspaceInput } from "./lib/load-workspace.mjs";

const args = process.argv.slice(2);
const VALUE_OPTS = new Set(["--format", "--out", "--name"]);
const dir = args.find((a, i) => !a.startsWith("--") && !VALUE_OPTS.has(args[i - 1]));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const all = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
if (!dir) { console.error("usage: export-seed-data.mjs <workspace-dir> [--format sql|json] [--out file] [--name id]"); process.exit(2); }
const format = opt("--format") ?? "sql";
if (!["sql", "json"].includes(format)) { console.error(`--format は sql / json のどちらかです: ${format}`); process.exit(2); }
const loaded = loadWorkspaceInput(dir, (m) => console.error(m));
if (!loaded) { console.error(`harmony.json が読めません: ${dir}`); process.exit(2); }

const only = all("--name");
const seeds = (loaded.input.genericDefinitions ?? []).filter((g) => g.kind === "seed-data" && (only.length === 0 || only.includes(g.name)));
for (const n of only) if (!seeds.some((g) => g.name === n)) console.error(`警告: 初期データ「${n}」がありません`);
let bad = 0;
const parts = [];
for (const g of seeds) {
  const table = loaded.input.tables.find((t) => t.id === g.tableId);
  if (!table) { console.error(`✗ 初期データ「${g.name}」: テーブル「${g.tableId}」がありません`); bad++; continue; }
  const rows = Array.isArray(g.rows) ? g.rows.filter((r) => r && typeof r === "object") : [];
  const { rows: named, unknownKeys } = normalizeSeedRows(table, rows);
  if (unknownKeys.length) { console.error(`✗ 初期データ「${g.name}」: テーブルにないカラム ${unknownKeys.join("・")}`); bad++; continue; }
  parts.push(format === "json" ? { name: g.name, table: table.physicalName ?? table.id, rows: named } : seedDataToSql(table, rows));
}
if (bad) process.exit(1);
const text = format === "json" ? JSON.stringify(parts, null, 2) + "\n" : parts.join("\n");
const out = opt("--out");
if (out) { fs.writeFileSync(out, text); console.log(`書き出しました: ${out} (初期データ ${parts.length} 件)`); } else process.stdout.write(text);
