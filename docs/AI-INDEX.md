---
description: "AI 向けの入口。やりたいこと → 読む資料・使う MCP tool・使う手順 (スキル) の対応"
---

# AI 向けの入口

Harmony の設計 (画面・処理フロー・テーブル・規約) を、AI が読み書きするときの最初の 1 枚。全部を読む必要はない。**やりたいことの行だけ**を読む。

MCP につながっていれば、この文書は Resource `harmony://docs/ai-index` で読める。仕様書の索引は `harmony://spec/index`、JSON Schema は `harmony://schema/<種類>`。

## 最初にやること

1. ワークスペースが開かれているか確かめる (`designer__workspace_status`)。開かれていなければ `designer__workspace_list` → `designer__workspace_open`
2. `designer__get_project_context` を 1 回呼ぶ。設計の件数・名前・規約・**未解決のマーカー (人から AI への指示・質問)** が分かる
3. 設計を作る・直したら、完了を報告する前に `designer__check_design` を呼び、error / warning を 0 件にする。要確認を黙らせるのは人 (画面か `design-check.json`)。AI は黙らせない

## 守ること

- **JSON Schema (`schemas/v3/*.json`) の変更は設計者の判断**。AI は変えない。表せないときは、拡張 (`extensions/`) → 既存の項目での代替 → 設計者に相談、の順 ([schema-governance.md](spec/schema-governance.md))
- 画面やデータを開いただけで原本を書き換えない。保存は利用者の操作か、AI の明示的な変更だけ
- 処理フローの分岐は**上から順に調べ、最初に成り立った道だけを実行する** ([process-flow-runtime-conventions.md](spec/process-flow-runtime-conventions.md) §11.5)

## やりたいこと → 読む資料・使うもの

| やりたいこと | 読む資料 | 使う tool / 手順 |
|---|---|---|
| 設計の全体をつかむ | — | `get_project_context`、設計書の章ごと: `get_design_document`、探す: `search_design` |
| 人が直した分を知る | — | `get_changes_since` |
| 保存する前に確かめる | [mcp-design-access.md](spec/mcp-design-access.md) | `validate_design` (保存しない) |
| シーケンス・ビュー・汎用定義・規約・技術スタックを読み書きする | [mcp-design-access.md](spec/mcp-design-access.md) / [generic-definition-layer.md](spec/generic-definition-layer.md) | `list_designs` / `get_design` / `save_design` / `delete_design`、`get_conventions` / `save_conventions`、`get_tech_stack` / `save_tech_stack` |
| DDL・OpenAPI から取り込む | [mcp-design-access.md](spec/mcp-design-access.md) | `import_ddl` / `import_openapi` (既定は予行、`apply: true` で保存) |
| 処理フローを新しく作る | [process-flow-variables.md](spec/process-flow-variables.md) / [process-flow-expression-language.md](spec/process-flow-expression-language.md) / [process-flow-runtime-conventions.md](spec/process-flow-runtime-conventions.md) / [conversion-guideline-for-ai.md](spec/conversion-guideline-for-ai.md) | 手順 `create-flow` → `add_process_flow` / `add_action` / `add_step` |
| 工程をまとめて直す (全部成功か何も保存しない) | [mcp-design-access.md](spec/mcp-design-access.md) | `edit_steps` (既定は予行、`apply: true` で保存) |
| 処理フローを直す | [process-flow-story-view.md](spec/process-flow-story-view.md) (人が見る「流れ」の言葉) | まず `get_flow_story` (全体を文章で) → `list_steps` → `get_step` (1 工程) → `update_step` / `move_step` / `nest_step` / `remove_step` / `add_step_note`。分岐の抜けは `analyze_branches` |
| 処理フローをレビューする | [process-flow-runtime-conventions.md](spec/process-flow-runtime-conventions.md) | 手順 `review-flow`、`add_review_findings` |
| 画面を作る・直す | [screen-layout.md](spec/screen-layout.md) / [layout-components.md](spec/layout-components.md) / [screen-items.md](spec/screen-items.md) | `list_screens` / `get_screen_layout` / `set_screen_layout` / `add_screen` / `update_screen` |
| 画面項目の名前を整える | [screen-items.md](spec/screen-items.md) | 手順 `rename-screen-ids`、`rename_screen_item`、`check_screen_item_refs` |
| テーブルを作る・直す | `schemas/v3/table.v3.schema.json` | `list_tables` / `get_table` / `add_table` / `update_table`、`generate_ddl` / `generate_er_mermaid` |
| 帳票・業務フロー・ページレイアウト | [report.md](spec/report.md) / [business-flow.md](spec/business-flow.md) / [page-layout.md](spec/page-layout.md) | `get_report` / `save_report`、`get_business_flow` / `save_business_flow`、`get_page_layout` / `save_page_layout` |
| 名前を変える・参照を付け替える | [references.md](spec/references.md) | `find_references` → `rename_entity` (既定は予行、`apply: true` で実行) / `replace_references`、取り消しは `undo_rename` / `undo_replace_references` |
| 設計を点検する | [design-document.md](spec/design-document.md) / [design-check.md](spec/design-check.md) | `check_design`、影響・未使用・用語などは `analyze_design` ([design-analysis.md](spec/design-analysis.md)) |
| 人からの指示・質問に答える | [ui-markers.md](spec/ui-markers.md) | `find_all_markers` → 対応したら `resolve_marker`、新しい質問は `add_marker` |
| コードを生成する | [code-generation.md](spec/code-generation.md) | 手順 `generate-code` → 生成したら `record_generation`。再生成の前は `check_generation_drift` / `get_regeneration_diff` |
| テストを作る | [test-viewpoints.md](spec/test-viewpoints.md) / [process-flow-testing.md](spec/process-flow-testing.md) | `get_test_viewpoints` (ID つきの観点表)、手順 `generate-tests` / `test-strategy` |
| Markdown の設計書から取り込む | [conversion-guideline-for-ai.md](spec/conversion-guideline-for-ai.md) | 手順 `import-md` |
| 外部の仕様 (OpenAPI など) へ書き出す | [integration-ops.md](spec/integration-ops.md) | `export_openapi` / `export_arazzo` / `export_spec` |
| 前の版に戻す・壊れた設計を直す | [file-backup.md](spec/file-backup.md) / [workspace-health.md](spec/workspace-health.md) | `list_versions` → `restore_version`、`repair_registry`、`persist_uuids` |
| 拡張 (独自の工程・型) を足す | [process-flow-extensions.md](spec/process-flow-extensions.md) / [plugin-system.md](spec/plugin-system.md) | `list_extensions` / `add_step_extension` ほか `add_*_extension` |

