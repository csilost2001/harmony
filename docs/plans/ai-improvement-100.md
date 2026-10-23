# AI がこのシステムを理解しやすくするための改善提案 100 件 — 進み具合

2026-10-23 の提案 100 件の対応状況。**状態**: 済 = merge 済み / 済(一部) = 範囲を絞って済 (理由を書く) / 見送り = 理由つきで実施しない / 設計者判断 = スキーマの変更を伴い、設計者の承認がいる。
(この文書は、各弾の PR で更新する。判断の経緯: ISSUE #1539 ほか)

## A. MCP の対応範囲 (1〜20)

| # | 提案 | 状態 | 備考 |
|---|---|---|---|
| 1 | 汎用定義の list / get / save | 済 | `list_designs` ほか (kind = genericDefinition)。[mcp-design-access.md](../spec/mcp-design-access.md) |
| 2 | 規約の取得・更新 | 済 | `get_conventions` / `save_conventions` |
| 3 | シーケンス・ビュー・ビュー定義 | 済 | `list_designs` ほか |
| 4 | 技術スタックの取得 | 済 | `get_tech_stack` / `save_tech_stack` |
| 5 | 設計全体の検索 | 済 | `search_design` |
| 6 | 工程単位の取得 | 済 | `list_steps` / `get_step` |
| 7 | 「流れ」の文章 | 済 | `get_flow_story` |
| 8 | 複数の編集を 1 回で適用 | 未 | 第 3 弾 |
| 9 | `dryRun` | 済(一部) | `validate_design` (保存しない検証) と、取り込みの予行。各 `save_*` への引数は付けない (tool ごとの差が大きく、検証と保存の 2 呼び出しで足りる) |
| 10 | 保存せずに検証 | 済 | `validate_design` |
| 11 | スキーマの必要な部分だけ返す | 済(一部) | Resource `harmony://schema/<種類>` で種類ごとに取れる。`$defs` 単位は第 4 弾で |
| 12 | 変更の差分 | 済 | `get_changes_since` (ファイルの更新時刻) |
| 13 | 更新の応答に影響範囲 | 見送り | `find_references` で足りる。応答が重くなる |
| 14 | 処理フローの雛形 | 見送り | 手順は Prompt `create-flow`、HTTP の骨組みは `import_openapi` |
| 15 | 分岐の分析 | 済 | `analyze_branches` |
| 16 | 取り込みを MCP から | 済 | `import_ddl` / `import_openapi` (既定は予行) |
| 17 | 画面項目の一括編集 | 未 | 第 3 弾で検討 |
| 18 | 設計書を章単位で | 済 | `get_design_document` |
| 19 | ワークスペースの比較 | 済 | `compare_workspaces` (登録済みのみ) |
| 20 | 動詞をそろえる | 見送り | 既存の `remove_*` は変えない。新しい tool は `delete_*` |

## B. MCP の仕組み (21〜32)

| # | 提案 | 状態 | 備考 |
|---|---|---|---|
| 21 | Resources | 済 | 第 1 弾 (#1540) |
| 22 | Prompts | 済 | 第 1 弾 |
| 23 | tool の注釈 | 未 | 第 3 弾 |
| 24 | プロファイル | 済 | 第 1 弾 |
| 25 | 説明の短縮 | 未 | 第 3 弾 |
| 26 | `outputSchema` | 未 | 第 3 弾で検討 |
| 27 | 進捗通知 | 未 | 第 3 弾で検討 |
| 28 | 変更の購読 | 未 | 第 3 弾で検討 |
| 29 | 直し方つきエラー | 未 | 第 3 弾 |
| 30 | ページング | 未 | 第 3 弾 |
| 31 | 冪等キー | 未 | 第 3 弾で検討 |
| 32 | 設計全体の要約 | 済 | 第 1 弾 `get_project_context` |

## C〜F

(第 3 弾以降の PR で、ここに足す)
