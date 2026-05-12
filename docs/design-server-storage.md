# 設計書: サーバーサイド・ファイルストレージ + マルチクライアント同期

## 背景・動機

現在のデザイナーは **localStorage** にすべての状態を保存している。
この設計には以下の問題がある:

1. **複数タブ・ブラウザの競合**: wsBridge が単一クライアントしか持てないため、複数タブで開くとMCPコマンドの宛先が不定になる
2. **データの揮発性**: localStorage はブラウザごと・オリジンごとに隔離されており、バージョン管理やバックアップができない
3. **ブラウザ依存**: MCP サーバーがブラウザ経由でしかデータにアクセスできない（ブラウザが閉じていると何もできない）

## ゴール

- 同じプロジェクトを複数タブ/ブラウザで開いても **同じ状態が表示される**
- どのタブで編集しても **全タブがリアルタイムに同期される**
- プロジェクトデータが **ファイルとして永続化** され、git 管理可能になる
- MCP サーバーがブラウザなしで **フローデータを直接読み書き** できる

---

## アーキテクチャ

### 現在

```
Claude Code → MCP Server → wsBridge(単一クライアント) → Browser → localStorage
```

### 改善後

```
                    ┌──────────────────────────────┐
                    │   workspaces/<id>/ (ファイル)│
                    │   ├── harmony.json           │  ← 真実の源 (Source of Truth)
                    │   └── <dataDir>/             │
                    │       ├── screens/           │
                    │       │   └── {id}.json      │
                    │       └── custom-blocks.json │
                    └────────┬─────────────────────┘
                             │ ファイルI/O
                    ┌────────┴─────────────────┐
                    │      wsBridge             │
                    │  - 複数クライアント対応     │
                    │  - ファイル読み書き         │
                    │  - ブロードキャスト         │
                    └────┬──────────┬───────────┘
                MCP側     │          │    ブラウザ側
           (sendCommand)  │          │  (双方向通信)
                         │          │
              ┌──────────┘          └──────────────┐
              │                                     │
    MCP Server (stdio)                     Browser A ─┐
    ├── getFlow → ファイル直読み            Browser B ─┤ broadcast
    ├── setComponents → WS→browser         Browser C ─┘
    └── screenshot → WS→browser
```

### データディレクトリ

```
workspaces/<wsId>/
├── harmony.json            # プロジェクト定義（schemas/v3/harmony.v3.schema.json）
└── <dataDir>/              # harmony.json の dataDir フィールドで指定
    ├── screens/
    │   ├── {screenId}.json # GrapesJS プロジェクトデータ（画面ごと）
    │   └── ...
    └── custom-blocks.json  # カスタムブロック定義
```

- ワークスペースルートに配置（frontend/ と backend/ の両方からアクセス可能）
- `.gitignore` 対象とするかはユーザーの判断
- パスは環境変数 `DESIGNER_DATA_DIR` で上書き可能（デフォルト: `../data` from backend）

---

## WebSocket プロトコル拡張

### 現在のプロトコル

```
MCP Server → wsBridge → Browser:  { id, method, params }     (Command)
Browser → wsBridge → MCP Server:  { id, result?, error? }    (Response)
```

### 拡張プロトコル

**1. MCP→Browser コマンド（既存、変更なし）:**
```json
→ { "id": "uuid", "method": "getHtml", "params": {} }
← { "id": "uuid", "result": { "html": "...", "css": "..." } }
```

**2. Browser→wsBridge リクエスト（新規）:**
```json
→ { "type": "request", "id": "uuid", "method": "loadProject" }
← { "type": "response", "id": "uuid", "result": { ... } }
```

**3. wsBridge→ALL Browsers ブロードキャスト（新規）:**
```json
← { "type": "broadcast", "event": "projectChanged", "data": { ... } }
← { "type": "broadcast", "event": "screenChanged", "data": { "screenId": "..." } }
← { "type": "broadcast", "event": "customBlocksChanged" }
```

**4. クライアント識別（新規）:**
```json
→ { "type": "register", "clientId": "uuid" }
```
- 接続直後にブラウザが送信
- wsBridge は clientId で接続を管理
- ブロードキャストは送信元以外の全クライアントに配信

---

## Browser→wsBridge リクエスト一覧

| method | params | 説明 |
|--------|--------|------|
| `loadProject` | — | harmony.json を読み込み |
| `saveProject` | `{ project }` | harmony.json を書き込み + broadcast |
| `loadScreen` | `{ screenId }` | screens/{id}.json を読み込み |
| `saveScreen` | `{ screenId, data }` | screens/{id}.json を書き込み + broadcast |
| `deleteScreen` | `{ screenId }` | screens/{id}.json を削除 + broadcast |
| `loadCustomBlocks` | — | custom-blocks.json を読み込み |
| `saveCustomBlocks` | `{ blocks }` | custom-blocks.json を書き込み + broadcast |

---

## ファイル変更一覧

### backend/ (MCP サーバー側)

| ファイル | 変更内容 |
|---------|---------|
| `src/wsBridge.ts` | **大幅書き換え**: `client` → `clients: Map<string, WebSocket>`、ファイルI/O追加、ブロードキャスト実装、ブラウザリクエストハンドラ追加 |
| `src/projectStorage.ts` | **新規**: ファイルI/O ユーティリティ（read/write JSON、ディレクトリ初期化） |
| `src/index.ts` | `getFlow`/`listScreens`/`listCustomBlocks` をファイル直読みに変更（ブラウザ不要に）。その他のMCPコマンドはブラウザ経由のまま |
| `src/tools.ts` | 変更なし（ツール定義はそのまま） |