手順 (`create-flow` など) は MCP の Prompts で取れる。`prompts/list` で一覧、`prompts/get` で本文。引数は `arguments` に 1 本の文字列で渡す。

## 資料の探し方

- **用語**: `docs/glossary.json` (`harmony://docs/glossary`) — 日本語の用語 ↔ スキーマの定義 ↔ MCP tool ↔ 仕様書
- **スキーマ**: `harmony://schema/<種類>`。`$defs` ごとの要約・必須の項目は `docs/spec/schema-index.json` (`harmony://spec/schema-index`)。工程の種類の一覧は [process-flow-step-kinds.md](spec/process-flow-step-kinds.md)
- **作業の手順**: [ai-recipes.md](spec/ai-recipes.md) (作業別の呼び順と、よくある失敗の逆引き)。処理フローの self-check ルールの一覧は [process-flow-pitfalls.md](spec/process-flow-pitfalls.md)
- **例**: [examples/PATTERNS.md](../examples/PATTERNS.md) — 工程の種類・書き方ごとに、近いサンプルの場所
- **なぜそうなっているか**: [decisions/](decisions/README.md) — 設計判断の記録 (分岐は上から順・SQL は工程に書く・スキーマは設計者の専権 ほか)
- **実装を読む・直すとき**: [codemap.md](codemap.md) — 用語・機能 → ファイル
- **大きな仕様書**: 全体を読まず、`harmony://spec/<名前>/sections` で章の一覧を見て、`harmony://spec/<名前>/<n>` で 1 章ずつ読む

- 仕様書は `docs/spec/` に 90 本余り。各ファイルの先頭の `description` (要約)・`status` (current / deprecated / record)・`category` を、`docs/spec/index.json` にまとめてある。**まず索引で選ぶ**
- `status: record` は過去の時点の記録 (評価・監査・ドッグフード)。現行の仕様ではない。`deprecated` は廃止済み (記録として残す)
- 判断の経緯: [plans/redesign-2026-10.md](plans/redesign-2026-10.md)
- 人向けの使い方 (操作の手順): [user-guide/](user-guide/README.md)
- サンプル: `examples/<project-id>/` (retail・diary・household-budget ほか)。作り方に迷ったら、近い業務の例を読む

## MCP の tool を絞る

tool は 100 個を超え、説明が毎回文脈に載る。作業に合わせて見せる tool を絞れる (権限の仕組みではなく、見える数を減らす設定):

| 接続の URL | 見える tool |
|---|---|
| `http://localhost:5179/mcp` | すべて |
| `…/mcp?profile=flow` | 処理フローを作る・直す |
| `…/mcp?profile=table` | テーブルを作る・直す |
| `…/mcp?profile=screen` | 画面・画面項目・ページレイアウト |
| `…/mcp?profile=doc` | 業務フロー・帳票・シーケンス・ビュー・汎用定義・規約・技術スタック・拡張 |
| `…/mcp?profile=maint` | 保守 (一括保存・版の復旧・登録簿の修復・スキーマ移行・パック) |
| `…/mcp?profile=review` | 読む + レビューの指摘・マーカー |
| `…/mcp?profile=read` | 読み取りだけ |

カンマで複数 (`?profile=flow,table`)。説明を短くするなら `?detail=brief` (約 4 割減。詳細は `designer__get_tool_guide` で引く。`?profile=flow&detail=brief` のように重ねられる)。すべての tool は、どれかのプロファイルに入る。どのプロファイルにも、ワークスペース・`get_project_context`・`check_design`・`analyze_design`・`find_references`・マーカー・タブの tool は入る。権限の制限 (`HARMONY_MCP_MODE` / `HARMONY_MCP_DENY`) は別に掛かる。詳しくは [server-security.md](spec/server-security.md)。
