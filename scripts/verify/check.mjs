#!/usr/bin/env node
/**
 * check — コミット前の一括検証。各工程を順に実行し、最後に結果を一覧表示する。
 *   1. shared build  2. frontend 型検査  2b. frontend lint (エラー 0・警告を増やさない)  3. backend 型検査  4. 直書き色検査  4b. CSS 未定義クラス検査 (Bootstrap 風のクラス)  4c. エラー通知の書き方の検査 (.catch(console.error) を増やさない)
 *   5. サンプル設計の要確認 (examples/ 全件が警告なし)  5b. ビルドサイズの予算 (入口を小さく保つ)  6. frontend 単体テスト  7. backend 単体テスト
 * 使い方: npm run check   (--skip-tests でテスト工程を省略)
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skipTests = process.argv.includes("--skip-tests");
// examples/ の各サンプルが、設計書の「要確認事項」を警告以上で持っていないこと (サンプルは見本なので常にきれいに保つ)
const sampleDirs = fs.readdirSync(path.join(root, "examples"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, "examples", d.name, "harmony.json")))
  .map((d) => path.join("examples", d.name));
const LINT_MAX_WARNINGS = 18;
const steps = [
  ["shared build", "npm", ["run", "build", "--workspace=@harmony/shared"], root],
  ["frontend 型検査", "npx", ["tsc", "-b"], path.join(root, "frontend")],
  // ESLint: エラーは 0、警告は増やさない (この数を下げたら、ここも下げる。react-hooks の新しい規則の警告が残っている)
  ["E2E の skip の検査", "node", ["scripts/verify/no-unconditional-e2e-skip.mjs"], root],
  ["型検査の抑止の検査", "node", ["scripts/verify/no-type-suppression.mjs"], root],
  ["frontend lint", "npx", ["eslint", ".", "--max-warnings", String(LINT_MAX_WARNINGS)], path.join(root, "frontend")],
  ["backend 型検査", "npx", ["tsc", "--noEmit"], path.join(root, "backend")],
  ["直書き色検査", "node", ["scripts/verify/no-raw-colors.mjs"], root],
  ["入力例の表記検査", "node", ["scripts/dev/prefix-placeholders.mjs", "--check"], root],
  ["エラー通知の書き方の検査", "node", ["scripts/verify/no-new-bare-catch-console-error.mjs"], root],
  ["スキーマと型の食い違い検査", "node", ["scripts/verify/types-drift.mjs"], root],
  ["CSS 未定義クラス検査", "node", ["scripts/verify/no-undefined-bootstrap-classes.mjs"], root],
  ["サンプル設計の要確認", "node", ["scripts/check-design.mjs", ...sampleDirs, "--strict"], root],
  ["ビルドサイズの予算", "node", ["scripts/verify/bundle-budget.mjs"], root],
  ...(skipTests ? [] : [
    ["frontend 単体テスト", "npx", ["vitest", "run", "--reporter=dot"], path.join(root, "frontend")],
    ["backend 単体テスト", "npx", ["vitest", "run", "--reporter=dot"], path.join(root, "backend")],
  ]),
];

const results = [];
for (const [name, cmd, args, cwd] of steps) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const summary = (out.match(/Tests\s+[^\n]+/) ?? [""])[0].trim();
  results.push({ name, ok, sec: ((Date.now() - t0) / 1000).toFixed(1), summary });
  if (!ok) {
    console.error(`\n✗ ${name} 失敗:\n${out.split("\n").slice(-40).join("\n")}`);
    break;
  }
}
console.log("\n工程                  結果   秒     備考");
for (const r of results) console.log(`${r.name.padEnd(18)} ${r.ok ? "OK  " : "失敗"}  ${r.sec.padStart(5)}  ${r.summary}`);
process.exit(results.every((r) => r.ok) && results.length === steps.length ? 0 : 1);
