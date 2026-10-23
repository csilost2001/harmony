---
description: "AI の作業別レシピ: やりたい作業ごとの tool の呼び順、工程の最小の例 (スキーマで検査済み)、よくある失敗の逆引き"
status: current
category: guide
---

# AI の作業別レシピ

[AI-INDEX.md](../AI-INDEX.md) の「やりたいこと → 資料・tool」を、**呼ぶ順番**にしたもの。tool の名前は `npm run check:docs` が実在を検査する。tool の詳細は `designer__get_tool_guide`、形は `harmony://schema/<種類>`。

## 0. どの作業でも

1. `designer__workspace_status` — ワークスペースが開いているか。開いていなければ `workspace_list` → `workspace_open`
2. `designer__get_project_context` — 設計の全体と、**未解決のマーカー (人からの指示・質問)**
3. 作業
4. `designer__check_design` — error / warning を 0 件にしてから報告する (要確認を黙らせるのは人。AI は黙らせない)

## 1. 新しい処理フローを作る

1. 近い例を探す: `examples/PATTERNS.md` (`harmony://docs/patterns`)。業務が近いサンプルの処理フローを `get_process_flow` で読む
2. Prompt `create-flow` の手順に従う (self-check ルールの一覧: [process-flow-pitfalls.md](process-flow-pitfalls.md))
3. `add_process_flow` → `add_action`(入口ごと)→ 工程を**まとめて**入れる: `edit_steps` (まず予行で結果を見て、`apply: true` で保存)
4. 保存前に確かめたいときは `validate_design` (保存しない)
5. `get_flow_story` で、条件を言葉にした文章として読み返す。分岐は `analyze_branches` で、隠れる道・どの道にも入らない組み合わせを確かめる
6. `check_design`

OpenAPI があるなら、`import_openapi` (予行 → `apply: true`) で HTTP の骨組み (経路・入出力・応答) を作り、工程を足す。

工程の最小の例 (スキーマで検査される。形の一覧は [process-flow-step-kinds.md](process-flow-step-kinds.md)):

<!-- schema: process-flow#/$defs/Step -->
```json
{ "id": "step-01", "kind": "compute", "description": "合計金額を求める", "expression": "@inputs.quantity * @inputs.unitPrice" }
```

<!-- schema: process-flow#/$defs/Step -->
```json
{ "id": "step-02", "kind": "validation", "description": "入力を確かめる", "fieldErrorsVar": "fieldErrors", "rules": [{ "field": "quantity", "type": "range", "message": "1 以上で入力してください" }] }
```

## 2. 既存の処理フローを直す

1. `get_flow_story` — 全体を文章で読む(短い)
2. `list_steps` — 番号と id。大きいときは `limit` / `offset`
3. `get_step` — 直す工程の原本と、親の経路
4. `edit_steps` — 複数の直しは 1 回で (全部成功か何も保存しない)。画面で開かれていると断られる — そのときは `update_step` など(画面に適用され、保存で確定する)
5. 条件を直したら `analyze_branches`。通る道を確かめるなら `walk_flow` (`choices` に選ぶ道を並べる)。最後に `check_design` (指摘の `hint` に直し方)

## 3. テーブルを作る

- DDL があるなら `import_ddl` (予行 → `apply: true`。大きいときは `ids` で選ぶ)
- なければ `add_table` → `update_table`(カラム・インデックス・制約)。規約の命名は `get_conventions`
- `generate_ddl` / `generate_er_mermaid` で確かめ、`check_design`

## 4. 画面を作る・直す

1. `list_screens` / `get_screen_layout`(部品の木)。部品は `list_layout_components`
2. `add_screen` → `set_screen_layout`。画面項目の名前は規約に合わせる (`rename_screen_item`、確認は `check_screen_item_refs`)
3. 画面項目と処理フローの結びつきは [screen-items.md](screen-items.md)

## 5. 名前を変える・付け替える

`find_references` で参照元を確かめる → `rename_entity` (既定は予行。`apply: true` で実行) / `replace_references`。取り消しは `undo_rename` / `undo_replace_references`。

## 6. 人の指示・質問に答える

`find_all_markers` で未解決を読む → 対応する → `resolve_marker`。新しい質問は `add_marker`。

## 7. レビューする

Prompt `review-flow`。指摘は `add_review_findings` (位置つきのコメント)。

## 8. コードを生成する

1. `get_generation_brief` — 処理フロー / 画面ごとに、流れ・使うテーブル・規約の値・テスト観点が 1 つの文書になる
2. Prompt `generate-code` で生成 → `record_generation` (テストのファイルはパスに `test` か `spec`)
3. テストは `get_test_viewpoints` と Prompt `generate-tests`。テストの名前に観点の ID を書く → `check_test_coverage` で覆い方を確かめる
4. 設計が変わったら、再生成の前に `check_generation_drift` / `get_regeneration_diff`。変更の影響を受ける観点だけは `get_test_viewpoints` の `since`
5. CI・コミット前: `npm run check:generation -- <ワークスペース> --coverage --min 80`

## 9. 詰まったとき

資料・スキーマ・tool の説明で詰まったら、作業を止めずに `report_confusion` で短く残す (`topic` と、関係する `tool` / `doc`)。利用者が集計して、説明や資料の改善に使う。

## 逆引き: よくある失敗

| 起きたこと | 原因と直し方 |
|---|---|
| 「この処理フローは画面で開かれています」 | `edit_steps` は保存済みのファイルだけが対象。画面で保存して閉じるか、`update_step` など 1 工程ずつの tool を使う |
| 「工程の id が重複します」 | `patch` / `detail` の中の入れ子の工程が、既存の id を使っている。`list_steps` で id を確かめ、別の id にする |
| `edit_steps` を呼んだのに、変わらない | 既定は予行。保存するには `apply: true` |
| 「プロファイルでは使えません」 | 接続の `?profile=` で絞られている。URL から外すか、`get_tool_guide` で、その tool がどのプロファイルにあるかを見る |
| 「読み取り専用」で断られた | `HARMONY_MCP_MODE=readonly` かプロファイル `read` / `review`。書き込みは利用者に設定を変えてもらう |
| id の形で断られた | 処理フロー・画面・テーブルなどの id は、英小文字で始まる kebab-case (`order-confirm`)。大文字・日本語・`_`・UUID の形は使えない。工程・アクションの id は `step-03` `act-001` の形 |
| 保存したのに画面に出ない | `check_design` の要確認と、`get_changes_since` で保存されたことを確かめる。画面は保存の通知で更新される |
| スキーマの項目が足りず、業務を表せない | スキーマは設計者の専権。拡張 (`extensions/`) か既存の項目で表す。それでも無理なら ISSUE を起票して止まる ([0004](../decisions/0004-schema-designer-only.md)) |
| 条件が複数成り立つ | 分岐は上から順・最初に成り立った道だけ ([0001](../decisions/0001-branch-first-match.md))。`analyze_branches` で重なりを見る |
