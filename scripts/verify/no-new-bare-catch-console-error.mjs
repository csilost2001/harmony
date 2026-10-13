#!/usr/bin/env node
/**
 * no-new-bare-catch-console-error — frontend/src (テスト以外) に、`.catch(console.error)` が 1 件も無いことを検査する。
 *
 * `.catch(console.error)` (エラー 1 つだけを渡す) は、`installFailureToasts` が利用者への通知に変えるが、
 * 何の操作が失敗したかが通知に出ない。`reportFailure(err, "操作の名前")` (src/utils/failureToast.ts) を使う。
 * 検査するのは、この文字列の形だけ。同じ意味の別の書き方 (`.catch((e) => console.error(e))` など) も使わないこと
 * (frontend/AGENTS.md「失敗の知らせ方」)。
 *
 * 使い方: node scripts/verify/no-new-bare-catch-console-error.mjs   (終了コード 0 = 問題なし / 1 = 残っている)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const found = [];
for (const f of walk(src)) {
  if (!/\.(ts|tsx)$/.test(f) || /\.test\.(ts|tsx)$/.test(f) || f.endsWith("failureToast.ts")) continue; // failureToast.ts は説明のコメントに書いてある
  fs.readFileSync(f, "utf-8").split("\n").forEach((line, i) => { if (line.includes(".catch(console.error)")) found.push(`${path.relative(src, f)}:${i + 1}`); });
}
if (found.length > 0) {
  console.error(`.catch(console.error) が ${found.length} 件あります。reportFailure(err, "操作の名前") に直してください:\n  ${found.join("\n  ")}`);
  process.exit(1);
}
console.log("OK: .catch(console.error) はありません");
