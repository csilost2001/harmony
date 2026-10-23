---
description: "分岐は上から順に調べ、最初に成り立った道だけを実行する"
status: decided
period: "2026-10"
---

# 0001 分岐は上から順・最初に成り立った道だけ

**状況**: 処理フローの分岐 (`branch`) が複数の道を持つとき、複数の条件が同時に成り立つ場合の扱いが仕様に書かれていなかった。判定表で見ると「隠れる道」「重なる道」が生まれる。

**決めたこと**: 道は**上から順に調べ、最初に成り立った道だけを実行する**。どれも成り立たなければ「上記以外」(`elseBranch`) へ。

**理由**: 実装 (if / else if) の自然な読みと一致し、AI が生成するコードも同じになる。人が表で読むときも、上の道が優先と分かる。

**選ばなかった案**: 成り立つ道をすべて実行する (switch の貫通に近く、事故が多い) / 重なりをスキーマで禁止する (既存の設計を壊し、書きにくい)。

**結果**: [process-flow-runtime-conventions.md](../spec/process-flow-runtime-conventions.md) §11.5。判定表 (`designer__analyze_branches`・画面の「流れ」・設計書) が、隠れる道・重なる道・どの道にも入らない組み合わせを指摘する ([process-flow-story-view.md](../spec/process-flow-story-view.md))。create-flow スキルにも書いた。
