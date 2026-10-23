---
description: "サーバの守り (Origin・パス・ログのマスク、接続トークン、要求の上限、MCP の権限)"
status: current
category: ops
---

# サーバのセキュリティ設定

backend (port 5179、MCP + WebSocket + HTTP) の、接続・要求・AI の権限の守り。既定は従来どおり (ローカルで自分だけが使う前提)。共有の環境・ポートを公開する環境では、以下の環境変数で絞る。

## すでにあるもの

- **Origin / Host の検査** (`security/originCheck.ts`): WebSocket・HTTP とも、許可した Origin (localhost の画面) と、loopback からの接続だけを通す (DNS rebinding・他サイトからの接続を防ぐ)。WSL2 / Docker の経路のため待ち受けは `0.0.0.0`
- **パスの検査** (`security/idValidator.ts`): id・名前・種類・履歴 ID を、パスに使う前に検査。保存層でも `assertPathContained`。ランダム入力のテスト (`security/pathFuzz.test.ts`) で、ワークスペースの外に触れないことを見張る
- **ログのマスク** (`serverLog.ts`): API キー・Bearer・`?token=`・パスワード・接続トークンをログに残さない。保持は既定 7 日 (`DESIGNER_LOG_RETENTION_DAYS` で変更)
- **`/health`**: 稼働の確認 (loopback 以外には `{status:"ok"}` だけ)

## 接続トークン (任意)

`HARMONY_AUTH_TOKEN=<文字列>` を付けて backend を起動すると、トークンを持たない接続を拒否する (HTTP は 401、WebSocket は close 1008 `Unauthorized`)。未設定なら認証なし。

- HTTP (MCP など): `Authorization: Bearer <トークン>` (`.mcp.json` の `headers` に書く)。HTTP は `?token=` を**受けない** (URL がログ・履歴に残りやすいため)
- WebSocket (画面): 接続 URL の `?token=<トークン>` (ブラウザの WebSocket はヘッダーを付けられないため、ここだけ受ける)。画面は、拒否されると**トークンを聞く**入力を出し、このブラウザの localStorage (`harmony.authToken`) にだけ保存する (設計データ・サーバには送らない)
- `/health` と画面の静的ファイル (`HARMONY_STATIC_DIR`) は、トークンなしで見える (画面を開くため)。設計データ・MCP・WebSocket は、トークンが要る
- 比較は、時間で推測されない方法 (`timingSafeEqual`)
- **総当たりへの対策**: 同じ送信元から、違うトークンが 5 回 (60 秒の窓) を超えて続くと、その送信元への**失敗の応答**を倍々で遅くする (最大 5 秒)。**締め出さない** (リバースプロキシ・Docker のポート転送の背後では、全利用者が同じ送信元に見えるため、締め出すと、違うトークンを送るだけで、正しいトークンを持つ全員を断てる)。正しいトークンの要求は遅らせない。トークンが無い要求 (画面を開いただけ) は数えない。トークンは、推測できない長さ (32 文字以上の乱数) にする (短いと、起動時に警告を出す)。遅らせるのは「単純な総当たりを遅くする」ためで、並列の接続では効かない。強さの元は、トークンの長さ

## 要求の上限

| 設定 | 既定 | 内容 |
|---|---|---|
| `HARMONY_MAX_WS_PAYLOAD_BYTES` | 32 MiB | WebSocket の 1 メッセージ。超えると接続を切る (ws の `maxPayload`) |
| `HARMONY_MAX_HTTP_BODY_BYTES` | 8 MiB | HTTP の 1 リクエストの本文。`Content-Length` が超えれば 413。chunked 転送 (Content-Length なし) は、本文を読みながら数えて打ち切る (`readLimitedBody`。AI 命名のルートで使用)。MCP の SDK は別に 4 MB で打ち切る |
| `HARMONY_MAX_WS_REQUESTS_PER_10S` | 3000 | 1 つの接続が 10 秒間に出せる要求の数。超えた要求は「要求が多すぎます」で断る (単一スレッドの backend が占有されないように) |

不正な値 (正の整数でない) は、既定に戻る。

## AI (MCP) の権限

| 設定 | 内容 |
|---|---|
| `HARMONY_MCP_MODE=readonly` | 読み取りの tool だけを使える (設計を読む・点検する用途)。書き込み・削除・改名・保存・編集セッションの作成はできない。tools/list にも出ない。`designer__workspace_open` は通る (新規作成の `init: true` を除く) |
| `HARMONY_MCP_DENY=a,b` | 使わせない tool の名前 (`designer__` は省略できる。例: `remove_table,rename_entity`) |

