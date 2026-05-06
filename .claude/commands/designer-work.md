---
description: designer 画面で付けられたマーカー (指示・質問・TODO・チャット) を読み取り、ProcessFlow を編集して解決する
argument-hint: <processFlowId> [--dry-run]
---

<!--
  使い方:
    - designer を開き、対象 ProcessFlow でマーカーを複数付ける
      (MarkerPanel で「AI へのマーカー」に追加、または step カードの付箋)
    - Claude Code で `/designer-work <processFlowId>` を実行
    - Claude Code は MCP 経由で markers を読み、順に対応し、
      ProcessFlow を編集 (step/catalog) し、marker を resolve する
    - 人間は browser でリアルタイム更新を観察、追加の markers で指示を出す

  目的:
    - 上流 → 下流 の詳細化を「人間は概要を書き、AI が詳細を埋める」で回す
    - 人間は画面を見て指示、AI は構造化された markers で受け取り構造化された編集で返す
    - API 課金なし (Claude Code Max プラン内で完結)

  前提:
    - backend サーバが起動していること (HTTP で Claude Code に接続済み、`curl http://localhost:5179/` で health 確認可能)
    - 対象 ProcessFlow の ID を把握していること (URL の /process-flow/edit/{id})
-->

ProcessFlow `$ARGUMENTS` の未解決マーカーを処理します。

## 実行手順

### 1. 受信と確認

- `designer__list_markers` を呼び、未解決マーカー一覧を取得する (unresolvedOnly: true、既定)
- `designer__get_process_flow` で現在の ProcessFlow 全体を取得し、コンテキストを把握する
- 必要に応じて関連テーブル定義 (`designer__get_table`) や規約カタログ
  (`examples/<project-id>/conventions/catalog.json`) を参照する
- マーカー件数と種別 (chat/attention/todo/question) の要約を**まず人間に報告**する

### 2. 1 件ずつ対応

**各 marker 処理の直前に `designer__list_markers` を呼び直す** (人間が並行して追加していないか + 他 marker 処理で依存カタログが既に追加されていないか確認)。

#### kind 別ハンドリング (重要)

| kind | 想定意図 | 既定の対応 |
|------|---------|-----------|
| `todo` | 作業指示 (命令形) | 構造的に解決して resolve |
| `question` | 回答を求める | 分析結果を `add_marker(kind="chat", author="ai")` で返信 + 元を resolve (resolution に回答) |
| `attention` | 注意喚起・レビュー依頼 | **編集しない**が既定。resolution に分析・推奨を書いて resolve (committed 編集の命令と解釈しない) |
| `chat` | 雑談・確認 | `add_marker(kind="chat", author="ai")` で返信 + 元を resolve |

#### 編集許可の境界 (committed 保護)

ProcessFlow / action / step の `maturity` が `committed` の場合、**編集は以下の全てを満たす場合のみ**:
- kind = `todo` (質問や注意喚起では編集しない)
- body が命令形 (「追加して / 修正して / 削除して / 置換して」など)
- 編集範囲が body で明示されている (対象 step/field が特定できる)

上記を満たさない committed への編集提案は `resolution` に「提案: X を推奨、承認待ち」と書いて resolve のみ、実編集はしない。

#### 参照整合性の事前チェック

catalog エントリ追加や step 編集で以下を参照する場合、対象が存在するか先に確認する:
- `responseRef` → action.responses[].id
- `tableId` → designer__list_tables / get_table
- `typeRef` → `data/extensions/response-types.json` の responseTypes キー
- `systemRef` → ProcessFlow.externalSystemCatalog キー
- `@secret.*` → ProcessFlow.secretsCatalog キー
- `@conv.*` → `examples/<project-id>/conventions/catalog.json` キー

**参照先が未定義なら、値から当該フィールドを省き、不足分を `add_marker(kind="attention")` で別起票**してから元を resolve する。ダングリング参照を新規作成しない。

#### 全置換系の扱い

`designer__update_process_flow` (definition 全置換) は**破壊的**。
- `--dry-run` 無しでは**人間承認を待つ**。
- 代わりに粒度 tool (`update_step` / `add_catalog_entry` 等) で済む経路を優先。
- どうしても全置換が必要なら: 変更 diff を marker の resolution 欄に先に書いて resolve せず保留、人間に判断を仰ぐ。

#### 処理手順まとめ

各 marker について:

1. **解析**: kind / body / stepId / fieldPath を把握。関連 step / catalog を get_process_flow から参照。
2. **kind + maturity で分岐**: 上記「kind 別ハンドリング」「committed 保護」に従って編集 or 保留を決定。
3. **参照整合性チェック**: 必要なら参照先を確認、未定義なら別 attention を起票。
4. **実行**: 粒度 MCP tool で編集 (broadcast → 画面自動更新)。
5. **resolve**: `designer__resolve_marker` で resolution を付けてクローズ。question/chat なら返信 chat marker を並行して追加。
6. **次へ**: `designer__list_markers` を再取得して次の marker へ。

### 3. 応答サマリ

全マーカー処理後、以下を人間向けに報告:
- 処理件数 (解決 / 質問返し / 提案保留 の内訳)
- 主な変更箇所 (step 編集、catalog 追加、maturity 昇格 等)
- 未解決のまま残した marker とその理由

## スコープとガードレール

- **ProcessFlow 以外は触らない**: screen / table 定義は読み取り専用扱い。修正が必要なら marker に "前提: テーブル定義の変更必要" と書いて保留
- **下流モード × committed 成熟度のステップは保守的に**: 既に確定済みの内容を勝手に書き換えない。marker.body が明示的に許可している場合のみ編集
- **@conv.* / @secret.* / @identifier の未定義参照は作らない**: 編集前に参照整合性を確認し、必要なら先にカタログへ追加してから step 参照
- **`--dry-run` 引数があれば**: 何を変更するか提案のみで、実際の `update_step` 等は呼ばない

## 想定外のケース

- **MCP サーバ未接続** (backend が起動していない): 人間に backend 起動を促す
- **processFlowId が見つからない**: list_process_flows で候補を提示
- **marker 0 件**: "現在未解決のマーカーはありません" と報告して終了
