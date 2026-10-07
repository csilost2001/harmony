#!/usr/bin/env node
/**
 * check — コミット前の一括検証。各工程を順に実行し、最後に結果を一覧表示する。
 *   1. shared build  2. frontend 型検査  3. backend 型検査  4. 直書き色検査
 *   5. frontend 単体テスト  6. backend 単体テスト
 * 使い方: npm run check   (--skip-tests でテスト工程を省略)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skipTests = process.argv.includes("--skip-tests");
const steps = [
  ["shared build", "npm", ["run", "build", "--workspace=@harmony/shared"], root],
  ["frontend 型検査", "npx", ["tsc", "-b"], path.join(root, "frontend")],
  ["backend 型検査", "npx", ["tsc", "--noEmit"], path.join(root, "backend")],
  ["直書き色検査", "node", ["scripts/verify/no-raw-colors.mjs"], root],
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