読み取りの tool は、**許可リスト** (`security/mcpAccess.ts` の `READ_ONLY_TOOLS`) で決める。名前の規則では決めない (将来 `get_` で始まる書き込みの tool が増えても、読み取り専用の環境で通ってしまわないように、足すときに 1 件ずつ中身を確かめて足す)。リストに無い tool は、読み取り専用では使えない。リストはテスト (`hardening.test.ts`) でも固定している。

| 設定 | 内容 |
|---|---|
| `HARMONY_MCP_PROFILE` | AI に見せる tool の絞り込み (下の節。権限ではない) |
| `HARMONY_DOCS_DIR` | Resources / Prompts が資料 (`docs/spec`・`schemas/v3`・`ai-skills`) を探す場所。既定はリポジトリの根。見つからなければ警告を出して既定へ戻る |

## AI に見せる tool の絞り込み (プロファイル)

tool は 100 個を超え (140 個、`tools/list` の応答で約 90KB)、説明が毎回 AI の文脈に載る。作業の種類に合う tool だけを見せると、AI は選び間違えにくく、読む量も減る。**権限の仕組みではない** (権限は上の `HARMONY_MCP_MODE` / `HARMONY_MCP_DENY`。両方が掛かる)。

| 指定 | 見える tool | 数 (KB) | `detail=brief` の KB |
|---|---|---|---|
| 未指定 / `full` | すべて | 140 (90) | 57 |
| `flow` | 処理フローを作る・直す (+ 画面・テーブルを読む) | 73 (52) | 31 |
| `table` | テーブルを作る・直す (DDL・ER・テストデータ) | 58 (40) | 24 |
| `screen` | 画面・画面項目・ページレイアウト (+ 処理フロー・テーブルを読む) | 73 (48) | 29 |
| `doc` | 業務フロー・帳票・シーケンス・ビュー・汎用定義・規約・技術スタック・拡張を作る・直す | 78 (49) | 31 |
| `maint` | 保守 (一括保存・版の復旧・登録簿の修復・スキーマ移行・パック・ワークスペースの削除) | 42 (30) | 17 |
| `review` | 読み取り + レビューの指摘・コメント・マーカー | 69 (39) | 25 |
| `read` | 読み取りだけ (書き込みの tool とマーカーの書き込みは出ない。`workspace_open` の `init: true` も断る) | 65 (35) | 23 |

- 指定の方法: 接続の URL `http://localhost:5179/mcp?profile=flow`(カンマで複数: `?profile=flow,table` は和集合)、または環境変数 `HARMONY_MCP_PROFILE`。URL が優先
- `flow` `table` `screen` `doc` には、設計を直す共通の操作 (生成の記録 `record_generation`・改名・参照の付け替え・版を戻す) も入る。**すべての tool は、どれかのプロファイルに入る** (試験が見張る)
- `read` / `review` だけの接続は、`workspace_open` の `init: true` (フォルダと `harmony.json` の新規作成) も断る
- 空の `?profile=` は未指定として扱う (環境変数 `HARMONY_MCP_PROFILE` を使う)。環境変数に知らない名前を入れると、全接続が 400 になる
- どのプロファイルにも入る土台: ワークスペースの操作・`get_project_context`・`check_design`・`analyze_design`・`find_references`・マーカーを読む・版の一覧・タブの操作 (`read` 以外は、マーカーの書き込みも)
- 絞った接続は、一覧に出ない tool を呼んでも断る (名前を知っていても使えない。AI と利用者が、見えているものを同じにするため)。知らないプロファイル名は、接続を 400 で断る
- KB は 2026-10-24 の実測 (`tools/list` の応答の、UTF-8 のバイト数。日本語は 1 文字 3 バイトなので、文脈に載る量の目安になる。注釈を含む)。tool が増えれば変わる。規則 (`security/mcpProfiles.ts`) の各行がいまの tool に当たっていること、`read` に書き込みの tool がないことは、試験 (`mcpServer.test.ts`) が見張る

## tool の説明を短くする (`detail=brief`) と、注釈

