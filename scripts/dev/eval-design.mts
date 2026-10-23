#!/usr/bin/env tsx
/**
 * eval-design — AI が作ったワークスペースを、評価の事例 (docs/evals/cases/*.json) で採点する。
 *
 * 使い方: npm run eval:design -- <ワークスペース> [<事例の id> | --all] [--json]
 *         npm run eval:design -- --list           事例の一覧と、AI に渡す依頼を表示する
 * 終了コード: すべて合格なら 0、不合格があれば 1。詳しい使い方: docs/evals/README.md
 */
import fs from "node:fs";
import path from "node:path";
import { parseEvalCase, runEval, type EvalCase } from "../../backend/src/evals/runEval.js";

const casesDir = path.resolve(import.meta.dirname, "../../docs/evals/cases");
const cases: EvalCase[] = fs.readdirSync(casesDir).filter((n) => n.endsWith(".json")).sort().map((n) => parseEvalCase(JSON.parse(fs.readFileSync(path.join(casesDir, n), "utf8")), n));
const args = process.argv.slice(2);

if (args.includes("--list")) {
  for (const c of cases) console.log(`■ ${c.id} — ${c.title}\n  依頼: ${c.request}\n  期待: ${c.expectations.length} 件${c.selfTest ? ` / 自己確認: ${c.selfTest}` : ""}\n`);
  process.exit(0);
}
const dir = args.find((a) => !a.startsWith("--") && !cases.some((c) => c.id === a));
const wanted = args.find((a) => cases.some((c) => c.id === a));
if (!dir || !fs.existsSync(path.join(path.resolve(dir), "harmony.json"))) {
  console.error("使い方: eval-design.mts <ワークスペース> [<事例の id> | --all] [--json] / --list");
  process.exit(2);
}
const root = path.resolve(dir);
const targets = wanted ? cases.filter((c) => c.id === wanted) : cases;
let failed = 0;
const all = [];
for (const c of targets) {
  const r = await runEval(root, c);
  all.push(r);
  if (!r.passed) failed++;
  if (!args.includes("--json")) {
    console.log(`${r.passed ? "✓" : "✗"} ${c.id} — ${c.title}`);
    for (const k of r.checks) console.log(`    ${k.ok ? "○" : "×"} ${(k.expectation as { note?: string }).note ?? k.expectation.type}: ${k.detail}`);
  }
}
if (args.includes("--json")) console.log(JSON.stringify(all, null, 2));
else console.log(`\n${targets.length - failed} / ${targets.length} 件が合格`);
process.exit(failed ? 1 : 0);
