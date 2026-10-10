#!/usr/bin/env node
/**
 * check-design — ワークスペースの設計データ (JSON) から、設計書の「要確認事項」を検出して一覧する。
 * 設計書ビュー (/document) と同じ検査 (画面の部品・業務フロー・帳票・権限・CRUD 等) をコマンドで実行できる。
 * AI が設計を直したあとの確認や、コミット前・レビュー前の点検に使う。
 *
 * 使い方:
 *   node scripts/check-design.mjs <workspace-dir>... [--strict] [--info] [--json]
 *     --strict  警告 (warning) も失敗として扱う (既定は error のみ失敗)
 *     --info    情報 (info) も表示する (既定は error / warning のみ)
 *     --json    JSON で出力する (他のツールに渡す用)
 *
 * 終了コード: 0 = 問題なし (--strict なら警告もなし) / 1 = error (または --strict の warning) あり / 2 = 使い方・読み込みの失敗
 */
import { buildDesignDocument } from "@harmony/shared";
import { loadWorkspaceInput } from "./lib/load-workspace.mjs";

const args = process.argv.slice(2);
const dirs = args.filter((a) => !a.startsWith("--"));
const flag = (name) => args.includes(name);
if (!dirs.length) {
  console.error("usage: check-design.mjs <workspace-dir>... [--strict] [--info] [--json]");
  process.exit(2);
}

const LABEL = { error: "エラー", warning: "警告", info: "情報" };
const MARK = { error: "✖", warning: "▲", info: "・" };
const show = flag("--info") ? ["error", "warning", "info"] : ["error", "warning"];

function check(dir) {
  const loadWarnings = [];
  const loaded = loadWorkspaceInput(dir, (m) => loadWarnings.push(m.replace(/^警告: /, "")));
  if (!loaded) return null;
  const { issues } = buildDesignDocument(loaded.input);
  // 読めないファイルは、設計書に載らないだけで気づきにくいので error として扱う
  const unreadable = loadWarnings.filter((m) => m.includes("読めない")).map((message) => ({ severity: "error", section: "読み込み", message }));
  const all = [...unreadable, ...issues];
  const count = (sev) => all.filter((i) => i.severity === sev).length;
  const summary = { error: count("error"), warning: count("warning"), info: count("info") };
  const failed = summary.error > 0 || (flag("--strict") && summary.warning > 0);
  return { dir, name: loaded.input.project.name, counts: loaded.counts, summary, issues: all, failed };
}

const results = [];
for (const dir of dirs) {
  const r = check(dir);
  if (!r) { console.error(`harmony.json が読めません: ${dir}`); process.exit(2); }
  results.push(r);
}
const failed = results.some((r) => r.failed);

if (flag("--json")) {
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  process.exit(failed ? 1 : 0);
}

for (const r of results) {
  const n = r.counts;
  console.log(`${r.name} (${r.dir}): 画面 ${n.screens} / 処理フロー ${n.flows} / テーブル ${n.tables} / 業務フロー ${n.businessFlows} / 帳票 ${n.reports}`);
  for (const sev of show) {
    const list = r.issues.filter((i) => i.severity === sev);
    if (!list.length) continue;
    console.log(`  ${MARK[sev]} ${LABEL[sev]} (${list.length} 件)`);
    for (const i of list) console.log(`    [${i.section}] ${i.message}`);
  }
  console.log(`  要確認: エラー ${r.summary.error} / 警告 ${r.summary.warning} / 情報 ${r.summary.info}${flag("--info") ? "" : " (情報は --info で表示)"} → ${r.failed ? "要対応" : "問題なし"}\n`);
}
process.exit(failed ? 1 : 0);
