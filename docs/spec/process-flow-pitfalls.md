---
description: "処理フロー作成の self-check ルール (よくある間違い) の一覧。create-flow スキルの見出しから自動生成"
status: current
category: process-flow
---

# 処理フロー作成の self-check ルール

> **自動生成**: この文書は手で直さない。正本を直して `node scripts/docs/generated.mjs --write` で作り直す (ずれていると `npm run check:docs` が止める)。


処理フローを作る前に確かめる、過去の間違いから作ったルール 33 件。**本文 (症状・正しい形・検出の方法) は、スキル `create-flow` にある** (MCP の Prompt `create-flow`、またはリポジトリの `ai-skills/create-flow/SKILL.md` の「Step 3」)。この表は、ルールを探す索引。レビューの観点は Prompt `review-flow`。

| Rule | 内容 |
|---|---|
| 1 | 変数ライフサイクル |
| 2 | TransactionScope 内外整合 |
| 3 | runIf 連鎖の網羅性 |
| 4 | branch / elseBranch 到達性 |
| 5 | compensatesFor 参照健全性 |
| 6 | eventsCatalog ⇄ eventPublish 双方向整合 |
| 7 | 外部呼び出しと TX 位置関係 |
| 8 | rollbackOn 発火可能性 |
| 9 | SQL SELECT カラム整合 |
| 10 | @conv.* 参照の catalog 整合 |
| 11 | TX 内 branch return 後の制御 |
| 12 | affectedRowsCheck.operator は = のみ受容 |
| 13 | affectedRowsCheck.expected は integer リテラル必須 |
| 14 | OtherStep.outputSchema 形式制約 |
| 15 | グローバル schema 変更禁止 |
| 16 | 画面項目イベント連携整合 |
| 17 | 画面項目値レベル整合 |
| 18 | testScenarios fixture バリエーション網羅 |
| 19 | DB 制約 × INSERT / DELETE 操作順序 |
| 20 | ViewDefinition 整合 |
| 21 | 画面遷移三者整合 |
| 22 | 画面項目 refKey 横断整合 |
| 23 | 画面項目 embed + design ファイル配置 |
| 24 | '@conv.*' シングルクォート内リテラル化禁止 |
| 25 | JSON 重複 kind キー禁止 |
| 26 | httpRoute API への screenTransition step 混入禁止 |
| 27 | @conv.numbering.X.nextSeq() 構文禁止 → DB sequence 利用 |
| 28 | rollbackOn 発火可能性 + lineage.writes.purpose 整合 |
| 29 | 単一 dbAccess.sql への複数文 SQL 詰め込み禁止 |
| 30 | SQL SELECT 句で camelCase 化が必要な列は AS "&lt;camelCase&gt;" alias 必須 |
| 31 | 業務上存在しない値 (架空値) の WHERE 句 hardcode 禁止 |
| 32 | SQL alias で同名異物理列を取得し event payload で誤参照しない |
| 33 | PostgreSQL aggregate (COUNT/SUM/AVG/DATE_PART 等) の型変換は outputBinding.transformations で吸収 |

- 機械で検出できるものは `cd frontend && npm run validate:samples -- ../examples/<project-id>` と `designer__check_design` が止める。意味 (架空の値・SQL の別名の取り違え) は目で確かめる
