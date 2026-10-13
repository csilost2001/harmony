# サーバのセキュリティ設定

backend (port 5179、MCP + WebSocket + HTTP) の、接続・要求・AI の権限の守り。既定は従来どおり (ローカルで自分だけが使う前提)。共有の環境・ポートを公開する環境では、以下の環境変数で絞る。

## すでにあるもの

- **Origin / Host の検査** (`security/originCheck.ts`): WebSocket・HTTP とも、許可した Origin (localhost の画面) と、loopback からの接続だけを通す (DNS rebinding・他サイトからの接続を防ぐ)。WSL2 / Docker の経路のため待ち受けは `0.0.0.0`
- **パスの検査** (`security/idValidator.ts`): id・名前・種類・履歴 ID を、パスに使う前に検査。保存層でも `assertPathContained`。ランダム入力のテスト (`security/pathFuzz.test.ts`) で、ワークスペースの外に触れないことを見張る
- **ログのマスク** (`serverLog.ts`): API キー・Bearer・`?token=`・パスワード・接続トークンをログに残さない。保持は既定 7 日 (`DESIGNER_LOG_RETENTION_DAYS` で変更)
- **`/health`**: 稼働の確認 (loopback 以外には `{status:"ok"}` だけ)

## 接続トークン (任意)

`HARMONY_AUTH_TOKEN=<文字列>` を付けて backend を起動すると、トークンを持たない接続を拒否する (HTTP は 401、WebSocket は close 1008 `Unauthorized`)。未設定なら認証なし。

- HTTP (MCP など): `Authorization: Bearer <トークン>` (`.mcp.json` の `headers` に書く)
- WebSocket (画面): 接続 URL の `?token=<トークン>`。画面は、拒否されると**トークンを聞く**入力を出し、このブラウザの localStorage (`harmony.authToken`) にだけ保存する (設計データ・サーバには送らない)
- `/health` と画面の静的ファイル (`HARMONY_STATIC_DIR`) は、トークンなしで見える (画面を開くため)。設計データ・MCP・WebSocket は、トークンが要る
- 比較は、時間で推測されない方法 (`timingSafeEqual`)

## 要求の上限

| 設定 | 既定 | 内容 |
|---|---|---|
| `HARMONY_MAX_WS_PAYLOAD_BYTES` | 32 MiB | WebSocket の 1 メッセージ。超えると接続を切る (ws の `maxPayload`) |
| `HARMONY_MAX_HTTP_BODY_BYTES` | 8 MiB | HTTP の 1 リクエストの本文 (`Content-Length` が超えれば 413)。MCP の SDK は別に 4 MB で打ち切る |
| `HARMONY_MAX_WS_REQUESTS_PER_10S` | 3000 | 1 つの接続が 10 秒間に出せる要求の数。超えた要求は「要求が多すぎます」で断る (単一スレッドの backend が占有されないように) |

不正な値 (正の整数でない) は、既定に戻る。

## AI (MCP) の権限

| 設定 | 内容 |
|---|---|
| `HARMONY_MCP_MODE=readonly` | 読み取りの tool だけを使える (設計を読む・点検する用途)。書き込み・削除・改名・保存・編集セッションの作成はできない。tools/list にも出ない。`designer__workspace_open` は通る (新規作成の `init: true` を除く) |
| `HARMONY_MCP_DENY=a,b` | 使わせない tool の名前 (`designer__` は省略できる。例: `remove_table,rename_entity`) |

読み取りの tool は、名前の規則 (`list_` / `get_` / `find_` / `check_` / `generate_` / `export_`) と明示した例外で決める (`security/mcpAccess.ts`)。新しい tool を足したとき、読み取り扱いになる一覧はテスト (`hardening.test.ts`) で固定してあり、意図せず書き込みの tool が読み取り扱いにならないよう、足すときに中身を確かめる。

## 限界 (正直に)

- 通信は暗号化しない (`ws://` / `http://`)。公開するなら、前段にリバースプロキシ (TLS) を置く
- 接続トークンは 1 つの共通の値。利用者ごとの権限・監査はない ([ロードマップ] 第 5 弾)
- 待ち受けは `0.0.0.0` のまま (WSL2 の経路のため)。外に公開しない環境では、ファイアウォール・コンテナの公開ポートの設定で絞る
