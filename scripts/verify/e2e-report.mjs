#!/usr/bin/env node
/**
 * e2e-report — 直近の E2E の結果 (.tmp/e2e-results.json) から、遅い試験・再試行で通った試験 (flake の疑い)・失敗を一覧し、
 * 実行の履歴 (.tmp/e2e-history.jsonl) に 1 行足して、これまでの実行との比べる。
 *
 * 使い方: (cd frontend && HARMONY_E2E_RETRIES=1 npx playwright test) && npm run e2e:report
 * 出力: 総数・時間 / 遅い試験 上位 15 / 再試行で通った試験 (flaky) / 失敗 / 過去の実行で何度も flaky になった試験
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const resultsFile = path.join(root, ".tmp", "e2e-results.json");
const historyFile = path.join(root, ".tmp", "e2e-history.jsonl");
if (!fs.existsSync(resultsFile)) { console.error(`${resultsFile} がありません (先に playwright test を実行してください)`); process.exit(2); }

const report = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
const tests = [];
(function walk(suite, file) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const results = t.results ?? [];
      const last = results[results.length - 1];
      tests.push({
        id: `${spec.file ?? file} › ${spec.title}`,
        status: t.status, // expected / unexpected / flaky / skipped
        retries: Math.max(0, results.length - 1),
        ms: results.reduce((s, r) => s + (r.duration ?? 0), 0),
        lastStatus: last?.status,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
})(report, "");

const count = (s) => tests.filter((t) => t.status === s).length;
const total = report.stats?.duration ? (report.stats.duration / 60000).toFixed(1) : "?";
console.log(`試験 ${tests.length} 件 / 成功 ${count("expected")} / 失敗 ${count("unexpected")} / 再試行で通った (flaky) ${count("flaky")} / skip ${count("skipped")} / 全体 ${total} 分`);

const slow = [...tests].sort((a, b) => b.ms - a.ms).slice(0, 15);
console.log("\n遅い試験 上位 15:");
for (const t of slow) console.log(`  ${(t.ms / 1000).toFixed(1).padStart(6)} 秒  ${t.id}`);

const flaky = tests.filter((t) => t.status === "flaky");
if (flaky.length) { console.log("\n再試行で通った試験 (flake の疑い):"); for (const t of flaky) console.log(`  再試行 ${t.retries} 回  ${t.id}`); }
const failed = tests.filter((t) => t.status === "unexpected");
if (failed.length) { console.log("\n失敗:"); for (const t of failed) console.log(`  ${t.id}`); }

// 履歴: 実行ごとに 1 行 (flaky・失敗した試験の id)。直近 30 回で 2 回以上 flaky・失敗した試験を出す
const entry = { at: new Date().toISOString(), total: tests.length, flaky: flaky.map((t) => t.id), failed: failed.map((t) => t.id) };
fs.appendFileSync(historyFile, `${JSON.stringify(entry)}\n`);
const history = fs.readFileSync(historyFile, "utf8").trim().split("\n").slice(-30).map((l) => JSON.parse(l));
const freq = new Map();
for (const h of history) for (const id of new Set([...h.flaky, ...h.failed])) freq.set(id, (freq.get(id) ?? 0) + 1);
const repeat = [...freq].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
if (repeat.length) { console.log(`\n直近 ${history.length} 回の実行で、2 回以上 flaky・失敗した試験:`); for (const [id, n] of repeat) console.log(`  ${n} 回  ${id}`); }
process.exit(failed.length ? 1 : 0);
