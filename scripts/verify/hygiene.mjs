#!/usr/bin/env node
/**
 * hygiene — コードの衛生の検査 (改善提案 第 3 ラウンド #21〜24, #27)。「これ以上増やさない」の予算で守る。
 *   1. eslint-disable に理由 (`-- 理由`) がないものの数 (新しく足すときは、理由を書く)
 *   2. TODO / FIXME は `TODO(#番号)` の形 (ISSUE につなげる)
 *   3. 単体試験・E2E に `.only(` を残さない
 *   4. backend の console.* の直書きの数 (ログは serverLog 経由)
 *   5. 巨大ファイルの行数 (1500 行を超えるものは、いまの行数より増やさない)
 * 予算 (BUDGET) を下げられたら、ここも下げる。使い方: node scripts/verify/hygiene.mjs  (npm run check に含まれる)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 予算 (いまの数。下げたら、ここも下げる) */
export const BUDGET = {
  disableWithoutReason: 45,
  backendConsole: 48,
};
/** 1500 行を超える既存のファイルの、いまの行数 (これより増やさない)。別の弾で分けたら、ここから外す */
export const BIG_FILES = {
  "backend/src/projectStorage.ts": 1748,
  "backend/src/renameEntity.ts": 2188,
  "backend/src/tools.ts": 1974,
  "frontend/src/components/flow/FlowEditor.tsx": 1673,
  "frontend/src/components/screen-items/ScreenItemsView.tsx": 2368,
  "frontend/src/components/table/TableEditor.tsx": 1578,
};
const BIG_LINES = 1500;

const SOURCE = /^(frontend\/src|backend\/src|shared\/src|scripts|frontend\/e2e)\/.*\.(ts|tsx|mjs|mts)$/;
/** 検査自身と、その試験は、検査の例の文字を書くので見ない */
const SELF = /^scripts\/verify\/(hygiene|test)\.mjs$/;
const isTest = (f) => /\.test\.(ts|tsx|mjs)$/.test(f) || /\/e2e\//.test(f) || /\/test\.mjs$/.test(f);

function gitFiles() {
  const ls = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return (ls.stdout ?? "").split("\0").filter((f) => f && SOURCE.test(f) && !SELF.test(f) && fs.existsSync(path.join(root, f)));
}

export function measure(files = gitFiles(), read = (f) => fs.readFileSync(path.join(root, f), "utf8")) {
  const out = { disableWithoutReason: [], badTodo: [], only: [], backendConsole: [], big: {} };
  for (const f of files) {
    const text = read(f);
    const lines = text.split("\n");
    if (lines.length > BIG_LINES && !isTest(f)) out.big[f] = lines.length;
    lines.forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      if (/eslint-disable/.test(line) && !/eslint-disable[^\n]*\s--\s/.test(line)) out.disableWithoutReason.push(at);
      if (/^\s*(\/\/|\/\*|\*)\s*(TODO|FIXME)\b(?!\()/.test(line) || (!line.includes("`") && /\s\/\/\s*(TODO|FIXME)\b(?!\()/.test(line))) out.badTodo.push(at); // 文字列の中 (生成するコードの例など) は除く
      if (/\b(it|test|describe)\.only\(/.test(line)) out.only.push(at);
      if (f.startsWith("backend/src/") && !isTest(f) && /\bconsole\.(log|warn|error|info|debug)\(/.test(line)) out.backendConsole.push(at);
    });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = measure();
  if (process.argv.includes("--print")) { console.log(JSON.stringify({ disableWithoutReason: m.disableWithoutReason.length, backendConsole: m.backendConsole.length, big: m.big }, null, 2)); process.exit(0); }
  const problems = [];
  if (m.only.length) problems.push(`.only( が残っています: ${m.only.slice(0, 5).join(", ")}`);
  if (m.badTodo.length) problems.push(`TODO / FIXME は TODO(#番号) の形にしてください: ${m.badTodo.slice(0, 5).join(", ")}`);
  if (m.disableWithoutReason.length > BUDGET.disableWithoutReason) problems.push(`eslint-disable に理由がないものが ${m.disableWithoutReason.length} 件 (予算 ${BUDGET.disableWithoutReason})。\`// eslint-disable-next-line ルール -- 理由\` の形にしてください。増えた分: ${m.disableWithoutReason.slice(-3).join(", ")}`);
  if (m.backendConsole.length > BUDGET.backendConsole) problems.push(`backend の console.* が ${m.backendConsole.length} 件 (予算 ${BUDGET.backendConsole})。serverLog (logInfo など) を使ってください: ${m.backendConsole.slice(-3).join(", ")}`);
  for (const [f, n] of Object.entries(m.big)) {
    const cap = BIG_FILES[f];
    if (cap === undefined) problems.push(`${f} が ${n} 行です (上限 ${BIG_LINES} 行)。分けるか、予算に入れる理由を書いてください`);
    else if (n > cap) problems.push(`${f} が ${n} 行に増えました (予算 ${cap} 行)。分けてください`);
  }
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  const slack = [];
  if (m.disableWithoutReason.length < BUDGET.disableWithoutReason) slack.push(`eslint-disable の予算を ${m.disableWithoutReason.length} に下げられます`);
  if (m.backendConsole.length < BUDGET.backendConsole) slack.push(`backend の console の予算を ${m.backendConsole.length} に下げられます`);
  console.log(`衛生の検査: OK (理由なしの eslint-disable ${m.disableWithoutReason.length} / backend の console ${m.backendConsole.length} / 巨大ファイル ${Object.keys(m.big).length})${slack.length ? ` — ${slack.join("・")}` : ""}`);
}
