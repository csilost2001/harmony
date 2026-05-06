# MCPサーバー Step 1 — 実装計画

> **対象実装者**: Claude Sonnet
> **想定工数**: 1〜1.5日
> **関連Issue**: (作成後にリンク)

---

## 1. 目的とゴール

業務システムデザイナー（GrapesJS + React）をClaude Code（MCPクライアント）から直接操作可能にする最小実装。

### ゴール（受け入れ条件）

- [ ] Claude Codeから以下3つのMCPツールが呼び出せる
  - `designer__get_html` — 現在キャンバスのHTML+CSSを取得
  - `designer__set_components` — キャンバスのコンテンツをHTML文字列で置換
  - `designer__screenshot` — キャンバスのスクリーンショットをPNGで取得
- [ ] デザイナーのトップバーにMCP接続状態インジケーターが表示される（接続中/未接続）
- [ ] Claude CodeのMCP設定にサーバーを登録して再起動すれば、私（Claude）がツールを呼べる
- [ ] ブラウザを閉じてもMCPサーバーは生き続け、ブラウザを再度開くと自動再接続する
- [ ] エラー時（ブラウザ未接続でツール呼出など）に明確なエラーメッセージが返る

---

## 2. アーキテクチャ

```
┌────────────────────────────┐
│  Claude Code (Sonnet/Opus) │   ← MCPクライアント（既存）
└──────────────┬─────────────┘
               │ stdio (JSON-RPC)
               ▼
┌────────────────────────────┐
│  backend-server       │   ← Node.js (TypeScript)で新規作成
│  - MCP Server (stdio)      │
│  - WebSocket Server        │
└──────────────┬─────────────┘
               │ WebSocket (ws://localhost:5179)
               ▼
┌────────────────────────────┐
│  Designer (ブラウザ)        │   ← 既存のReact+GrapesJSアプリ
│  - mcpBridge.ts (新規)      │
│  - 接続状態UI (既存改修)    │
└────────────────────────────┘
```

### 通信フロー（例: get_html呼び出し）

```
1. Claudeが designer__get_html を呼ぶ
2. MCPサーバーが受信 → WebSocketでデザイナーへ {id, method:"getHtml"} を送信
3. デザイナー(mcpBridge)が受信 → editor.getHtml() + getCss() を実行
4. デザイナーが {id, result:{html,css}} を返信
5. MCPサーバーがClaudeへ結果を返す
```

---

## 3. ディレクトリ構成

```
c:/Workspaces/HTMLデザイン/
├── frontend/                       ← 既存
│   └── src/
│       ├── mcp/                    ← 新規
│       │   └── mcpBridge.ts        ← WebSocketクライアント
│       └── components/
│           ├── Designer.tsx        ← 改修: mcpBridge起動
│           └── Topbar.tsx          ← 改修: 接続状態表示
└── backend/                   ← 新規パッケージ
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── index.ts                ← MCPサーバーエントリ
        ├── wsBridge.ts             ← WebSocketサーバー
        └── tools.ts                ← MCPツール定義
```

---

## 4. 依存ライブラリ

### 4.1 backend（新規パッケージ）

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

> **メモ**: 最新バージョンは `npm view <pkg> version` で確認すること。MCPのSDKは `@modelcontextprotocol/sdk` の最新を使う。

### 4.2 designer（既存に追加）

```bash
# スクリーンショット撮影用
npm i html2canvas
```

---

## 5. 実装タスク（順番通りに進めること）

### Phase A: MCPサーバー（backend）

#### A1. パッケージ初期化
- [ ] `c:/Workspaces/HTMLデザイン/backend/` ディレクトリを作成
- [ ] `package.json` を作成（上記の依存を含む）。`"type": "module"`、`"bin": { "backend": "dist/index.js" }`
- [ ] `tsconfig.json` を作成（target: ES2022, module: ESNext, moduleResolution: bundler, strict: true）
- [ ] `npm install` を実行

#### A2. WebSocketブリッジサーバー実装
- [ ] `src/wsBridge.ts` を作成。以下の責務:
  - `ws://localhost:5179` でリッスン
  - 単一クライアント接続を保持（複数接続時は古いものを切断）
  - `sendCommand(method, params)` を提供。Promiseでレスポンスを返す
  - メッセージID採番、5秒タイムアウト
  - クライアント切断時に状態をクリア
  - イベント発火: `connected`, `disconnected`

```ts
// 型のヒント
type Command = { id: string; method: string; params?: unknown };
type Response = { id: string; result?: unknown; error?: string };
```

#### A3. MCPツール定義
- [ ] `src/tools.ts` を作成。3つのツール定義:

