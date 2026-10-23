---
description: "設計判断の記録 (ADR): 決めたこととその理由。1 件 1 ファイル"
---

# 設計判断の記録

「なぜこうなっているか」を、AI が読み直さなくても分かるようにする記録。1 件 1 ファイル。仕様そのものは [docs/spec/](../spec/README.md) にあり、ここは**判断の理由と、選ばなかった案**を残す。MCP の Resource `harmony://decisions/<名前>` でも読める。

| 記録 | 決めたこと |
|---|---|
| [0001-branch-first-match](0001-branch-first-match.md) | 分岐は上から順に調べ、最初に成り立った道だけを実行する |
| [0002-sql-inline](0002-sql-inline.md) | SQL は DB アクセスの工程に直接書く (別管理にしない) |
| [0003-story-view-not-default](0003-story-view-not-default.md) | 「流れ」は既定の表示にしない (カードが既定) |
| [0004-schema-designer-only](0004-schema-designer-only.md) | スキーマの変更は設計者の専権。AI は拡張・既存の項目で表す |
| [0005-draft-state-save-anyway](0005-draft-state-save-anyway.md) | 設計は途中でも保存でき、違反は要確認として示す |
| [0006-mcp-profile-is-not-security](0006-mcp-profile-is-not-security.md) | tool のプロファイルは権限ではなく、見える数を減らす設定 |
| [0007-mcp-stateless](0007-mcp-stateless.md) | MCP の接続は要求ごとに作り直す。通知は押し出さず、聞かれて答える |
| [0008-mcp-kind-tools-and-batch](0008-mcp-kind-tools-and-batch.md) | 設計の種類ごとに tool を増やさず kind で 1 組にする。まとめての編集は保存済みのファイルだけ |

各記録の先頭に、**決めた人** (`decidedBy`) と**設計者の確認** (`confirmation`) を書く。設計者の確認がまだのものは、AI が「承認済み」と読まないように、そう書いてある (0001・0003)。

書式: 状況 → 決めたこと → 理由 → 選ばなかった案 → 結果 (関連する仕様・試験)。判断を変えるときは、古い記録を消さず、新しい記録で「置き換える」と書く。
