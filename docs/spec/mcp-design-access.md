---
description: "AI (MCP) が設計を読む・書く・探す・検証する tool の仕様 (シーケンス・ビュー・汎用定義・規約・技術スタック・取り込み・検索・工程単位の取得・流れの文章・分岐の分析・検証だけ・変更の差分・比較・設計書の章)"
status: current
category: ops
---

# AI (MCP) の設計へのアクセス

画面で人が扱える設計を、AI も同じ原本で扱えるようにする tool 群。**どれも画面と同じ原本 (JSON) を読み書きする**。設計の途中でも保存でき (draft-state)、スキーマに合わない点は保存を妨げず、`designer__check_design` の要確認に出る。入口と使い分けは [AI-INDEX.md](../AI-INDEX.md)、権限・プロファイルは [server-security.md](server-security.md)。

## 読み書き: 画面・処理フロー・テーブル・帳票などのほかの設計

| tool | 内容 |
|---|---|
| `designer__list_designs` / `get_design` / `save_design` / `delete_design` | `kind` = `sequence` (シーケンス図) / `view` (DB ビュー) / `viewDefinition` (ビュー定義) / `genericDefinition` (メッセージ・ドメイン型など 21 種)。汎用定義は `definitionKind` + `name`、ほかは `id` |
| `designer__get_conventions` / `save_conventions` | 規約 (`conventions.json`: ロール・権限・上限値・正規表現・DB 規約・メッセージ)。保存は**全体の置き換え** (先に読み、直した全体を渡す) |
| `designer__get_tech_stack` / `save_tech_stack` | 技術スタック (`harmony.json` の `techStack`。コード生成の指針)。保存は全体の置き換え |

- 保存は、画面へ変更を通知する (開いている画面が更新される)
- `save_design` は、`id` を引数の `id` に揃える (`design` の中の `id` と違っても引数が勝つ)
- id・名前に、パスをたどる文字は使えない (tool の入口の検査 `assertEntityIdMcp` / `assertSafeName` と、保存層の検査の二重で断る)
- 汎用定義の保存は、`kind` を `definitionKind` にそろえる。`name` と `design.name`、`design.kind` と `definitionKind` が食い違えば断る
- 一覧 (`list_designs`) は読むだけ (フォルダを作らない)。ないものの削除は `deleted: false`
- 規約・技術スタックが未設定のときは、JSON ではなく「未設定です」という文を返す (そのまま保存に渡して、注記が原本に入らないように)

## 工程のまとめての編集

| tool | 内容 |
|---|---|
| `designer__edit_steps` | 工程の追加・更新・削除・移動・入れ子の移動を、1 回の呼び出しで適用する。`edits` を先頭から順に適用し、**全部成功するか、何も保存しないか**のどちらか。既定は予行 (`apply: true` で保存)。1 回 100 件まで |

- `edits[].op` = `add` { `actionId` `kind` `description?` `detail?` `id?` `position?` `parentStepId?` } / `update` { `stepId` `patch` } / `remove` { `stepId` } / `move` { `stepId` `newIndex` } / `nest` { `stepId` `direction`: `indent` | `outdent` }。`add` の `id` を指定すると、後ろの編集がその工程を指せる (指定しなければ `step-NN` を採番)
- **保存済みのファイルだけが対象**。画面で開いている処理フローは断る (未保存の内容を壊さないため)。ただし確かめられるのは、**最後に接続した 1 つのブラウザ**が開いているものだけ (複数のタブ・ウィンドウで開いている場合、応答が遅れた場合は、断れずにファイルへ書く。ほかの工程の tool のファイル書き込みも同じ)。別のワークスペースで同じ id が開いていても断るその場合は 1 工程ずつの tool (`add_step` `update_step` など。画面に適用され、保存で確定する)
- 失敗した編集の番号 (`edits[2]`) を言い、この呼び出しの編集はすべて破棄する。工程の id が重複するときも保存しない。成功したときは、**この編集で増えたスキーマ違反**だけを `newSchemaIssues` に出す (もとからある違反は言わない。配列の番号は無視して比べるので、工程を動かしただけでは増えない。10 件まで、残りは `moreSchemaIssues` の件数)
- 更新日時は `meta.updatedAt` に入る (トップレベルの `updatedAt` はスキーマにない項目。`add_step` などの保存も同じ処理で、これまで書いていたトップレベルの値は取り除く)
- `apply` は true / false だけ
- 監査ログでは処理フローの変更として数える。予行は残さない

