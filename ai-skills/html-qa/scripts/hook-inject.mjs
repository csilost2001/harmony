#!/usr/bin/env node
// html-qa: Claude Code の UserPromptSubmit hook。
// まだ AI が読んでいない回答 (.tmp/html-qa/<topic>/vN.answer.md) があれば、利用者の発言に添えて AI に渡す。
// wait.mjs が動いていなかったとき (セッションを開き直した等) の届け漏れを防ぐ。回答が無ければ何も出さない。
// ハブの設定 (.hub.json) があれば、先にハブの未読の回答をローカルに取り込む (つながらなくても発言は止めない)。
import path from "node:path";
import { DEFAULT_ROOT, topicDirs, unreadAnswers, markSeen, formatAnswers, isWaiting, hubConfig } from "./lib.mjs";
import { pullHubAnswers, seenHub } from "./hub-client.mjs";

try {
  const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), DEFAULT_ROOT);
  const hub = hubConfig(root);
  let pulled = [];
  if (hub) {
    try { pulled = (await pullHubAnswers(root, hub, null, { timeoutMs: 2500 })).filter((p) => !isWaiting(path.join(root, p.topic))); } catch { /* ハブに届かなくても発言は止めない */ }
  }
  // wait.mjs が待っている議題はそちらに任せる (二重に渡さない)
  const list = unreadAnswers(topicDirs(root).filter((d) => !isWaiting(d))).slice(-5);
  if (list.length) {
    const context = `${formatAnswers(list)}\n\n(この回答は、利用者が html-qa の画面の「AI に送る」で送ったもので、まだ AI が読んでいなかった分。hook が利用者の今の発言に添えた)`;
    list.forEach(markSeen);
    if (hub) await seenHub(hub, pulled.filter((p) => list.some((a) => a.topic === p.topic && a.version === p.version)));
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
  }
} catch {
  // hook の失敗で利用者の発言を止めない
}
process.exit(0);
