#!/usr/bin/env node
// html-qa: 画面の「AI に送る」を待ち、届いた回答を表示して終わる。
//
//   node ai-skills/html-qa/scripts/wait.mjs <議題フォルダ> [--timeout-min 120]
//
// Claude Code では Bash の run_in_background で動かす。終わると AI が自動で呼び戻されるので、
// 利用者はチャットに何も書かなくてよい。待っている間は画面に「AI が回答を待っています」と出る。
// 終了コード: 0 = 回答を受け取った / 2 = 引数の誤り / 3 = 時間切れ
import fs from "node:fs";
import path from "node:path";
import { unreadAnswers, markSeen, formatAnswers, setWaiting, rel } from "./lib.mjs";

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--timeout-min");
if (!dirArg) { console.error("使い方: node ai-skills/html-qa/scripts/wait.mjs <議題フォルダ> [--timeout-min 120]"); process.exit(2); }
const i = args.indexOf("--timeout-min");
const timeoutMin = i >= 0 ? Number(args[i + 1]) : 120;
const dir = path.resolve(dirArg);
if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => /^v\d+\.json$/.test(f))) { console.error(`${dirArg}: 議題フォルダ (v*.json がある所) ではありません`); process.exit(2); }

const clear = setWaiting(dir);
const finish = (code, msg) => { clear(); if (msg) console.log(msg); process.exit(code); };
process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));

const started = Date.now();
const check = () => {
  const list = unreadAnswers([dir]);
  if (list.length) {
    const text = formatAnswers(list);
    list.forEach(markSeen);
    finish(0, text);
  }
  if (timeoutMin > 0 && Date.now() - started > timeoutMin * 60_000) {
    finish(3, `[html-qa] ${timeoutMin} 分待ちましたが回答は届きませんでした (${rel(dir)})。あとで届いた回答は、利用者が次に発言したときに hook が渡します。`);
  }
};
check();
setInterval(check, 1000);
