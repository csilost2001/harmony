#!/usr/bin/env tsx
/**
 * bench-backend — backend の重い読み出しの時間を、ワークスペースごとに測る (性能の回帰・規模を増やしたときの確認用。回帰テストには含めない)。
 *
 * 使い方:
 *   node scripts/dev/make-large-workspace.mjs examples/retail .tmp/perf/retail-x100 100
 *   npx tsx scripts/dev/bench-backend.mts .tmp/perf/retail-x100
 *
 * 測るもの: 設計書の入力 (冷えた状態・使い回し)・スキーマ違反の検査・ファイルの健全性・本文検索・1 件を変えたあとの再検査・
 *           計算中のイベントループの最大の停止 (大きいと、画面の操作が待たされる)。
 */
import fs from "node:fs";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { loadDesignInputFromRoot } from "../../backend/src/designInput.js";
import { collectExtraIssues, collectSchemaIssues } from "../../backend/src/schemaIssues.js";
import { scanWorkspaceHealth } from "../../backend/src/workspaceHealth.js";
import { searchDesign } from "../../backend/src/designSearch.js";

const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !fs.existsSync(path.join(root, "harmony.json"))) {
  console.error("使い方: bench-backend.mts <ワークスペース>");
  process.exit(2);
}
const ms = (n: number) => `${Math.round(n)} ms`;
const t = async (name: string, f: () => Promise<unknown>) => { const s = performance.now(); await f(); console.log(`${name.padEnd(36)} ${ms(performance.now() - s)}`); };

const h = monitorEventLoopDelay({ resolution: 5 });
h.enable();
await t("設計書の入力 (冷えた状態)", () => loadDesignInputFromRoot(root));
await t("設計書の入力 (使い回し)", () => loadDesignInputFromRoot(root));
await t("スキーマ違反の検査 (冷えた状態)", () => collectSchemaIssues(root));
await t("ファイルの健全性 (冷えた状態)", () => scanWorkspaceHealth(root));
await t("本文検索 (4 文字)", () => searchDesign(root, "在庫引当", 30));
h.disable();
console.log(`${"イベントループの最大の停止".padEnd(34)} ${ms(h.max / 1e6)} (p99 ${ms(h.percentile(99) / 1e6)})`);

// 1 件だけ変えて、再検査 (変わったファイルの分だけ計算し直す)
const dir = path.join(root, JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8")).dataDir ?? "harmony", "tables");
const f = path.join(dir, fs.readdirSync(dir).filter((x) => x.endsWith(".json"))[0]);
fs.appendFileSync(f, "\n");
await t("1 件変更後: スキーマ違反の検査", () => collectSchemaIssues(root));
await t("1 件変更後: ファイルの健全性", () => scanWorkspaceHealth(root));
await t("1 件変更後: 設計書・check_design の要確認", () => collectExtraIssues(root));
