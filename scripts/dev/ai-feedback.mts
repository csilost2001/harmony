#!/usr/bin/env tsx
/**
 * ai-feedback — AI が designer__report_confusion で残した「詰まった点」を集計する。資料・スキーマ・tool の説明の改善の優先順位に使う。
 *
 * 使い方: npm run ai:feedback -- <ワークスペース> [--json]
 * 記録: <ワークスペース>/.harmony-ops/ai-feedback.json (個人・環境の記録。git に載らない)
 */
import fs from "node:fs";
import path from "node:path";
import { confusionStore } from "../../backend/src/ops/feedback.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir || !fs.existsSync(path.join(path.resolve(dir), "harmony.json"))) { console.error("使い方: ai-feedback.mts <ワークスペース> [--json]"); process.exit(2); }
const { value, problems } = await confusionStore.read(path.resolve(dir));
const count = (key: (e: (typeof value.entries)[number]) => string | undefined) => {
  const m = new Map<string, number>();
  for (const e of value.entries) { const k = key(e); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const byTool = count((e) => e.tool?.replace(/^designer__/, "")), byDoc = count((e) => e.doc);
if (args.includes("--json")) { console.log(JSON.stringify({ total: value.entries.length, byTool, byDoc, entries: value.entries, problems }, null, 2)); process.exit(0); }
console.log(`AI が詰まった点 ${value.entries.length} 件`);
for (const p of problems) console.log(`  ・記録の問題: ${p}`);
if (byTool.length) { console.log("\ntool ごと:"); for (const [k, n] of byTool) console.log(`  ${String(n).padStart(3)}× ${k}`); }
if (byDoc.length) { console.log("\n資料ごと:"); for (const [k, n] of byDoc) console.log(`  ${String(n).padStart(3)}× ${k}`); }
console.log("\n新しい順:");
for (const e of [...value.entries].reverse().slice(0, 30)) console.log(`  ${e.at.slice(0, 16).replace("T", " ")} ${e.tool ? `[${e.tool}] ` : ""}${e.topic}${e.expected ? `\n      → 期待: ${e.expected}` : ""}`);
