#!/usr/bin/env node
/**
 * no-new-bare-catch-console-error — frontend/src (テスト以外) の `.catch(console.error)` が、基準の件数より増えていないことを検査する。
 *
 * `.catch(console.error)` (エラー 1 つだけを渡す) は、`installFailureToasts` が利用者への通知に変えているが、
 * 何の操作が失敗したかが通知に出ない。新しいコードでは `reportFailure(err, "操作の名前")` (src/utils/failureToast.ts) を使う。
 * 既存分は基準 (scripts/verify/catch-console-error.baseline) の件数まで許す。増えたら失敗。減ったときも失敗 (基準を下げ忘れない: --update)。
 *
 * 使い方: node scripts/verify/no-new-bare-catch-console-error.mjs [--update]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../frontend/src");
const baselineFile = path.join(here, "catch-console-error.baseline");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
let count = 0;
for (const f of walk(src)) {
  if (!/\.(ts|tsx)$/.test(f) || /\.test\.(ts|tsx)$/.test(f) || f.endsWith("failureToast.ts")) continue; // failureToast.ts は説明のコメントに書いてある
  count += (fs.readFileSync(f, "utf-8").match(/\.catch\(console\.error\)/g) ?? []).length;
}
if (process.argv.includes("--update")) {
  fs.writeFileSync(baselineFile, `${count}\n`);
  console.log(`基準を ${count} 件に更新しました`);
  process.exit(0);
}
const baseline = Number(fs.readFileSync(baselineFile, "utf-8").trim());
if (count > baseline) {
  console.error(`.catch(console.error) が基準 (${baseline}) より増えています (${count})。新しいコードでは reportFailure(err, "操作の名前") を使ってください`);
  process.exit(1);
}
if (count < baseline) {
  // 減ったら基準も下げる (下げ忘れると、その分の余裕が残り、あとで別の場所に足しても通ってしまう)
  console.error(`.catch(console.error) が減りました (${count} < 基準 ${baseline})。node scripts/verify/no-new-bare-catch-console-error.mjs --update で基準を ${count} に下げてコミットしてください`);
  process.exit(1);
}
console.log(`OK: .catch(console.error) は基準どおり (${count} 件)`);