```ts
export const tools = [
  {
    name: "designer__get_html",
    description: "現在のデザイナーキャンバスのHTMLとCSSを取得します",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "designer__set_components",
    description: "デザイナーキャンバスのコンテンツを指定HTMLで完全に置換します",
    inputSchema: {
      type: "object",
      properties: { html: { type: "string", description: "置換するHTML" } },
      required: ["html"]
    }
  },
  {
    name: "designer__screenshot",
    description: "デザイナーキャンバスのスクリーンショットをPNG画像で取得します",
    inputSchema: { type: "object", properties: {}, required: [] }
  }
];
```

#### A4. MCPサーバー本体
- [ ] `src/index.ts` を作成
  - `@modelcontextprotocol/sdk/server` の `Server` を初期化
  - stdio transport を使用
  - `ListToolsRequestSchema` ハンドラ → `tools` を返す
  - `CallToolRequestSchema` ハンドラ → 各ツールに振り分け
    - `designer__get_html` → `wsBridge.sendCommand("getHtml")` → text contentで返す
    - `designer__set_components` → `wsBridge.sendCommand("setComponents", {html})` → 成功メッセージ
    - `designer__screenshot` → `wsBridge.sendCommand("screenshot")` → image contentで返す（base64 PNG）
  - WSブリッジの未接続時は明確なエラー: 「デザイナーがブラウザで開かれていません。http://localhost:5173 を開いてください」
- [ ] `package.json` の `scripts.start` を `tsx src/index.ts` に
- [ ] `package.json` の `scripts.build` を `tsc` に

#### A5. 動作確認（手動テスト）
- [ ] `npm run start` でサーバーが起動することを確認
- [ ] WebSocketサーバーがlisten中であることを確認（`netstat -ano | grep 5179`）
- [ ] エラーなしで停止待機状態になっていればOK

---

### Phase B: デザイナー側のWebSocketクライアント

#### B1. mcpBridge.ts実装
- [ ] `frontend/src/mcp/mcpBridge.ts` を作成。責務:
  - `ws://localhost:5179` に接続を試みる
  - 接続失敗時は5秒後にリトライ（無限）
  - 切断時も自動再接続
  - メッセージ受信時に method に応じて処理
  - 接続状態を `useMcpStatus()` フックで公開

```ts
// 型のヒント
type Status = "disconnected" | "connecting" | "connected";

export interface McpBridge {
  status: Status;
  start(editor: GEditor): void;
  stop(): void;
  onStatusChange(cb: (s: Status) => void): () => void;
}

export const mcpBridge: McpBridge;
```

- [ ] 各メソッドの実装:
  - `getHtml`: `editor.getHtml()` + `editor.getCss()` を返す
  - `setComponents`: `editor.setComponents(html)` を実行、成功を返す
  - `screenshot`: `html2canvas`でキャンバスiframeのbodyを撮影、base64 PNG文字列を返す
- [ ] 例外時は `{error: string}` で返信

#### B2. html2canvas導入
- [ ] `cd frontend && npm i html2canvas`
- [ ] `mcpBridge.ts` で `import html2canvas from 'html2canvas'`
- [ ] スクリーンショット実装:

```ts
async function captureScreenshot(editor: GEditor): Promise<string> {
  const canvasDoc = editor.Canvas.getDocument();
  const body = canvasDoc.body;
  const canvas = await html2canvas(body, {
    backgroundColor: null,
    scale: 1,
    logging: false,
  });
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}
```

#### B3. Designer.tsxへの統合
- [ ] `Designer.tsx` の `onEditor` 内で `mcpBridge.start(editor)` を呼ぶ
- [ ] アンマウント時に `mcpBridge.stop()` を呼ぶ
- [ ] `useMcpStatus()` を使って `mcpStatus` を取得し、Topbarに props で渡す

#### B4. Topbarに接続状態表示
- [ ] `Topbar.tsx` に `mcpStatus: "disconnected" | "connecting" | "connected"` props を追加
- [ ] テーマセレクタの隣に小さなインジケーターを追加:
  - 接続中: 緑の丸 + 「MCP」
  - 接続試行中: 黄色の丸（点滅）
  - 未接続: グレーの丸
- [ ] hover時にtitleで状態詳細表示

#### B5. 動作確認
- [ ] `npm run dev` でデザイナー起動（http://localhost:5173）
- [ ] MCPサーバー未起動 → インジケーターがグレー
- [ ] MCPサーバー起動 → インジケーターが緑になる（自動接続確認）
- [ ] サーバー停止 → グレーに戻る
- [ ] サーバー再起動 → 自動再接続して緑になる

---

### Phase C: Claude Code MCP設定

#### C1. ビルド
- [ ] `cd backend && npm run build`
- [ ] `dist/index.js` が生成されることを確認

#### C2. 設定ファイルへの追記
- [ ] Claude Code のMCP設定ファイルを特定（通常 `~/.claude/claude_code_config.json` または `%APPDATA%/Claude/`）
- [ ] 以下のエントリを追加:

```json
{
  "mcpServers": {
    "designer": {
      "command": "node",
      "args": ["c:/Workspaces/HTMLデザイン/backend/dist/index.js"]
    }
  }
}
```