## 取り込み (既定は予行)

| tool | 内容 |
|---|---|
| `designer__import_ddl` | DDL (`CREATE TABLE`。`pg_dump -s` / `mysqldump --no-data` の出力でもよい) → テーブル定義。画面の取り込みと同じ解釈 (`shared/src/importers/ddl.ts`) |
| `designer__import_openapi` | OpenAPI 3.x / swagger 2 → 処理フローの雛形 (操作ごとに 1 本。HTTP の経路・入力・出力・応答だけ。**工程は空**) |

- `apply: true` のときだけ保存する。同じ id がすでにあるものは、`overwrite: true` でなければ置き換えない (`keptExisting` に出る)。置き換えは**中身を丸ごと入れ替える**が、作成日時は引き継ぐ (予行の `exists` で、置き換わるものが分かる)
- 保存の前に、すべての id を検査する。使えない形の id (例: 長すぎる `operationId`) が 1 件でもあれば、**何も保存せず**断る。予行の `invalidIds` に出る。`ids` で、取り込むものを選べる
- 上限: DDL は 512 KiB (解析が列数の 2 乗に近いため。超えるときはテーブルごとに分ける)、1 回に保存するのは 500 件まで (OpenAPI の取り込み上限と同じ)。予行の応答は 100 件で切り、残りは `moreTables` / `moreFlows` の件数にする
- 保存した取り込みは、監査ログに「保存した設計の id」を対象として残る。何も書かなかった呼び出し (すべて既存) は残さない

## 探す・部分で読む・言葉で読む (読み取り専用)

| tool | 内容 |
|---|---|
| `designer__search_design` | 設計全体の本文検索 (画面の検索と同じ)。名前・id で探すのは `list_*` |
| `designer__list_steps` | 処理フローの工程の一覧 (番号・id・種類・要点・対象・備考・入れ子の深さ)。丸ごと読まずに構造をつかむ。分岐の道・繰り返し・TX・**検証の OK / NG 側・承認 / 却下 / 期限切れの後・失敗系の結果ごとの副作用**の中も出る |
| `designer__get_step` | 1 工程の原本 + 親の経路 (どの分岐の道・繰り返しの中か) + 実行条件 (`runIf`) の言葉 |
| `designer__get_flow_story` | 処理フローを「流れ」の文章 (Markdown) で返す。条件は言葉 (『store が ない のとき』)。画面の「流れ」・設計書と同じ読み方 ([process-flow-story-view.md](process-flow-story-view.md)) |
| `designer__analyze_branches` | 分岐の判定表 (条件 × 道の ○ × －) と指摘 (隠れる道・同時に成り立つ道・どの道にも入らない組み合わせ)。分岐は上から順に調べ、最初に成り立った道だけを実行する ([process-flow-runtime-conventions.md](process-flow-runtime-conventions.md) §11.5) |
| `designer__get_design_document` | 設計書の目次と、章ごとの本文。章を指定すると、読みやすい文章 (`format: text`) か HTML。1 回の本文は 60,000 文字まで |

処理フローの画面で開いて未保存の内容があるときは、その内容を読む (`get_process_flow` と同じ)。

## 生成の前後 (読み取り専用)

| tool | 内容 |
|---|---|
| `designer__get_generation_brief` | コードを生成する前に集める情報を 1 つの文書にまとめる (処理フロー / 画面)。詳細は [code-generation.md](code-generation.md) §9.5 |
| `designer__check_test_coverage` | 生成したテストが、テスト観点表のどれだけを覆うか |

## この Harmony の版 (読み取り専用)

| tool | 内容 |
|---|---|
| `designer__workspace_status` / `designer__get_project_context` | 返り値の `harmony` (`version`・`commit`・`branch`・`dirty`・`builtAt`・`source`: `git` / `image`)。どのブランチ・commit から作られた Harmony かが分かる。ネットワークは使わない |
| `designer__check_harmony_update` | この Harmony が GitHub の最新の main より古くないかを確かめる (`status`: `current` / `behind` / `unknown`、`behindBy` / `aheadBy`)。呼んだときだけ GitHub に読み取りで問い合わせる。ワークスペースが開いていなくても使える。仕様: [integration-ops.md](integration-ops.md) §14 |