### frontend/ (ブラウザ側)

| ファイル | 変更内容 |
|---------|---------|
| `src/mcp/mcpBridge.ts` | **大幅書き換え**: ブラウザ→wsBridge リクエスト送信機能追加、ブロードキャスト受信ハンドラ追加、接続時 register 送信 |
| `src/grapes/remoteStorage.ts` | **新規**: GrapesJS カスタムストレージマネージャー（wsBridge 経由で load/store） |
| `src/store/flowStore.ts` | localStorage → mcpBridge 経由のファイルI/O に移行。同期版 API を非同期化 |
| `src/store/customBlockStore.ts` | localStorage → mcpBridge 経由のファイルI/O に移行 |
| `src/components/Designer.tsx` | `storageManager` の `type: "local"` → `type: "remote"` に変更。カスタムストレージ登録 |
| `src/components/flow/FlowEditor.tsx` | flowStore の非同期化に伴う変更。broadcast 受信でリアルタイム更新 |

### 変更しないもの

- `Designer.tsx` の `THEME_KEY`、`PANEL_MODE_KEY` → **localStorage のまま**（UIプリファレンスはブラウザ固有で共有不要）
- `vite.config.ts` → **変更なし**（REST API 不要、全て WebSocket 経由）

---

## GrapesJS カスタムストレージ

```typescript
// frontend/src/grapes/remoteStorage.ts

export function registerRemoteStorage(editor: GEditor, screenId: string) {
  editor.StorageManager.add('remote', {
    async load(): Promise<any> {
      // mcpBridge 経由で wsBridge にリクエスト
      const data = await mcpBridge.request('loadScreen', { screenId });
      if (!data) return {};  // 新規画面（空）
      return data;
    },

    async store(data: any): Promise<void> {
      // mcpBridge 経由で wsBridge に保存リクエスト
      await mcpBridge.request('saveScreen', { screenId, data });
      // wsBridge がファイルに書き込み + 他タブにブロードキャスト
    },
  });
}
```

---

## マイグレーション戦略

### 初回起動時

1. `workspaces/<wsId>/` ディレクトリが存在しない → 作成
2. `workspaces/<wsId>/harmony.json` が存在しない → ブラウザの localStorage から移行
3. `workspaces/<wsId>/<dataDir>/screens/` が空 → localStorage の `gjs-screen-*` キーから移行
4. `workspaces/<wsId>/<dataDir>/custom-blocks.json` が存在しない → localStorage から移行

### フォールバック

- wsBridge に接続できない場合 → **localStorage をフォールバックとして使用**
- 接続復旧時に localStorage の内容をサーバーに同期（コンフリクト時は最終更新日で判定）

---

## 実装フェーズ

### Phase 1: インフラ基盤

**目的**: wsBridge のマルチクライアント化 + ファイルストレージ層

1. `projectStorage.ts` 新規作成（ファイルI/O ユーティリティ）
2. `wsBridge.ts` 書き換え:
   - `client` → `clients: Map<string, WebSocket>`
   - ブラウザリクエストハンドラ（load/save）
   - ブロードキャスト機構
   - register プロトコル
3. `index.ts`: `getFlow`、`listScreens`、`listCustomBlocks` をファイル直読みに変更

### Phase 2: フローデータ移行

**目的**: flowStore を localStorage からファイルに移行

1. `flowStore.ts` を非同期 API に書き換え
2. `FlowEditor.tsx` を非同期 flowStore に対応
3. `mcpBridge.ts` にリクエスト送信機能追加
4. broadcast 受信 → FlowEditor リアルタイム更新
5. マイグレーション: localStorage → file

### Phase 3: GrapesJS データ移行

**目的**: GrapesJS の保存先をファイルに移行

1. `remoteStorage.ts` 新規作成（カスタムストレージマネージャー）
2. `Designer.tsx` の storageManager 設定変更
3. broadcast 受信 → GrapesJS リロード（他タブ同期）
4. マイグレーション: localStorage の gjs-screen-* → files

### Phase 4: カスタムブロック移行 + クリーンアップ

**目的**: 残りの localStorage 依存を解消

1. `customBlockStore.ts` をファイルベースに移行
2. localStorage フォールバック実装
3. 不要になった localStorage 操作を削除
4. テスト: 複数タブ同期確認

---

## リスクと対策

| リスク | 対策 |
|-------|------|
| GrapesJS autosave の頻度が高くファイルI/O が集中 | debounce（300ms）を wsBridge のファイル書き込みに適用 |
| wsBridge 未起動時にデザイナーが使えなくなる | localStorage フォールバック |
| 同一画面を複数タブで同時編集 → コンフリクト | Last-write-wins + broadcast で即時反映（OT/CRDT は不要と判断） |
| ファイル破損 | JSON パースエラー時にバックアップから復旧 |
| ブラウザ ↔ wsBridge 間の通信遅延 | autosave は非同期 fire-and-forget、UI はローカル即時反映 |

---

## 最終的な状態

| 項目 | Before | After |
|------|--------|-------|
| データ保存先 | localStorage | JSON ファイル (data/) |
| 複数タブ対応 | 不可（最後の接続のみ） | 全タブ同期 |
| MCP のブラウザ依存 | 全コマンドがブラウザ経由 | フロー操作はファイル直読み |
| データの可搬性 | ブラウザに閉じ込め | ファイルコピー/git管理可能 |
| UIプリファレンス | localStorage | localStorage のまま（変更なし） |
