# Harnize Harmony

GrapesJS + React + Vite による業務システム向け WYSIWYG デザインツール。  
画面フロー図エディタ（ReactFlow）で画面遷移を管理し、各画面のデザインを GrapesJS で編集する。

## 起動方法

### 0. 依存インストール (初回のみ、repo root で)

```bash
# repo root で 1 回実行 — npm workspaces (shared / frontend / backend) を一括解決
npm install
```

PR #1378 (#1375) で npm workspaces 化済み。subdir 単独 `npm install` は workspace 認識されず失敗する場合があるため、**root の 1 発が canonical**。

### 1. フロントエンド

```bash
cd frontend
npm run dev
```

ブラウザで http://localhost:5173 を開く。

### 2. バックエンド（MCP サーバー + WebSocket、推奨）

MCP サーバーを起動すると、ファイルベースの永続化・マルチクライアント同期・Claude Code からの操作が可能になる。  
起動しない場合は localStorage にフォールバック保存される。

```bash
cd backend
npm run dev
```

### 3. サンプルデータの投入

初回セットアップや、データをリセットしたい場合に実行する。  
顧客管理システムのサンプル画面（10画面）が `data/` に生成される。

```bash
# プロジェクトルートから実行
node docs/sample-project/seed.mjs
```

- 生成先: `workspaces/<id>/harmony.json` + `<id>/<dataDir>/screens/*.json`
- テンプレート: `docs/sample-project/screens/*.json`
- 何度実行しても同じ結果になる（冪等）
- `data/` は `.gitignore` 対象のため、各開発者が個別に実行する

## 動作環境

- Node.js 20 以上 (setup docs `docs/setup/wsl2-native.md` / `docs/setup/dev-containers.md` も Node 20 前提)
- モダンブラウザ（Chrome / Edge 推奨）
- PC 向け（スマートフォン非対応）

---

## ファイル構成

```
harmony/
├── frontend/                # フロントエンド（Vite + React）
│   ├── src/
│   │   ├── components/
│   │   │   ├── Designer.tsx       # GrapesJS エディタ画面
│   │   │   ├── Topbar.tsx         # ツールバー（Undo/Redo/保存/テーマ）
│   │   │   ├── BlocksPanel.tsx    # 左パネル（ブロック一覧・検索）
│   │   │   ├── RightPanel.tsx     # 右パネル（スタイル/属性/レイヤー）
│   │   │   └── flow/
│   │   │       ├── FlowEditor.tsx    # 画面フロー図エディタ（ReactFlow）
│   │   │       └── EdgeEditModal.tsx # 遷移エッジ編集モーダル
│   │   ├── grapes/
│   │   │   ├── blocks.ts          # GrapesJS ブロック定義（60+ブロック）
│   │   │   └── remoteStorage.ts   # サーバーサイドストレージ連携
│   │   ├── store/
│   │   │   ├── flowStore.ts       # フロープロジェクト永続化
│   │   │   └── customBlockStore.ts
│   │   ├── mcp/
│   │   │   └── mcpBridge.ts       # WebSocket ブリッジ
│   │   └── styles/
│   │       ├── app.css            # デザイナー UI（ダークテーマ）
│   │       ├── common.css         # キャンバス内注入用（業務システム共通CSS）
│   │       └── flow.css           # フロー図エディタ用
│   └── index.html
├── backend/             # MCP サーバー（Express + WebSocket）
│   └── src/
│       ├── server.ts         # MCP ツール定義
│       └── wsBridge.ts       # WebSocket ブリッジサーバー
├── workspaces/               # ユーザー作業領域（.gitignore 対象）
│   └── <id>/
│       ├── harmony.json      # プロジェクト定義（schemas/v3/harmony.v3.schema.json）
│       └── <dataDir>/        # harmony.json の dataDir フィールドで指定
│           └── screens/      # 各画面の GrapesJS データ
├── data/
│   └── extensions/           # デザイナー本体組み込み拡張定義（git tracked）
├── docs/
│   └── sample-project/
│       ├── seed.mjs          # サンプルデータ生成スクリプト
│       └── screens/          # サンプル画面テンプレート（10画面）
└── .gitignore
```

## 画面フロー図

`/` にアクセスすると画面フロー図エディタが表示される。

- 画面ノードの追加・編集・削除
- 画面間の遷移エッジ（ラベル・トリガー・ハンドル方向）
- ダブルクリックで画面デザイナーに遷移
- JSON / Mermaid / Markdown エクスポート

## 画面デザイナー

`/design/:screenId` で各画面のデザインを編集する。

### 左パネル（ブロック）

60以上のドラッグ＆ドロップブロックを用意。CSS の知識がなくても業務画面を構築できる。

| カテゴリ | ブロック数 | 例 |
|---------|-----------|-----|
| ページテンプレート | 3 | ログイン、削除確認、処理完了 |
| ナビゲーション | 4 | アプリナビバー、メニューカードグリッド |
| 詳細表示 | 6 | アクションバー、カードセクション、バッジ |
| レイアウト | 9 | 1〜4カラム行、グリッド |
| フィールド | 18 | テキスト、日付、セレクト、スイッチ等 |
| 複合フィールド | 5 | 郵便番号+住所、日付範囲 |
| 検索・一覧 | 4 | 検索条件、データテーブル、ページング |
| 共通パーツ | 11 | ヘッダー、フッター、ボタン、タブ |

### 右パネル

| タブ | 機能 |
|------|------|
| スタイル | セレクタ管理 + CSS プロパティ編集 |
| 属性 | コンポーネント属性（ID, Title 等） |
| レイヤー | コンポーネントツリー表示・選択 |

### 左パネルの表示モード

| モード | 動作 |
|--------|------|
| **Pinned** | 常時表示、レイアウト幅を占有 |
| **Auto-hide** | 左端ホバーでスライドイン |
| **Hidden** | 完全非表示、トップバーから復帰 |

## デザインの保存

- **MCP サーバー接続時**: `data/screens/` にファイル保存（自動保存 + マルチクライアント同期）
- **未接続時**: localStorage にフォールバック保存

---

## Windows での既知の問題

### npx が動かない / MCP が起動しない

Git Bash や PowerShell で `npx` コマンドを実行するとエラーになる場合がある。

**対処法**:
1. ターミナルを再起動する
2. `where node` / `where npx` でパスを確認
3. Git Bash に PATH が通っていない場合は `~/.bashrc` に追記:
   ```bash
   export PATH="/c/Program Files/nodejs:$PATH"
   ```

### Playwright MCP の起動オプション

`.mcp.json` に `--headless=false` を指定するとエラーになる（headed モードはデフォルト）。
