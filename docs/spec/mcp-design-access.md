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
| `designer__list_designs` / `get_design` / `save_design` / `delete_design` | `kind` = `sequence` (シーケンス図) / `view` (DB ビュー) / `viewDefinition` (ビュー定義) / `genericDefinition` (メッセージ・ドメイン型など 17 種)。汎用定義は `definitionKind` + `name`、ほかは `id` |
| `designer__get_conventions` / `save_conventions` | 規約 (`conventions.json`: ロール・権限・上限値・正規表現・DB 規約・メッセージ)。保存は**全体の置き換え** (先に読み、直した全体を渡す) |
| `designer__get_tech_stack` / `save_tech_stack` | 技術スタック (`harmony.json` の `techStack`。コード生成の指針)。保存は全体の置き換え |

- 保存は、画面へ変更を通知する (開いている画面が更新される)
- `save_design` は、`id` を引数の `id` に揃える (`design` の中の `id` と違っても引数が勝つ)
- id・名前に、パスをたどる文字は使えない (保存層の検査で断る)

## 取り込み (既定は予行)

| tool | 内容 |
|---|---|
| `designer__import_ddl` | DDL (`CREATE TABLE`。`pg_dump -s` / `mysqldump --no-data` の出力でもよい) → テーブル定義。画面の取り込みと同じ解釈 (`shared/src/importers/ddl.ts`) |
| `designer__import_openapi` | OpenAPI 3.x / swagger 2 → 処理フローの雛形 (操作ごとに 1 本。HTTP の経路・入力・出力・応答だけ。**工程は空**) |

- `apply: true` のときだけ保存する。同じ id がすでにあるものは、`overwrite: true` でなければ置き換えない (`keptExisting` に出る)
- 入力と書き込みの上限: DDL は 2 MiB、1 回に保存するのは 200 件まで (大きな入力・大量の書き込みで止まらないように)

## 探す・部分で読む・言葉で読む (読み取り専用)

| tool | 内容 |
|---|---|
| `designer__search_design` | 設計全体の本文検索 (画面の検索と同じ)。名前・id で探すのは `list_*` |
| `designer__list_steps` | 処理フローの工程の一覧 (番号・id・種類・要点・対象・備考・入れ子の深さ)。丸ごと読まずに構造をつかむ |
| `designer__get_step` | 1 工程の原本 + 親の経路 (どの分岐の道・繰り返しの中か) + 実行条件 (`runIf`) の言葉 |
| `designer__get_flow_story` | 処理フローを「流れ」の文章 (Markdown) で返す。条件は言葉 (『store が ない のとき』)。画面の「流れ」・設計書と同じ読み方 ([process-flow-story-view.md](process-flow-story-view.md)) |
| `designer__analyze_branches` | 分岐の判定表 (条件 × 道の ○ × －) と指摘 (隠れる道・同時に成り立つ道・どの道にも入らない組み合わせ)。分岐は上から順に調べ、最初に成り立った道だけを実行する ([process-flow-runtime-conventions.md](process-flow-runtime-conventions.md) §11.5) |
| `designer__get_design_document` | 設計書の目次と、章ごとの本文。章を指定すると、読みやすい文章 (`format: text`) か HTML。1 回の本文は 60,000 文字まで |

処理フローの画面で開いて未保存の内容があるときは、その内容を読む (`get_process_flow` と同じ)。

## 検証だけ・変更の差分・比較 (読み取り専用)

| tool | 内容 |
|---|---|
| `designer__validate_design` | **保存せずに**、JSON が合うかを確かめる。`processFlow` / `screen` / `table` はスキーマ、`report` / `businessFlow` は検証。作ってから保存する前の確認に使う (`dryRun` を各 `save_*` に付ける代わり) |
| `designer__get_changes_since` | ある時刻より後に変わった設計ファイル (種類・id・更新時刻)。人が画面で直した分を知る。`since` は ISO の日時 (省略すると直近 24 時間)。`.` で始まるフォルダ (`.harmony-backups` など) は含めない。200 件まで |
| `designer__compare_workspaces` | いまのワークスペースと、**登録済み**の別のワークスペース (id またはパス) を、種類ごとに id で比べる。登録されていないパスは読まない |

## 判断した点・限界

- **tool を種類ごとに増やさず、`kind` で 1 組にした** (シーケンス・ビュー・ビュー定義・汎用定義)。tool の説明は毎回 AI の文脈に載るため。画面・処理フロー・テーブル・帳票・業務フロー・ページレイアウトの既存の tool は、そのまま
- `remove_*` と `delete_*` の混在は、名前を変えない (既存の呼び出し・スキル・資料が広く使っている)。新しい tool は `delete_*` に揃えた
- 各 `save_*` / `update_*` への `dryRun` 引数と、更新の応答に「影響を受ける設計」を添えることは、していない。代わりに `validate_design` (保存前の確認) と `find_references` (影響) を使う
- 処理フローの雛形づくり (`scaffold_process_flow`) は、tool にしない。手順は Prompt `create-flow` が持ち、HTTP の骨組みは `import_openapi` が作る
- `get_changes_since` は、ファイルの更新時刻で見る (誰が変えたかは分からない。誰が・なぜは「設計のあゆみ」)
