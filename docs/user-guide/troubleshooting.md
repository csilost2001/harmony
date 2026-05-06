# トラブルシューティング

よくある詰まりと回避策。issue 報告の前にまず確認。

## 起動・接続

### ブラウザで処理フローが見えない (一覧が空)

- active workspace の `project.json` に `processFlows[]` があるか確認 (workspace 配置は #753 で `data/` から `workspaces/<id>/` または任意フォルダに変更)
- backend (ws://localhost:5179) が起動しているか: `netstat -ano | grep :5179`
- ブラウザ DevTools Console で `[mcpBridge] connected` ログがあるか
- localStorage が古い可能性: Application タブから `flow-project` を削除して reload

### dev server が起動しない

- ポート 5173 が占有されていないか (`netstat -ano | grep :5173`)
- `cd frontend && npm install` で依存解決済みか
- `vite.config.ts` で `strictPort: true` にしているので、5173 が使えないと起動失敗

### backend が多重起動

`.mcp.json` に登録済みのため、Claude Code 起動ごとに新インスタンスが spawn される可能性あり。`wsBridge.start()` で古いプロセスの終了を待つロジックがあるが、うまくいかなければ手動 kill:

```bash
netstat -ano | grep :5179  # PID 特定
taskkill /F /PID <PID>     # Windows
# kill -9 <PID>            # mac/linux
```

## マーカーと /designer-work

### MarkerPanel に保存した marker が消える

- ProcessFlow の保存 (Ctrl+S / 保存ボタン) を実行したか
- wsBridge 接続が切れていると localStorage にしか残らない
- 保存したのに次回表示で消える → data/ フォルダの書込み権限を確認

### /designer-work 実行で「designer__list_markers is not a function」

- backend が Claude Code のセッションから見えていない
- `.mcp.json` が正しく読まれているか (プロジェクトルートで `claude` を起動したか)
- backend のビルドエラーがないか: `cd backend && npm run build`

### marker の編集対象 step を間違えて指定した

- MarkerPanel の削除ボタンで消してから新規作成
- または resolve して resolution に「間違いだった」と書く → `/designer-work` は既解決を無視

### 「全て AI に依頼」で警告が起票されない

- 警告の `path` フィールドがない (構造エラー系は除外される、warning のみ)
- 既に同じ code+path の marker が未解決で存在 → 重複ガードで skip

## バリデータ関連

### 意図せず未解決警告が増えた

- 新規追加した step や catalog が参照整合性違反を起こしている
- 警告詳細パネルで code と path を確認
- よくあるパターン:
  - `UNKNOWN_RESPONSE_REF`: ReturnStep.responseRef が action.responses[].id にない → responses に追加 or 別値に変更
  - `UNKNOWN_IDENTIFIER`: `@xxx` が inputs/outputBinding/ambient にない → ambient 宣言 or 変数作成
  - `UNKNOWN_SECRET_REF`: `@secret.xxx` が secretsCatalog にない → カタログ追加
  - `UNKNOWN_COLUMN`: SQL の列がテーブル定義にない → テーブル or SQL を修正

### 警告が消えない

- ブラウザが localStorage の古いデータを見ている可能性 → reload
- ProcessFlowEditor が再計算していない → 保存して reload

## データ周り

### workspace フォルダが gitignored なのでバックアップ方法は?

- 設計上 `data/` はデザイナー本体組み込み拡張定義 (`data/extensions/`) 専用、ユーザープロジェクトは `workspaces/<id>/` または任意フォルダに配置 (#753)。正本サンプルは `examples/<project-id>/` (git tracked)
- 実データは wsBridge 経由で active workspace 配下に保存されるため、active workspace ディレクトリ全体をコピーすればバックアップ
- backend を停止してから workspace ディレクトリをコピー推奨

### project.json と処理フローファイルが整合しない

- project.json: 一覧表示用の軽量メタ
- active workspace の `actions/*.json`: 実体 (#393-#395 で旧 `process-flows/` から `actions/` にリネーム済)
- どちらかだけ編集した場合、不整合で「処理フローが見つかりません」等のエラーに
- 復旧: project.json に該当 ID があるか、active workspace の `actions/<ID>.json` が存在するか、両方確認

## Playwright E2E

### `page.click` が timeout する

- React の onClick が発火していない可能性。force: true より `page.evaluate(() => element.dispatchEvent(...))` の方が確実な場合あり
- `.action-validation-panel` のように scroll 内部の要素で pointer events がクリップされる → `dispatchEvent` 推奨

### Playwright MCP で `--headless=false` が効かない (Windows)

- 仕様。Windows では `--headless=false` の使用は避ける。`mcp.headed` 等別フラグ参照
