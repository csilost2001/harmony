# AGENTS.md — Backend

MCP サーバ + WebSocket ブリッジ。ブラウザと AI コーディングエージェントの双方からファイル操作を受け付ける常駐サーバ。プロジェクト全般のルールは上位の [../AGENTS.md](../AGENTS.md) を参照。

## Commands

```bash
# Install は repo root で 1 回 (npm workspaces、PR #1378 で導入)
# subdir 単独 install は workspace 認識されず非推奨
# cd <repo-root> && npm install

# Backend dev は root から workspace script で (#1400)
# (subdir に cd して `npm run dev` でも等価)
npm run backend            # root: Watch mode (tsx)
npm run restart:backend    # root: port 5179 を kill → 再起動

# Build は subdir で
cd backend
npm run build      # shared rebuild → Compile to dist/
```

常駐サーバ (#302): `npm run backend` で 1 回起動すれば、ブラウザ・複数の AI エージェントセッション双方が接続できる。エージェント終了でも停止しないので、次回以降も使い回し可能。

## Key Files

- `src/tools.ts` — MCP tool definitions (件数: `grep -cE 'name:\s*"designer__' src/tools.ts`)
- `src/mcpServer.ts` — MCP サーバの組み立て (tool の振り分け・Resources・Prompts・プロファイル。`index.ts` は起動だけ)
- `src/mcpKnowledge.ts` / `src/projectContext.ts` — Resources と Prompts / `designer__get_project_context`
- `src/wsBridge.ts` — WebSocket server + broadcast

## MCP / WebSocket

- **MCP (HTTP Streamable, port 5179):** AI エージェントは MCP 設定 (Claude Code は `.mcp.json`、Codex は `.codex/config.toml`) で HTTP URL エントリ経由接続。常駐サーバなので複数エージェントセッション同時接続可、orphan 問題も解消
- **WebSocket (port 5179):** Browser reads/writes screen data — MCP と同一 port に同居
- **Shared storage:** `workspaces/<wsId>/harmony.json` + `<wsId>/<dataDir>/screens/*.json` (active workspace)

**自動 spawn はしない** (URL mode): エージェント起動時に既存サーバが無いと MCP 不接続状態になるため、backend が上がっているか先に確認すること。

## 物理ログ (#751)

サーバ起動時に \`<projectRoot>/logs/harmony-mcp-YYYY-MM-DD.log\` (UTF-8 / JSON Lines) を作成し、すべてのサーバ側ログ + ブラウザから flush された UI ログ (\`client-*\` カテゴリ) を統合書き込みする。

### 環境変数

| env | 効果 | デフォルト |
|---|---|---|
| `DESIGNER_MCP_LOG_LEVEL` | 物理ログの最小レベル (`debug` / `info` / `warn` / `error`) | `info` |
| `DESIGNER_LOG_DIR` | 出力先ディレクトリ上書き (デフォルトは projectRoot/logs) | unset |
| `DESIGNER_LOG_RETENTION_DAYS` | ログの保持日数 (正の整数。不正な値は既定) | `7` |

### セキュリティ・上限の環境変数 (詳細: [../docs/spec/server-security.md](../docs/spec/server-security.md))

| env | 効果 | デフォルト |
|---|---|---|
| `HARMONY_AUTH_TOKEN` | 設定すると、トークンを持たない HTTP / WebSocket 接続を拒否 (`Authorization: Bearer` / `?token=`) | unset (認証なし) |
| `HARMONY_MCP_MODE` | `readonly` で、AI (MCP) は読み取りの tool だけ | `full` |
| `HARMONY_MCP_DENY` | 使わせない MCP tool の名前 (カンマ区切り。`designer__` は省略可) | unset |
| `HARMONY_MCP_PROFILE` | AI に見せる MCP tool の絞り込み (`flow` / `table` / `screen` / `doc` / `maint` / `review` / `read`、カンマで複数)。接続の URL の `?profile=` が優先。権限の設定ではない | unset (すべて) |
| `HARMONY_MCP_DETAIL` | `brief` で、tools/list の説明を最初の 1 文にし引数の説明を省く (約 4 割減。詳細は `designer__get_tool_guide`)。接続の URL の `?detail=brief` が優先 | unset (full) |
| `HARMONY_DOCS_DIR` | MCP の Resources / Prompts が資料 (`docs/spec`・`schemas/v3`・`ai-skills`) を探す場所 | リポジトリの根 |
| `HARMONY_WORKSPACES_DIR` | 画面でフォルダを選ぶとき、最初に見せる場所 (ワークスペースを自動で開く設定ではない) | `HARMONY_HOME` の 1 つ上、なければホーム |
| `HARMONY_ALLOWED_BROWSE_ROOTS` | 画面で選べるフォルダの範囲 (Linux / macOS はコロン、Windows はセミコロン区切り) | ホームのみ |
| `HARMONY_MAX_WS_PAYLOAD_BYTES` / `HARMONY_MAX_HTTP_BODY_BYTES` / `HARMONY_MAX_WS_REQUESTS_PER_10S` | WebSocket 1 メッセージ / HTTP 本文 / 1 接続の 10 秒あたりの要求数の上限 | 32 MiB / 8 MiB / 3000 |

### バグ報告フロー

ユーザーから不具合報告を受ける際は、以下 2 点をセットで取得すると AI が後追い調査できる:

1. **クライアント側**: ブラウザ DevTools コンソールで `__uiLogDump()` を実行 → JSON 出力をコピペ
2. **サーバ側**: `logs/harmony-mcp-YYYY-MM-DD.log` の末尾 100 行をコピペ

両ログを ISO 時刻で突き合わせて、UI redirect → WS request → handler 例外 の因果連鎖を特定可能なレベルを目指している。

### ログ保持

- 起動時に保持日数 (既定 7 日。`DESIGNER_LOG_RETENTION_DAYS`) より古いログを自動削除 (retention rotation)。シークレット (API キー・Bearer・`?token=`・パスワード・接続トークン) はマスクして書く
- ログサイズ上限なし (1 日 1 ファイル運用前提)
- gitignore 済 (`logs/`)

## Testing

- MCP E2E: `../frontend/e2e/mcp/**/*.spec.ts` — wsBridge ファイル操作（本サーバの起動が必要）