### 生成のスキルの付属ファイル (Resource)

`generate-code` などの手順 (Prompts) の本文は、`ai-skills/<名前>/templates/**` や `golden-examples/**` を参照する。外の業務プロジェクトはリポジトリを持たないので、これらは MCP の Resource で読む (読み取り専用)。

| Resource | 内容 |
|---|---|
| `harmony://skill/<名前>/files` | スキルのフォルダにある通常のファイルの一覧 (JSON: `{ skill, files: [{ path, size, uri }], note }`)。`path` は `/` 区切り |
| `harmony://skill/<名前>/<パス>` | 1 ファイル。パスは複数の階層 (例 `harmony://skill/generate-code/templates/devcontainer/nestjs-nextjs/.devcontainer/compose.yml`)。上の一覧にあるパスだけ読める |

`<名前>` は Prompts として出すスキル (`create-flow` `review-flow` `generate-code` `generate-tests` `import-md` `rename-screen-ids` `test-strategy`) だけ。Prompt の本文の冒頭にも、この読み方を書いてある (付属ファイルのあるスキル、いまは `generate-code` と `generate-tests` だけ)。守りは [server-security.md](server-security.md) の「AI が読む資料と手順」。Prompts を出さない AI クライアント (VS Code の Claude Code 拡張など) では、Resource `harmony://skill/<名前>/SKILL.md` を読めば同じ手順になる (Prompt は SKILL.md の本文と同じ)。外の業務プロジェクトで Harmony を同居させる構成は [app-devcontainer-sidecar.md](../setup/app-devcontainer-sidecar.md)。

## 開発コンテナの雛形 (generate-code が写した雛形の更新)

| tool | 内容 |
|---|---|
| `designer__get_scaffold_update` | 開発コンテナの雛形 (generate-code の `templates/devcontainer/<組合せ>/`) の更新の材料 (**読み取りのみ**)。`status`: `current` / `outdated` / `no-record` / `not-applicable`、記録の版 `recordedVersion` といまの版 `currentVersion`、`files[]` (`template`・`path`・`kind`: `file` / `section`・`state`: `unchanged` / `template-changed` / `new-in-template` / `removed-from-template`・`base` (写したとき。無ければ 2 方向)・`app` (いまのアプリのファイル)・`latest`・`appEdited`)、当て方の手順 `guide`。中身は変わったファイルだけ・1 ファイル 200KB まで (`truncated`)。ワークスペースが要る。仕様: [integration-ops.md](integration-ops.md) §14 |
| `designer__record_scaffold` | **書き込み**。雛形を写した・更新を当てたあとに、記録 (`design/scaffold.json`) を「いまの雛形の版」で書き直す (`combo?` / `outDir?` / `skipped?`)。雛形の中身は backend が雛形から読んで記録する。`outDir` は安全な相対パス、`skipped` は雛形にあるパスだけ。**当てなかったファイルは必ず `skipped` に渡す** (渡さないと、そのファイルの「写したときの中身」が最新の雛形に置き換わり、次の更新で手入れと雛形の変更を取り違える) |

## 机上の実行と、指摘の直し方

| tool | 内容 |
|---|---|
| `designer__walk_flow` | 処理フローを開始から順に**机上で辿る** (条件は評価しない)。分岐・繰り返しで選ぶ道を `choices` に並べて渡すと、通る工程・選んだ道・そこまでに定義された変数を返す。`choices` が足りなければ、そこで止まり (`status: awaiting`)、選べる道を返す。選び方は番号 (1 始まり。**最優先**)・選択肢の id (`b0` `else` `enter` `skip` `again` `exit`)・ラベルの先頭 (`A`。1 つに決まるときだけ。複数に当たれば断る)。応答の `log` は、長いときは先頭と末尾の 150 件ずつだけ (間は件数で知らせる)。画面の「机上演習」と同じ計算 (`shared/src/flowWalkthrough.ts`)。辿るのは分岐の道・繰り返し・トランザクションの中・配下の工程 (検証の OK / NG 側・承認後・失敗系の副作用の中は辿らない)。5000 工程で止める |

