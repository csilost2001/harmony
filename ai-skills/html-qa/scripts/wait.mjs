#!/usr/bin/env node
// html-qa: 画面の「AI に送る」を待ち、届いた回答を表示して終わる。
//
//   node ai-skills/html-qa/scripts/wait.mjs <議題フォルダ> [--timeout-min 120]
//
// Claude Code では Bash の run_in_background で動かす。終わると AI が自動で呼び戻されるので、
// 利用者はチャットに何も書かなくてよい。待っている間は画面に「AI が回答を待っています」と出る。
// ハブの設定 (.tmp/html-qa/.hub.json) があるときは、ハブを数秒おきに見に行き、届いた回答をローカルの
// <議題フォルダ>/vN.answer.md (と .json) に書いてから表示する。待ち受け中の合図もハブに送る。
// 終了コード: 0 = 回答を受け取った / 2 = 引数の誤り / 3 = 時間切れ / 4 = ハブの鍵が違う
import fs from "node:fs";
import path from "node:path";
import { unreadAnswers, markSeen, formatAnswers, setWaiting, rel, hubConfig } from "./lib.mjs";
import { pullHubAnswers, seenHub, waitingBeat } from "./hub-client.mjs";

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--timeout-min");
if (!dirArg) { console.error("使い方: node ai-skills/html-qa/scripts/wait.mjs <議題フォルダ> [--timeout-min 120]"); process.exit(2); }
const i = args.indexOf("--timeout-min");
const timeoutMin = i >= 0 ? Number(args[i + 1]) : 120;
const dir = path.resolve(dirArg);
if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => /^v\d+\.json$/.test(f))) { console.error(`${dirArg}: 議題フォルダ (v*.json がある所) ではありません`); process.exit(2); }

const root = path.dirname(dir);
const topic = path.basename(dir);
const hub = hubConfig(root);
const HUB_POLL_MS = Number(process.env.HTML_QA_HUB_POLL_MS) || 2500; // ハブを見に行く間隔 (試験で短くする)
const BEAT_MS = 10_000;

const clear = setWaiting(dir);
let beat = null;
let finishing = false;
const finish = async (code, msg) => {
  if (finishing) return;
  finishing = true;
  clearInterval(beat);
  clear();
  if (hub) await waitingBeat(hub, topic, true);
  if (msg) console.log(msg);
  process.exit(code);
};
process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));

if (hub) {
  console.log(`[html-qa] ハブ (${hub.url}) 経由で待ちます: プロジェクト ${hub.project} / 議題 ${topic}`);
  waitingBeat(hub, topic);
  beat = setInterval(() => waitingBeat(hub, topic), BEAT_MS);
}

const started = Date.now();
let hubDown = false;
const check = async () => {
  let pulled = [];
  if (hub) {
    try {
      pulled = await pullHubAnswers(root, hub, topic);
      if (hubDown) { hubDown = false; console.error("[html-qa] ハブにつながりました"); }
    } catch (e) {
      if (e.kind === "auth") return finish(4, `[html-qa] ${e.message}`);
      if (!hubDown) { hubDown = true; console.error(`△ [html-qa] ${e.message}\n  (待ち受けは続けます。ハブに届くようになれば受け取ります)`); }
    }
  }
  const list = unreadAnswers([dir]);
  if (list.length) {
    const text = formatAnswers(list);
    list.forEach(markSeen);
    if (hub) await seenHub(hub, pulled);
    return finish(0, text);
  }
  if (hub && pulled.length) await seenHub(hub, pulled); // ローカルで読み済みの回答: ハブにも印だけ付ける
  if (timeoutMin > 0 && Date.now() - started > timeoutMin * 60_000) {
    return finish(3, `[html-qa] ${timeoutMin} 分待ちましたが回答は届きませんでした (${rel(dir)})。あとで届いた回答は、利用者が次に発言したときに hook が渡します。`);
  }
};
const loop = async () => {
  try { await check(); } catch (e) { console.error(`△ [html-qa] 確認に失敗しました: ${e.message}`); }
  if (!finishing) setTimeout(loop, hub ? HUB_POLL_MS : 1000);
};
loop();
