# backend

GrapesJSデザイナー + 処理フロー編集を Claude Code から MCP 経由で直接操作するための常駐 MCP サーバー。

## アーキテクチャ (#302 以降)

```
Claude Code (MCP client) ──(HTTP /mcp)──┐
                                        ▼
                                backend ←──(WebSocket)──→ Browser Designer
                                        ▼
                                    data/ folder
```

- **HTTP MCP endpoint**: port 5179 `/mcp` (Streamable HTTP、Claude Code 複数セッション同時接続可)
- **WebSocket**: 同 port 5179 でブラウザ側 wsBridge と通信 (ファイル保存・リアルタイム同期)
- **常駐型**: `npm run dev` で 1 回起動すれば、Claude Code 終了後も動作継続

## 主要 MCP ツール (29 個)

### キャンバス操作 (GrapesJS 画面編集)
- `designer__get_html` / `designer__set_components` / `designer__screenshot`
- `designer__list_blocks` / `designer__add_block` / `designer__update_element`

### 処理フロー編集 (ProcessFlow)
- `designer__list_process_flows` / `designer__get_process_flow`
- `designer__update_step` / `designer__set_maturity` / `designer__add_step_note`
- `designer__list_markers` / `designer__add_marker` / `designer__resolve_marker`
- `designer__find_all_markers` (全 ProcessFlow 横断、#296)

### その他
- Screen/Flow 操作、Table/ER 編集、Custom Blocks、DDL 生成、etc.

## セットアップ

### 1. 依存インストール + ビルド

```bash
cd backend
npm install
npm run build
```

### 2. 常駐起動

```bash
cd backend
npm run dev    # tsx watch mode、コード変更時に自動再起動
```

port 5179 で HTTP + WebSocket を listen 開始。Ctrl+C で終了。

### 3. `.mcp.json` (既に登録済)

```json
{
  "mcpServers": {
    "backend": {
      "type": "http",
      "url": "http://localhost:5179/mcp"
    }
  }
}
```

Claude Code をプロジェクト内で起動すると自動接続。backend が起動していない場合は接続失敗するので、先に上記を起動しておく。

## 使い方

1. designer 起動: `cd frontend && npm run dev` → http://localhost:5173 を開く
2. backend 起動: `cd backend && npm run dev`
3. Claude Code をプロジェクト内で起動 → `.mcp.json` 経由で自動接続
4. `/designer-work <processFlowId>` 等で AI に編集指示を出す

### 使用例

```
「現在のキャンバスのHTMLを取得して」
→ designer__get_html が呼ばれてHTML/CSSが返る

「シンプルなログインフォームに置き換えて」
→ designer__set_components でデザイナーが更新される

「現在の画面をスクリーンショットして」
→ designer__screenshot で画像が返る
```

## トラブルシューティング

### MCP 接続失敗 / Claude Code 側で FAIL 表示

- backend が起動しているか確認: `curl http://localhost:5179/` → `{"status":"ok",...}` が返れば OK
- 起動していなければ `cd backend && npm run dev`
- port 5179 が別プロセス (古い orphan 等) で占有されていないか: `netstat -ano | findstr 5179`
- 占有されていれば `taskkill /F /PID <番号>` (Windows) / `kill -9 <番号>` (mac/Linux)

### 「デザイナーが開かれていません」エラー

- http://localhost:5173 をブラウザで開く (designer frontend 起動)
- WebSocket 接続確認: ブラウザ DevTools Console で `mcpBridge` のログ確認

### port 設定の変更 (テスト等)

`DESIGNER_MCP_PORT` 環境変数で port 上書き可能:

```bash
DESIGNER_MCP_PORT=5200 npm run dev
```

### ビルドエラー

```bash
npm run build
```

## テスト

- `npx vitest run` — unit tests (processFlowEdits、etc.) + HTTP transport integration test
- HTTP transport test は port 5201 で server を spawn するため、**手動起動中の backend と並行して走らせても OK** (port 競合しない)
