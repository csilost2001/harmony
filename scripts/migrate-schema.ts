#!/usr/bin/env tsx
/**
 * migrate-schema — ワークスペースの設計データを、最新のスキーマの版へ移行する。
 *
 * 使い方:
 *   npm run migrate:schema -- <workspace-dir> [--apply]
 *     既定は予行 (書かずに、書き換わるファイルと変わる項目を表示する)。--apply を付けると書く
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
