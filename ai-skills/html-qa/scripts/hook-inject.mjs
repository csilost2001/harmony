#!/usr/bin/env node
// html-qa: Claude Code の UserPromptSubmit hook。
// まだ AI が読んでいない回答 (.tmp/html-qa/<topic>/vN.answer.md) があれば、利用者の発言に添えて AI に渡す。
// wait.mjs が動いていなかったとき (セッションを開き直した等) の届け漏れを防ぐ。回答が無ければ何も出さない。
import path from "node:path";
import { DEFAULT_ROOT, topicDirs, unreadAnswers, markSeen, formatAnswers, isWaiting } from "./lib.mjs";

try {
  const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), DEFAULT_ROOT);
  // wait.mjs が待っている議題はそちらに任せる (二重に渡さない)
  const list = unreadAnswers(topicDirs(root).filter((d) => !isWaiting(d))).slice(-5);
  if (list.length) {
    const context = `${formatAnswers(list)}\n\n(この回答は、利用者が html-qa の画面の「AI に送る」で送ったもので、まだ AI が読んでいなかった分。hook が利用者の今の発言に添えた)`;
    list.forEach(markSeen);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }));
  }
} catch {
  // hook の失敗で利用者の発言を止めない
}
process.exit(0);