- **`?detail=brief`** (または環境変数 `HARMONY_MCP_DETAIL=brief`。URL が優先): `tools/list` の説明を最初の 1 文にし、引数の説明 (`description`) を省く。型・必須・列挙・注釈は残る。ただし、保存の既定が予行の tool の `apply` と、使い方が説明にしかない `edits` の説明は残し、説明に「既定は予行」を足す。説明の最初の 1 文は、括弧の中の「。」では切らない。**全 tool で約 4 割減 (90KB → 57KB)**。詳しく知りたい tool は **`designer__get_tool_guide`** (`name` を指定。完全な説明・引数・注釈・入っているプロファイル。省略すると名前の一覧) で引く。`?profile=` と重ねられる (`?profile=flow&detail=brief`)。知らない値は 400
- **注釈** (`annotations`): 全 tool に付く。`readOnlyHint` (読み取り専用の許可リストと同じ。ただし、画面の表示・作業の状態を変える `open_tab` `close_tab` `switch_tab` `navigate_screen` `workspace_open` `workspace_close` は false — `init: true` の新規作成や `force: true` の破棄が、「読むだけは確認なしで許可」の環境で通らないように)・`destructiveHint` (足すだけの `add_*` などは false、上書き・削除は true)・`idempotentHint` (同じ引数で繰り返しても結果が変わらない `save_*` `update_*` `delete_*` など)・`openWorldHint: false`。AI の実行環境が、読むだけの tool を確認なしで許可するなどに使う。注釈が増える分 `tools/list` は約 11KB 大きくなる
- **エラーの直し方**: 失敗の文に `直し方: …` を添える (id の形・一覧で確かめる tool・ワークスペースの探し方・保存前の `validate_design`)。すでに案内のある文、設計の id と関係のない「見つかりません」(git・履歴・通知先など) には足さない
- `designer__get_tool_guide` は、`HARMONY_MCP_DENY` で拒否した tool・読み取り専用で使えない tool を、一覧にも詳細にも出さない

## AI が読む資料と手順 (Resources と Prompts)

tool とは別に、AI が自分で探して読めるようにする。**読み取り専用**。

- **接続時の案内** (`initialize` の `instructions`): 最初に `designer__get_project_context` を呼ぶこと、資料の入口、直したら `check_design` を 0 件にすること、schema は設計者の判断であること
- **`designer__get_project_context`** (読み取りの tool): 設計全体の要約。プロジェクト名・技術スタック・件数・種類ごとの設計の id と名前 (既定 60 件まで。`limit` で 500 まで)・規約の数・未解決のマーカー (人から AI への指示・質問、先頭 10 件)・次に使う tool と資料。工程やカラムの中身は載せない
- **Resources**: `harmony://project/context` (上と同じ。tool と同じ権限・プロファイルで守る — `HARMONY_MCP_DENY=get_project_context` なら読めない)・`harmony://docs/ai-index` ([AI-INDEX.md](../AI-INDEX.md))・`harmony://spec/index` (仕様書の索引 `docs/spec/index.json`)・`harmony://spec/<名前>` (仕様書)・`harmony://schema/index` と `harmony://schema/<種類>` (JSON Schema)。`resources/list` に全部が出る (約 117 件、仕様書は状態と要約つき)
- **Prompts**: 設計の作成・点検用のスキルだけ — `create-flow` `review-flow` `generate-code` `generate-tests` `import-md` `rename-screen-ids` `test-strategy`。リポジトリの開発用 (`issues` `review-pr` `publish-*` など) は出さない。引数は `arguments` に 1 本の文字列 (スキルの `$ARGUMENTS` に入る)
- **安全**: 読めるのは、ディレクトリの中身から作った許可リストにある名前だけ。URI の中の名前を、パスに直接使わない (`..` やパスの区切りは、断る)。資料が同梱されていない配置 (`HARMONY_DOCS_DIR` も見つからない) では、資料の一覧は `project/context` だけになる
- **資料の置き場**: リポジトリの根 (`docs/AI-INDEX.md`・`docs/spec`・`schemas/v3`・`ai-skills`)。配布 image では、Dockerfile がこれらを `/app` に同梱する。別の場所に置くなら `HARMONY_DOCS_DIR`

## 限界 (正直に)

- WebSocket の 1 メッセージが上限を超えると、接続が切れる (close 1009)。画面は再接続するが、そのとき超えた内容を保存できていない (20 MB を超える設計 JSON は、健全性の検査でも「大きすぎる」と知らせる)。上限は `HARMONY_MAX_WS_PAYLOAD_BYTES` で上げられる
- 通信は暗号化しない (`ws://` / `http://`)。公開するなら、前段にリバースプロキシ (TLS) を置く
- 接続トークンは 1 つの共通の値。利用者ごとの権限・監査はない ([ロードマップ] 第 5 弾)
- 待ち受けは `0.0.0.0` のまま (WSL2 の経路のため)。外に公開しない環境では、ファイアウォール・コンテナの公開ポートの設定で絞る
