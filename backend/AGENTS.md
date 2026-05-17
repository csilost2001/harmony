# AGENTS.md — Backend

MCP サーバ + WebSocket ブリッジ。ブラウザと AI コーディングエージェントの双方からファイル操作を受け付ける常駐サーバ。プロジェクト全般のルールは上位の [../AGENTS.md](../AGENTS.md) を参照。

## Commands

```bash
npm install
npm run dev        # Watch mode (tsx)
npm run build      # Compile to dist/
```

常駐サーバ (#302): `npm run dev` で 1 回起動すれば、ブラウザ・複数の AI エージェントセッション双方が接続できる。エージェント終了でも停止しないので、次回以降も使い回し可能。

## Key Files

- `src/tools.ts` — 89 MCP tool definitions (実カウント: `grep -cE 'name:\s*"designer__' src/tools.ts`、2026-05-17 時点)
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

### バグ報告フロー

ユーザーから不具合報告を受ける際は、以下 2 点をセットで取得すると AI が後追い調査できる:

1. **クライアント側**: ブラウザ DevTools コンソールで `__uiLogDump()` を実行 → JSON 出力をコピペ
2. **サーバ側**: `logs/harmony-mcp-YYYY-MM-DD.log` の末尾 100 行をコピペ

両ログを ISO 時刻で突き合わせて、UI redirect → WS request → handler 例外 の因果連鎖を特定可能なレベルを目指している。

### ログ保持

- 起動時に 7 日以上前のログを自動削除 (retention rotation)
- ログサイズ上限なし (1 日 1 ファイル運用前提)
- gitignore 済 (`logs/`)

## Testing

- MCP E2E: `../frontend/e2e/mcp/**/*.spec.ts` — wsBridge ファイル操作（本サーバの起動が必要）
