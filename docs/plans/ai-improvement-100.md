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
| 46 | AGENTS.md を階層化 | 済(一部) | 索引表の各行を短くし、約 6% 減 (文字数。バイトでは約 10%)。領域別の本文は、仕様書側に元からある。コマンド表・ルールは毎回必要なので残す |
| 47 | ディレクトリごとの README | 済 | `backend/src/handlers` `backend/src/security` `shared/src` `…/process-flow/story` |
| 48 | 用語 → ファイルの地図 | 済 | `docs/codemap.md` (`harmony://docs/codemap`)。書いたパスの実在を検査 |
| 49 | 逆引き FAQ | 済 | `ai-recipes.md` の「よくある失敗」 |
| 50 | user-guide と spec の相互リンク | 見送り | AI-INDEX から両方へ行ける。全ページの相互リンクは、保つ手間に見合わない |
| 51 | サンプルが示すパターンの索引 | 済 | `examples/PATTERNS.md` (自動生成) |
| 52 | 資料とスキーマの版の紐づけ | 済(一部) | 仕様書の索引・スキーマの索引に `schemaVersion: v3` |

## D. スキーマ (53〜72)

設計者の判断待ち。まとめと推奨は [schema-proposals-2026-10.md](schema-proposals-2026-10.md) (第 7 弾で追加)。

## E. 生成と検証のループ (73〜84)

| # | 提案 | 状態 | 備考 |
|---|---|---|---|
| 73 | 実装計画書 (生成の指示書) | 済 | `designer__get_generation_brief` (処理フロー / 画面。流れ・使うテーブル・規約の値・テスト観点・記録の呼び方) |
| 74 | テスト観点のカバレッジ | 済 | `designer__check_test_coverage` (記録されたテストの本文の観点 ID を数える) |
| 75 | 技術スタック別の慣用を規約として渡す | 済(既存) | 技術スタックのプリセットと `get_tech_stack`、生成の指示書に技術スタックを含める |
| 76 | 机上実行を MCP に | 済 | `designer__walk_flow` (画面の机上演習の計算を shared に移して共有) |
| 77 | ずれの検査を CLI に | 済 | `npm run check:generation -- <ワークスペース> [--coverage --min]` |
| 78 | OpenAPI から処理フローの雛形 | 済 | 第 2 弾 `import_openapi` |
| 79 | 実 DB から ER を取り込む | 見送り | 接続情報の扱い・外部への接続を増やす割に、`pg_dump -s` / `mysqldump --no-data` の出力を `import_ddl` で取り込めば足りる |
| 80 | わざと壊した設計で検査を試す | 済 | `backend/src/designMutation.test.ts` (15 種の壊し方)。**検査の穴を 8 つ見つけて塞いだ**(下) |
| 81 | AI の出力の評価セット | 済 | `docs/evals/` と `npm run eval:design` (LLM なしの構造の採点。事例 3 件) |
| 82 | MCP 呼び出しのログ分析 | 済 | 呼び出しを 1 行ずつログに残し (引数・結果は残さない)、`npm run mcp:report` で tool ごとの失敗率・遅さ・多い失敗を集計 |
| 83 | 要確認の直し方を機械的に付ける | 済 | `check_design` の指摘に `hint` (`shared/src/analysis/issueHints.ts`)。自動で直す (autofix) ことはしない — 直すのは AI / 人 |
| 84 | 設計ごとの 3 行要約 | 済(別の形) | `get_project_context`(件数・名前)・`get_flow_story`(流れの文章)・`search_design`。説明を持たない設計の要約を機械で作ると、中身とずれる |

**80 で見つけた検査の穴(いずれも `check_design` が「要確認 0 件」と答えていた)**: ないテーブルを指す DB アクセス / 画面項目の結びつき / 外部キー、ない画面を指す処理フロー・画面遷移、ない処理フローを呼ぶ画面項目のイベント、アクションの `responses` にない `responseId`、規約にない `@conv.*`、空の分岐条件、同じアクションの工程 id の重複 — を `shared/src/analysis/integrity.ts` で検出するようにした。あわせて、**1 つの工程の必須項目の不足が 100 件超のスキーマ違反として出ていた雑音**(工程は 26 種類の oneOf)を、その種類の定義に対する 1 件に絞った(`projectStorage.ts` の `refineStepErrors`)。`analysis/common.ts` の `forEachStep` が、検証の OK/NG 側・承認後・失敗系の副作用の中の工程を歩かなかったのも直した。

## F. 運用と人の側 (85〜100)

| # | 提案 | 状態 | 備考 |
|---|---|---|---|
| 85 | 共同編集 (#855) | 設計者判断 | 保留中の大きな判断。この提案群では扱わない |
| 86 | AI の変更を差分カードで採否 | 見送り | 画面の大きな機能。AI の変更は『設計のあゆみ』と保存前の版 (`restore_version`) で戻せる。要望があれば別の弾で |
| 87 | AI の指示と変更の紐づけ | 見送り | AI の書き込みは監査ログに残る (誰が・どの tool で)。『どの指示で』は、AI の会話の側の情報で、サーバは知らない |
| 88 | 読み取り専用の入口 | 済 | `/mcp-readonly` (書き込みが絶対にできない。環境変数・プロファイルで緩められない) |
| 89 | MCP の使用量レポート | 済 | 82 の `npm run mcp:report` と、既存の『設計のあゆみ』『期間のまとめ』 |
| 90 | 設計の健全度の推移 | 済(既存) | 進捗 (成熟度の集計と推移・`analyze_design` の `progress`) |
| 91 | 変更に関係するテスト観点だけ再生成 | 済 | 第 5 弾 `get_test_viewpoints` の `since` |
| 92 | 「流れ」表示を画面・テーブルにも | 見送り | 画面・テーブルは、項目の表と業務部品の木が読み物になっている。処理フローのように入れ子と条件で読みにくいものではない |
| 93 | 工程 1000 件以上の速さ | 第 7 弾 | |
| 94 | 設計書に終わり方の一覧・状態遷移図 | 見送り | 終わり方は処理記述表とテスト観点の表が、すでに同じ内容を出している。状態遷移はスキーマの追加 (#1499) が先 — 設計者判断 |
| 95 | 設計書の判定表から『流れ』へ | 見送り | 設計書は書き出した紙面(HTML / Word / Excel)で、画面への導線を持てない。設計書ビュー (`/document`) の要確認からは、該当の設計を開ける |
| 96 | Word / Excel を読み戻して検査 | 第 7 弾 | |
| 97 | タッチ・読み上げの確認 | 見送り | 実機・支援技術での確認が要る。自動の a11y 検査 (`ui:audit` など) は既存。人の確認として残る |
| 98 | 多言語 | 見送り | 設計書・UI・スキーマのラベルの全面に及ぶ大きな機能。要望があれば別の弾で |
| 99 | 画面の利用状況の集計 | 見送り | 利用者の操作の記録は、プライバシーの扱いを決めてから。MCP の呼び出しの集計 (82) は、引数を残さない形で入れた |
| 100 | AI が迷ったら残す | 済 | `designer__report_confusion` と `npm run ai:feedback` |
