#!/usr/bin/env tsx
/**
 * migrate-schema — ワークスペースの設計データを、最新のスキーマの版へ移行する。
 *
 * 使い方:
 *   npm run migrate:schema -- <workspace-dir> [--apply]
 *     既定は予行 (書かずに、書き換わるファイルと変わる項目を表示する)。--apply を付けると書く (backend が動いているときは拒否。--even-if-running で実行)
 *     書き換える前の内容は、<workspace-dir>/.harmony-backups/ に世代で残る (戻せる)
 *
 * 終了コード: 0 = 移行は不要、または予行・適用に成功 / 2 = 使い方・読み込みの失敗
 * 仕様: docs/spec/schema-migration.md
 */
import path from "node:path";
import { LATEST_SCHEMA_VERSION, migrateWorkspace } from "../backend/src/schemaMigration.js";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: migrate-schema.ts <workspace-dir> [--apply]");
  process.exit(2);
}
const apply = args.includes("--apply");

// backend が動いていると、編集中の画面が古い内容で上書き保存して、移行を巻き戻すことがある。動いているあいだは、--apply しない
// (MCP の designer__migrate_schema は、編集中のセッションが無いことを確かめてから実行する)
if (apply && !args.includes("--even-if-running")) {
  const port = process.env.DESIGNER_MCP_PORT ?? "5179";
  const running = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false);
  if (running) {
    console.error(`backend (port ${port}) が動いています。編集中の画面がないことを確かめて backend を止めてから実行するか、MCP の designer__migrate_schema を使ってください (確かめた上で、このまま実行するなら --even-if-running を付けます)`);
    process.exit(2);
  }
}

try {
  const report = await migrateWorkspace(path.resolve(dir), { apply });
  if (report.migrations.length === 0) {
    console.log(`移行は不要です (スキーマの版 ${report.fromVersion} は最新 ${LATEST_SCHEMA_VERSION} です)`);
    process.exit(0);
  }
  console.log(`スキーマの版 ${report.fromVersion} → ${report.toVersion} (移行: ${report.migrations.join(", ")})`);
  for (const f of report.files) console.log(`  ${apply ? "書き換えた" : "書き換える"}: ${f.file}  (${f.changedKeys.join(", ")})`);
  if (report.skipped.length) console.log(`  読めずに飛ばしたファイル: ${report.skipped.join(", ")}`);
  console.log(apply ? `適用しました (${report.files.length} ファイル)` : `予行です。適用するには --apply を付けてください (${report.files.length} ファイルが書き換わります)`);
} catch (e) {
  console.error(`移行できません: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
