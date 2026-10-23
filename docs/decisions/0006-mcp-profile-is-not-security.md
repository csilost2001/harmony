---
description: "tool のプロファイル (?profile=) は権限ではなく、AI に見える tool の数を減らす設定"
status: decided
decidedBy: "AI (設計者の一任のもと)"
date: 2026-10-23
---

# 0006 プロファイルは権限ではない

**状況**: MCP の tool が 100 個を超え、説明が毎回 AI の文脈に載る。作業ごとに絞りたい。

**決めたこと**: 接続の URL の `?profile=flow` などで、見せる tool を絞る。**権限の仕組みとは別**で、両方が掛かる (読み取り専用モード・拒否リストは `HARMONY_MCP_MODE` / `HARMONY_MCP_DENY`)。絞った接続は、一覧に出ない tool を呼んでも断る。

**理由**: 権限と表示を混ぜると、「見えないから安全」という誤解を生む。権限は許可リスト (`READ_ONLY_TOOLS`) で決め、プロファイルはその内側を使いやすくするだけ。

**選ばなかった案**: プロファイルを権限として扱う / tool の名前の規則で読み取りを決める (将来の書き込み tool が漏れる)。

**結果**: [server-security.md](../spec/server-security.md)。すべての tool がどれかのプロファイルに入ることを試験が見張る。
