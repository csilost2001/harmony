#!/usr/bin/env tsx
/**
 * check-generation — 生成したコードと設計のずれ、生成したテストが観点表を覆う割合を、CLI で確かめる (CI・コミット前の確認用)。
 *
 * 使い方: npm run check:generation -- <ワークスペース> [--coverage [--min <割合 %>]] [--json]
 *
 * - 既定: `record_generation` で記録された生成物と、いまの設計・生成物を突き合わせる (designer__check_generation_drift と同じ)。
 *         設計が変わった (design-changed)・生成物が書き換わった (output-changed)・両方 (both-changed)・生成物が消えた (output-missing) があれば、終了コード 1
 * - --coverage: テスト観点表のうち、記録されたテストの本文に ID が書かれているものの割合を出す。--min を付けると、それ未満なら終了コード 1
 * 仕様: docs/spec/code-generation.md
 */
import fs from "node:fs";
import path from "node:path";
import { generationStatus } from "../../backend/src/ops/service.js";
import { checkTestCoverage } from "../../backend/src/testCoverage.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--") && !/^\d+(\.\d+)?$/.test(a));
if (!dir || !fs.existsSync(path.join(path.resolve(dir), "harmony.json"))) {
  console.error("使い方: check-generation.mts <ワークスペース> [--coverage [--min <割合>]] [--json]");
  process.exit(2);
}
const root = path.resolve(dir);
const wantJson = args.includes("--json");
const minIdx = args.indexOf("--min");
const min = minIdx >= 0 ? Number(args[minIdx + 1]) : undefined;
if (minIdx >= 0 && !(Number.isFinite(min) && min! >= 0 && min! <= 100)) { console.error("--min は 0〜100 の数で指定してください"); process.exit(2); }

const LABEL: Record<string, string> = { current: "最新", "design-changed": "設計が変わった (再生成が必要)", "output-changed": "生成物が書き換えられた", "both-changed": "設計も生成物も変わった (衝突)", "output-missing": "生成物がない" };

async function main(): Promise<number> {
  let exit = 0;
  const result: Record<string, unknown> = {};
  const { rows, problems } = await generationStatus(root);
  const drifted = rows.filter((r) => r.state !== "current");
  result.generation = { total: rows.length, drifted: drifted.length, problems, rows: drifted };
  if (drifted.length) exit = 1;
  if (!wantJson) {
    console.log(`生成物 ${rows.length} 件: 最新 ${rows.length - drifted.length} / ずれ ${drifted.length}`);
    for (const r of drifted) console.log(`  ✗ ${r.path}${r.base === "generated-code" ? " (generated-code)" : ""}: ${LABEL[r.state] ?? r.state}${r.changedSources.length ? ` — ${r.changedSources.map((c) => `${c.kind}:${c.id} ${c.state === "deleted" ? "削除" : "変更"}`).join(", ")}` : ""}`);
    for (const p of problems) console.log(`  ・記録の問題: ${p}`);
    if (!rows.length) console.log("  (記録がありません。コードを生成したら designer__record_generation で記録する)");
  }
  if (args.includes("--coverage")) {
    const cov = await checkTestCoverage(root) as { total: number; covered: number; percent: number | null; testFiles: string[]; uncovered: Array<{ id: string; target: string }>; moreUncovered?: number };
    result.coverage = cov;
    if (min !== undefined && (cov.percent ?? 0) < min) exit = 1;
    if (!wantJson) {
      console.log(`テスト観点 ${cov.total} 件のうち、テストに ID が書かれているもの ${cov.covered} 件 (${cov.percent ?? "-"}%)。読んだテスト ${cov.testFiles.length} ファイル${min !== undefined ? ` / 最低 ${min}%` : ""}`);
      for (const u of cov.uncovered.slice(0, 20)) console.log(`  ・未: ${u.id} (${u.target})`);
      if (cov.uncovered.length > 20 || cov.moreUncovered) console.log(`  ・ほか ${cov.uncovered.length - 20 + (cov.moreUncovered ?? 0)} 件`);
    }
  }
  if (wantJson) console.log(JSON.stringify(result, null, 2));
  return exit;
}
main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
