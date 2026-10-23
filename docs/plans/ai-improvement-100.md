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
| 8 | 複数の編集を 1 回で適用 | 済 | `edit_steps` (全部成功か何も保存しない。予行つき) |
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
| 23 | tool の注釈 | 済 | `annotations` を全 tool に |
| 24 | プロファイル | 済 | 第 1 弾 |
| 25 | 説明の短縮 | 済 | `?detail=brief` (約 4 割減) と `get_tool_guide` |
| 26 | `outputSchema` | 見送り | 結果は JSON の文字列で返しており、構造化出力に変えると全 tool の応答と呼び出し側 (スキル・試験) が変わる。注釈・直し方・件数制限を先に入れた。要望があれば別の弾で |
| 27 | 進捗通知 | 見送り | 時間のかかる tool が無い (最大の設計書の組み立てでも数百 ms。大規模は未計測)。長い処理が出たら足す |
| 28 | 変更の購読 | 見送り | MCP の接続は要求ごとにサーバを作り直す方式 (stateless) で、サーバから AI へ通知を押し出せない。代わりに `get_changes_since` で、必要なときに聞く |
| 29 | 直し方つきエラー | 済 | 失敗の文に `直し方:` を添える |
| 30 | ページング | 済(一部) | `list_designs` / `list_steps` に `limit` / `offset`。文章で返す従来の一覧は変えない |
| 31 | 冪等キー | 見送り | stateless で、キーを覚えておく場所が無い。`save_*` `update_*` `delete_*` は元から冪等、`add_*` の再送は一覧で確かめられる (注釈の `idempotentHint` で区別) |
| 32 | 設計全体の要約 | 済 | 第 1 弾 `get_project_context` |

## C. AI 向けの資料 (33〜52)

| # | 提案 | 状態 | 備考 |
|---|---|---|---|
| 33 | `llms.txt` / AI-INDEX | 済 | 第 1 弾 |
| 34 | 仕様書の frontmatter と索引 | 済 | 第 1 弾 (`docs/spec/index.json`) |
| 35 | `conversion-guideline-for-ai.md` (88KB) を分ける | 済(別の形) | ファイルは分けず、**章ごとに読める** Resource にした: `harmony://spec/<名前>/sections` (章の一覧) と `harmony://spec/<名前>/<n>`。大きな仕様書すべてに効く。ファイルを分けると、既存の参照・リンクが広く壊れる |
| 36 | `schema-design-principles.md` の要約 | 済(別の形) | 同上 (章単位)。要約を別に書くと、本文とずれる |
| 37 | 用語集 (機械可読) | 済 | `docs/glossary.json` (`harmony://docs/glossary`)。中心の用語は手で、工程の種類はスキーマから自動。tool・仕様書・スキーマの定義の実在を検査 |
| 38 | 設計判断の記録 (ADR) | 済 | `docs/decisions/` (8 件。`harmony://decisions/<名前>`) |
| 39 | 「よくある間違い」集 | 済 | `docs/spec/process-flow-pitfalls.md` (create-flow スキルの見出しから自動生成。本文はスキルにある) |
| 40 | 作業別レシピ | 済 | `docs/spec/ai-recipes.md` (`harmony://docs/recipes`) |
| 41 | 資料の JSON 例をスキーマで検査 | 済 | 印 `<!-- schema: … -->` つきのブロックを検査 (`scripts/docs/json-examples.mjs`)。印のないブロックは、断片が多く検査先を機械で決められないので見ない |
| 42 | 資料の例を `examples/` から自動で埋め込む | 見送り | 埋め込むと文書が読みにくくなる。代わりに、印つきの例の検査 (41) と、サンプルの場所の索引 (51) |
| 43 | スキーマを `$defs` 単位で引く索引 | 済 | `docs/spec/schema-index.json` (`harmony://spec/schema-index`。自動生成) |
| 44 | 工程の種類の一覧表 | 済 | `docs/spec/process-flow-step-kinds.md` (自動生成)。**`setGlobal` に日本語名が無かったのも直した** |
| 45 | 資料の状態ラベル | 済 | 第 1 弾 (frontmatter の `status`) |
| 46 | AGENTS.md を階層化 | 済(一部) | 索引表の各行を短くし約 9% 減。領域別の本文は、仕様書側に元からある。コマンド表・ルールは毎回必要なので残す |
| 47 | ディレクトリごとの README | 済 | `backend/src/handlers` `backend/src/security` `shared/src` `…/process-flow/story` |
| 48 | 用語 → ファイルの地図 | 済 | `docs/codemap.md` (`harmony://docs/codemap`)。書いたパスの実在を検査 |
| 49 | 逆引き FAQ | 済 | `ai-recipes.md` の「よくある失敗」 |
| 50 | user-guide と spec の相互リンク | 見送り | AI-INDEX から両方へ行ける。全ページの相互リンクは、保つ手間に見合わない |
| 51 | サンプルが示すパターンの索引 | 済 | `examples/PATTERNS.md` (自動生成) |
| 52 | 資料とスキーマの版の紐づけ | 済(一部) | 仕様書の索引・スキーマの索引に `schemaVersion: v3` |

## D〜F

(第 5 弾以降の PR で、ここに足す)