> **注**: Sonnetは設定ファイルの場所が分からない場合、Claude公式ドキュメントの`claude-code-guide`サブエージェントに確認すること。

#### C3. Claude Code再起動
- [ ] Claude Codeを完全に終了して再起動
- [ ] `/mcp` コマンドまたはツール一覧で `designer__*` ツールが見えればOK

---

### Phase D: 統合動作テスト

#### D1. 基本動作
- [ ] デザイナーをブラウザで開く（http://localhost:5173）
- [ ] Claude Codeで「designer__get_html を呼んで」と指示 → HTMLが返ってくる
- [ ] Claude Codeで「designer__screenshot を呼んで」と指示 → 画像が返ってくる
- [ ] Claude Codeで「designer__set_components で `<div>テスト</div>` に置換して」と指示 → デザイナーに反映される

#### D2. エッジケース
- [ ] ブラウザ閉じた状態で `designer__get_html` → 「デザイナーが開かれていません」エラー
- [ ] 不正なHTMLを set_components に渡した時の挙動確認（GrapesJSのエラーを返す or 無視）
- [ ] 巨大なHTML（10000要素級）でタイムアウトしないか
- [ ] 複数タブで開いた場合 → 後から開いたタブが優先される

#### D3. パフォーマンス測定
- [ ] `designer__get_html` の往復時間を計測（目標: 100ms以下）
- [ ] `designer__screenshot` の往復時間を計測（目標: 1秒以下）
- [ ] Playwrightと比較してログに残す

---

## 6. 実装上の注意点

### 6.1 セキュリティ
- WebSocketサーバーは **localhost専用**（`127.0.0.1`にバインド）
- 認証は実装しない（ローカル限定のため）
- リモートアクセス対応は将来課題

### 6.2 同時接続
- ブラウザ側が複数タブで開かれた場合、**最後に接続したものを優先**
- 古い接続には「他のタブが接続しました」を送信して切断

### 6.3 エラーハンドリング
- WebSocket切断時はMCPサーバーは生き続ける
- ブラウザ側の例外は `{error: "..."}` でMCPサーバーへ返す
- MCPサーバーはClaudeへ `isError: true` のtool結果として返す

### 6.4 ロギング
- MCPサーバーは stderr にログ出力（stdoutはMCPプロトコルが使用）
- デザイナー側は console.log でブラウザDevToolsに出力
- デバッグ時に役立つ情報: 接続/切断、メッセージ送受信、エラー

### 6.5 GrapesJSの制約
- `editor.setComponents(html)` は完全置換。partial updateには非対応
- `editor.getHtml()` はキャンバス内のHTMLのみ返す（DOCTYPE等は含まない）
- スクリーンショットは iframe内のbodyを対象にする

### 6.6 ホットリロード対応
- Vite HMRでmcpBridge.tsが再読込された場合、既存のWS接続をクローズしてから再接続する
- グローバル変数で接続インスタンスを保持し、HMR時に明示的に解放

---

## 7. 受け入れテストシナリオ

実装完了後、以下のシナリオをClaude Codeで実行して動作確認すること。

### シナリオ1: 「現在のキャンバスを取得して説明して」
- 期待: `designer__get_html` が呼ばれ、HTMLが返り、ClaudeがHTMLを解説する

### シナリオ2: 「シンプルなログインフォームに置き換えて」
- 期待: `designer__set_components` が呼ばれ、デザイナーがログインフォームに変わる

### シナリオ3: 「現在の見た目を画像で見せて」
- 期待: `designer__screenshot` が呼ばれ、画像が表示される

### シナリオ4: 「ブラウザを閉じてからget_htmlを呼んで」
- 期待: 明確なエラーメッセージが表示される

---

## 8. ドキュメント更新

- [ ] `backend/README.md` を作成。インストール手順・使い方・トラブルシューティングを記載
- [ ] `frontend/README.md` にMCP接続セクションを追加
- [ ] ルートの `README.md` にMCPサーバーの存在を1行追記

---

## 9. 完了後にやること（Step 2予告）

Step 1 完了後、以下を Step 2 で検討:

- `designer__list_blocks` — 利用可能ブロック一覧
- `designer__add_block` — ブロック追加
- `designer__remove_element` — 要素削除
- `designer__update_element` — 要素更新
- `designer__set_theme` — テーマ切り替え（既存テーマ機能と連携）

---

## 10. 関連メモ

### 将来構想
- **画面遷移図作成** — 複数画面を管理し、リンク関係を可視化する機能
- **コンポーネント生成** — デザインからReactコンポーネントを自動生成
- **ブロック自動作成** — Claudeに新ブロックを定義させる

### 参考リンク
- MCP公式ドキュメント: https://modelcontextprotocol.io/
- @modelcontextprotocol/sdk: https://github.com/modelcontextprotocol/typescript-sdk
- GrapesJS API: https://grapesjs.com/docs/api/