`designer__check_design` の指摘には、機械的な**直し方** (`hint`) が付く (`shared/src/analysis/issueHints.ts`。参照の切れ・工程 id の重複・空の条件・レスポンスの不足・スキーマの必須の項目 / 値 / 型 / 余計な項目・設計ファイルの JSON の破損・一覧の食い違い ほか。規則ごとに実際の文言を通す試験がある)。付かない指摘もある。直したら、もう一度 `check_design`。

## 詰まった点の記録

`designer__report_confusion` — 資料・スキーマ・tool の説明で詰まった点を残す (`topic` 必須。`detail` `tool` `doc` `expected`)。ワークスペースの `.harmony-ops/ai-feedback.json` に残り、**git には載らない** (500 件まで、古いものから捨てる。文字数の上限あり)。書く tool なので、読み取り専用の接続・プロファイル `read` には出ない。利用者は `npm run ai:feedback -- <ワークスペース>` で、tool ごと・資料ごとに集計して、改善の優先順位に使う。作業を止めずに、短く書く。

## 検証だけ・変更の差分・比較 (読み取り専用)

| tool | 内容 |
|---|---|
| `designer__validate_design` | **保存せずに** (フォルダも作らない)、JSON が合うかを確かめる。`processFlow` / `screen` / `table` はスキーマ、`report` / `businessFlow` は検証。作ってから保存する前の確認に使う (`dryRun` を各 `save_*` に付ける代わり) |
| `designer__get_changes_since` | ある時刻より後に変わった設計ファイル (種類・id・更新時刻)。人が画面で直した分を知る。`since` は ISO の日時 (省略すると直近 24 時間)。`.` で始まるフォルダ (`.harmony-backups` など) は含めない。200 件まで |
| `designer__compare_workspaces` | いまのワークスペースと、**登録済み**の別のワークスペース (id またはパス) を、画面・テーブル・処理フロー・業務フロー・帳票の id で比べる (シーケンス・ビュー・汎用定義は比べない)。登録されていないパスは読まない |

## 一覧の件数制限

`list_designs` と `list_steps` は `limit` (既定 200 / 工程は 300、最大 1000) と `offset` を取り、`count` / `total`・`offset`・`hasMore` を返す。ほかの一覧は、すでに上限がある (`search_design` 30〜100・`get_changes_since` 200・取り込みの予行 100)。`list_process_flows` などの従来の一覧 (文章で返すもの) は変えていない。

## 判断した点・限界

- **tool を種類ごとに増やさず、`kind` で 1 組にした** (シーケンス・ビュー・ビュー定義・汎用定義)。tool の説明は毎回 AI の文脈に載るため。画面・処理フロー・テーブル・帳票・業務フロー・ページレイアウトの既存の tool は、そのまま
- `remove_*` と `delete_*` の混在は、名前を変えない (既存の呼び出し・スキル・資料が広く使っている)。新しい tool は `delete_*` に揃えた
- 各 `save_*` / `update_*` への `dryRun` 引数と、更新の応答に「影響を受ける設計」を添えることは、していない。代わりに `validate_design` (保存前の確認)・`edit_steps` と取り込みの予行・`find_references` (影響) を使う
- 処理フローの雛形を作る専用の tool は作らない。手順は Prompt `create-flow` が持ち、HTTP の骨組みは `import_openapi` が作る
- `get_changes_since` は、ファイルの更新時刻で見る (誰が変えたかは分からない。誰が・なぜは「設計のあゆみ」)

## 読み取り専用の tool

`HARMONY_MCP_MODE=readonly` と、プロファイル `read` / `review` で使える。次は何も書かない (試験 `designAccess.test.ts` が、書く tool を断ることを確かめる): `list_designs` `get_design` `get_conventions` `get_tech_stack` `search_design` `list_steps` `get_step` `get_flow_story` `analyze_branches` `get_design_document` `validate_design` `get_changes_since` `compare_workspaces` `get_tool_guide` `get_generation_brief` `check_test_coverage` `walk_flow` `check_harmony_update` `get_scaffold_update`。書く tool は `save_design` `delete_design` `save_conventions` `save_tech_stack` `import_ddl` `import_openapi` `edit_steps`。
