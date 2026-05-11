# ワークスペース仕様 (v1)

PR #676 で導入した「複数ワークスペース管理機能」の正規仕様。

---

## 1. 用語定義

| 用語 | 説明 |
|------|------|
| ワークスペース | `harmony.json` を含むフォルダ 1 つ。UI 表記は「ワークスペース」(カタカナ)、実装識別子・JSON key は `workspace` を用いる。 |
| `harmony.json` | ワークスペースフォルダの root に配置する marker ファイル。`schemas/v3/harmony.v3.schema.json` 準拠。`dataDir` フィールドで設計データ格納先のサブディレクトリを指定する。 |
| `dataDir` | 設計データ (`screens/` / `tables/` / `actions/` 等) を格納するサブディレクトリのパス (ワークスペースルートからの相対パス)。推奨慣習は `"harmony"`。 |
| active ワークスペース | `backend` が現在 read/write 対象とする 1 つのワークスペース。1 サーバ = 1 active が原則。env `DESIGNER_DATA_DIR` 指定時は lockdown 固定。 |
| recent | 最近開いたワークスペースの履歴リスト (`~/.harmony/recent-workspaces.json`)。表示順は `lastOpenedAt` 降順。 |
| lockdown モード | env `DESIGNER_DATA_DIR` が設定されている場合に起動する動作モード。active は env 値に固定され、切替操作は全て `LockdownError` となる。 |

`data/` ディレクトリはデザイナー本体の組み込み拡張定義 (`data/extensions/`) 専用。ユーザープロジェクトは `workspaces/` 配下または任意フォルダに置く (#754)。

**実装**: `backend/src/workspaceState.ts:1-97`

---

## 2. 物理レイアウト

### 2.1 recent-workspaces.json

保存先: `~/.harmony/recent-workspaces.json`
(env `DESIGNER_RECENT_FILE` で上書き可能 — テスト / VS Code 拡張 sandbox 用途)

```json
{
  "$schema": "harmony-recent-workspaces-v1",
  "version": 1,
  "workspaces": [
    {
      "id": "<uuid>",
      "path": "<絶対パス>",
      "name": "<表示名>",
      "lastOpenedAt": "<ISO 8601>"
    }
  ],
  "lastActiveId": "<uuid | null>"
}
```

- `version`: 常に `1`
- `workspaces[]`: `WorkspaceEntry` の配列。順序は追加順 (UI 側で `lastOpenedAt` 降順にソートして表示)
- `lastActiveId`: 前回 active だったエントリの id。null = 前回も未選択

**実装**: `backend/src/recentStore.ts:1-193`

### 2.2 ワークスペース内ディレクトリ構造

ワークスペースルートは `workspaces/<wsId>/` または任意の絶対パス。どちらも同じ構造を持つ。

```
<workspace-root>/           # workspaces/<id>/ または任意フォルダ
  harmony.json              # 必須 — schemas/v3/harmony.v3.schema.json 準拠 (marker file)
  <dataDir>/                # harmony.json の dataDir 値 (推奨慣習: "harmony")
    screens/                # 画面定義 (*.json / *.design.json)
    tables/                 # テーブル定義
    actions/                # 処理フロー定義
    conventions/            # 規約カタログ (catalog.json)
    sequences/              # シーケンス定義
    views/                  # ビュー定義
    view-definitions/       # ビュー定義 (UI 編集可)
    extensions/             # 拡張定義 (steps.json 等)
    er-layout.json          # 任意 — ER 図レイアウト
    custom-blocks.json      # 任意 — カスタムブロック
    screen-flow-positions.json      # 任意 — 画面フロー UI 座標
```

`harmony.json` はワークスペースフォルダの **root に固定**で配置する。設計データは `<dataDir>/` 配下に格納され、他ツール (Git / IDE 等) の管理対象ファイルと混在しない。

`screen-items/` ディレクトリは Phase 4-β migration 後に廃止。`ensureDataDir` では再作成しない。

**実装**: `backend/src/workspaceInit.ts:119-175` (initializeWorkspace) / `backend/src/projectStorage.ts:92-104` (ensureDataDir)

---

## 3. ライフサイクル

### 3.1 起動時 auto-activate カスケード

`backend` 起動時に `autoActivateOnStartup()` が以下の順で active を確定する:

1. env `DESIGNER_DATA_DIR` が定義されている → lockdown active として確定 (recent は読み書きしない)
2. それ以外で `recent.lastActiveId` が指す workspace の `inspectWorkspacePath` が `ready` → `setActivePath` で復元
3. 全て miss → active = null (UI は `/workspace/select` へ redirect)

`ready` 判定は `<root>/harmony.json` の存在で行う (旧: `project.json`)。`data/` は `data/extensions/` 専用であり、ユーザープロジェクト領域ではない。

**実装**: `backend/src/workspaceInit.ts:211-234`

### 3.2 workspace.open

```
workspace.open(path, init?)
```

- `path` または `id` (recent エントリ) のいずれかを指定する (排他)
- `init` 省略 / `false`: `inspectWorkspacePath` で `ready` 状態を確認してから active 化。`ready` でない場合は error を返す
- `init=true`: 対象フォルダを作成し `harmony.json` + `<dataDir>/` 配下のサブディレクトリ群を初期化してから active 化 (lockdown 時は error)。`dataDir` のデフォルト値は `"harmony"`
- 成功すると `recent` に `upsert` し `lastActiveId` を更新、`workspace.changed` を broadcast

**実装**: `backend/src/wsBridge.ts:710-778`

### 3.3 workspace.close

```
workspace.close()
```

- active = null にする (recent からは削除しない)
- lockdown 時は `LockdownError` を返す
- `workspace.changed` を broadcast (`activeId: null`)

**実装**: `backend/src/wsBridge.ts:780-793`

### 3.4 workspace.remove

```
workspace.remove(id)
```

- recent からエントリを除外する (ファイルシステムは変更しない)
- lockdown 時は error を返す

**実装**: `backend/src/wsBridge.ts:794-800`

### 3.5 workspace.inspect

```
workspace.inspect(path) → { status, path, name? }
```

3 状態を返す:

| status | 意味 |
|--------|------|
| `ready` | `harmony.json` が存在する |
| `needsInit` | フォルダは存在するが `harmony.json` がない (空フォルダ含む) |
| `notFound` | path 自体が存在しない、またはフォルダでない |

**実装**: `backend/src/workspaceInit.ts:87-101`

### 3.6 workspace.hostInfo

```
workspace.hostInfo() → { platform, isWSL, homeDir }
```

backend が動作しているホスト OS 情報を返す。`AddWorkspaceDialog` が path 入力欄の placeholder / WSL 検出ヒント表示に使う (#858)。

| field | 型 | 内容 |
|-------|----|------|
| `platform` | `"linux" \| "win32" \| "darwin" \| "other"` | `process.platform` を 4 値に正規化 |
| `isWSL` | `boolean` | `process.platform === "linux"` かつ `/proc/version` に `Microsoft` または `WSL` 文字列を含む場合 `true` (大文字小文字無視) |
| `homeDir` | `string` | `os.homedir()` (placeholder の "/home/<user>/projects/my-app" 等を組み立てるのに使用) |

- backend session 内でキャッシュされる (`/proc/version` を毎回読まない)
- `inspectWorkspacePath` のような厳密判定ではなく**情報提供 API**。frontend は描画切替の hint として使うのみで、認可判断には使わない

**実装**: `backend/src/hostInfo.ts:32-49` / `backend/src/wsBridge.ts:1373-1376`

### 3.7 init=true 時の初期化内容

`initializeWorkspace(path)` が実行する処理:

1. フォルダを `mkdir -p` で作成 (既存なら無視)
2. `<dataDir>/screens/` `<dataDir>/tables/` ... の 8 サブディレクトリを `<dataDir>/` 配下に作成
3. `harmony.json` を生成 — `schemas/v3/harmony.v3.schema.json` を Ajv2020 で検証してから書き込む。検証失敗時は throw (schema を勝手に変更して通過させることは禁止)
4. 初期 `harmony.json` の構造: `schemaVersion: "v3"` / `dataDir: "harmony"` / `meta.mode: "upstream"` / `meta.maturity: "draft"` / `extensionsApplied: []` / `entities` に空配列

**実装**: `backend/src/workspaceInit.ts:119-175`

---

## 4. lockdown モード

### 4.1 有効化条件

起動時に env `DESIGNER_DATA_DIR` が非空文字で定義されていれば lockdown 入り。
`initWorkspaceState()` が idempotent に判定する (複数回呼び出し可)。

**実装**: `backend/src/workspaceState.ts:39-49`

### 4.2 無効化される操作

| 操作 | 挙動 |
|------|------|
| `workspace.open` | `LockdownError` を返す (新規 init も含む) |
| `workspace.close` | `LockdownError` を返す |
| `workspace.remove` | error を返す |
| `setActivePath()` | `LockdownError` を throw |
| `clearActive()` | `LockdownError` を throw |
| recent read/write | 完全 skip (ファイルを読まず書かない) |

**実装**: `backend/src/workspaceState.ts:73-89`

### 4.3 UI での表示

- `WorkspaceIndicator`: ボタンに鍵アイコン (`bi-lock-fill`, 色 `#fbbf24`) を表示し、tooltip に `DESIGNER_DATA_DIR` の値を表示
- `WorkspaceListView`: lockdown バナー (黄色) を表示し、追加・開く・リストから外すボタンを disabled 化
- `WorkspaceSelectView`: lockdown バナーを表示し、新しくワークスペースを追加ボタンを非表示化

**実装**: `frontend/src/components/workspace/WorkspaceIndicator.tsx:96-101` / `frontend/src/components/workspace/WorkspaceListView.tsx:436-452` / `frontend/src/components/workspace/WorkspaceSelectView.tsx:191-206`

### 4.4 主な用途

- CI / E2E テスト: `DESIGNER_DATA_DIR=./data npx ...` で単一プロジェクトに固定
- VS Code 拡張ホスト (将来): 拡張が管理するフォルダを固定
- recent への副作用を完全排除したい any シナリオ

---

## 5. UI 規約

### 5.1 ルート

| Path | コンポーネント | 性質 |
|------|---------------|------|
| `/workspace/list` | `WorkspaceListView` | singleton タブ — ヘッダー・タブバーあり |
| `/workspace/select` | `WorkspaceSelectView` | フルスクリーン welcome — ヘッダー・タブバーなし |

`/workspace/select` はタブ対象外 (`AppShell.tsx` の singleton ルートリストに含まれない)。
`/workspace/list` は singleton タブとして管理される (type: `"workspace-list"`)。

**実装**: `frontend/src/components/AppShell.tsx:330-357`

### 5.2 WorkspaceIndicator

`CommonHeader` 内、HeaderMenu / ロゴ / タイトルに続く 4 番目の要素として配置。

**実装**: `frontend/src/components/CommonHeader.tsx:14-19`

表示要素:
- lockdown 時: 鍵アイコン (`bi-lock-fill`) + アクティブ名またはパス
- 通常時: フォルダアイコン (`bi-folder2`) + アクティブ名 (未選択時はグレーアウト)
- ドロップダウン展開時: ワークスペース一覧へのリンク / 最近 5 件 / ワークスペースを閉じる

**実装**: `frontend/src/components/workspace/WorkspaceIndicator.tsx:10-204`

### 5.3 redirect 条件

`AppShell` のルーティングガードが以下を全て満たす場合に `/workspace/select` へ navigate する:

- `workspaceState.active === null`
- `workspaceState.loading === false`
- `workspaceState.error !== "e2e bypass"` (e2e テスト用 bypass 中は guard スキップ)
- `workspaceState.lockdown === false` (lockdown 時は常にアクティブ扱いのためガード不要)
- 現在パスが `/workspace/list` でも `/workspace/select` でもない

backend offline 時 (port 5179 未接続) は `connectionFailed` が立ち、AppShell 上位で
`ConnectionFailedView` (再試行ボタン + backend 起動コマンド案内) が表示される
(#923 シリーズで localStorage fallback を廃止、`docs/spec/edit-session-draft.md` D-8 と整合)。

**実装**: `frontend/src/components/AppShell.tsx`

### 5.4 ワークスペース切替時の cleanup

`AppShell` が `workspaceState.active?.id` の変化 (non-null → 別値 or null) を検知して実行:

1. dirty なタブがあれば `console.warn` で名前を出力 (確認ダイアログは未実装、follow-up)
2. `clearPersistedTabs()` で `localStorage` の `harmony-open-tabs` / `harmony-active-tab` を削除
3. `gjs-` プレフィックスの `localStorage` キーを全削除 (旧 GrapesJS autosave 残骸の除去、`legacyLocalStorageRescue` 救済対象)
4. `window.location.reload()` で完全リロード

初回 hydration (null → non-null) はリロードしない (無限ループ防止)。

**実装**: `frontend/src/components/AppShell.tsx`

---

## 6. プロトコル

### 6.1 WebSocket リクエストメソッド (browser → backend)

`mcpBridge.request(method, params)` 経由で呼び出す。実体は `wsBridge._handleBrowserRequest`。

| method | params | レスポンス |
|--------|--------|-----------|
| `workspace.list` | (なし) | `{ workspaces: WorkspaceEntry[], lastActiveId, active: { id, path, name } \| null, lockdown, lockdownPath }` |
| `workspace.status` | (なし) | `{ active: { path, name } \| null, lockdown, lockdownPath }` |
| `workspace.inspect` | `{ path: string }` | `{ status: "ready" \| "needsInit" \| "notFound", path, name? }` |
| `workspace.open` | `{ path?: string, id?: string, init?: boolean }` | `{ active: { id, path, name } }` または error |
| `workspace.close` | (なし) | `{ success: true }` または error |
| `workspace.remove` | `{ id: string }` | `{ removed: boolean }` または error |

**実装**: `backend/src/wsBridge.ts:671-801`

### 6.2 broadcast イベント (backend → 全ブラウザ)

| イベント | payload |
|---------|---------|
| `workspace.changed` | `{ activeId: string \| null, path: string \| null, name: string \| null, lockdown: boolean }` |

`workspace.open` 成功時と `workspace.close` 成功時に broadcast される。
UI 側は `workspaceStore.subscribeWorkspaceChanges()` で subscribe し、自動的に `loadWorkspaces()` を再実行する。

lockdown 時の `workspace.list.active.id` は recent に依存せず固定値 `"lockdown"` を返す。これにより `/w/:wsId/*` の URL 正規化は recent エントリが存在しない環境でも `/w/lockdown/` として成立する。

**実装**: `backend/src/wsBridge.ts:772-777, 789-791` (broadcast) / `frontend/src/store/workspaceStore.ts:163-190` (subscribe)

### 6.3 MCP tools (AI エージェント用)

`backend/src/tools.ts` に定義された AI エージェント向けツール (6 件):

| tool name | 説明 | 主なパラメータ |
|-----------|------|---------------|
| `designer__workspace_list` | recent 一覧 + active + lockdown 状態を返す | なし |
| `designer__workspace_status` | 現在 active のパス・名前・lockdown を返す | なし |
| `designer__workspace_open` | 指定 path または id を active 化。`init=true` で初期化も実行 | `path` / `id` / `init` |
| `designer__workspace_inspect` | path の状態を判定 (`ready` / `needsInit` / `notFound`) | `path` (必須) |
| `designer__workspace_close` | active を閉じる (recent には残す) | なし |
| `designer__workspace_remove` | recent からエントリを除外 (fs は変更しない) | `id` (必須) |

合計 6 エントリが MCP tool として公開されている: `_list` / `_status` / `_open` / `_inspect` / `_close` / `_remove`。

**実装**: `backend/src/tools.ts:1233-1284`

---

## 7. 並行制御

### 7.1 recentStore の write 直列化

`recentStore.ts` の write 系関数 (`upsertWorkspace` / `setLastActive` / `removeWorkspace`) は `withWriteLock` で直列化される。

仕組み:
- モジュールレベルの `_writeChain: Promise<unknown>` を前段 Promise の tail に繋いでいく Promise chain
- 前段の成否に関わらず次段を実行 (`continue-on-error` セマンティクス) — 1 回の例外で chain が永続停滞して後続 RMW がブロックされるのを防ぐ
- 各 fn は `readRecent → modify → writeRecent` の独立 RMW — 前段が失敗しても次段は fresh な file を読む

これにより `upsertWorkspace` と `setLastActive` が並行して呼ばれても `recent-workspaces.json` が壊れない。

**実装**: `backend/src/recentStore.ts:96-118`

### 7.2 projectStorage の root スナップショット規約

`projectStorage.ts` の公開関数は関数開始時に `requireActivePath()` または引数 `root` で workspace ルートを一度だけスナップショットし、以降の全 I/O をその snapshot した path に対して実施する。

目的: workspace 切替が in-flight の read/write 操作を中断しない。切替後の新 active path には、切替前に開始した I/O の書き込み先が流れない。

**実装**: `backend/src/projectStorage.ts:14-26` (getter 関数化の解説コメント)

### 7.3 workspace.changed broadcast の冪等性

`workspace.changed` は接続している全ブラウザに broadcast される。UI 側 (`workspaceStore`) は受信時に `loadWorkspaces()` を再実行するため、同一 broadcast が複数回届いても状態は収束する (冪等)。再 mount で recoverable を前提とすること。

**実装**: `frontend/src/store/workspaceStore.ts:163-190`

---

## 8. 既知の制約 / 未対応

### 8.1 同時複数ワークスペースの並行編集 (v2)

v1 では「1 サーバ = 1 active」が原則だったが、v2 (#679 シリーズ) で per-session active state を導入し、ブラウザタブ単位で独立した active workspace を持てるようになる。詳細は [workspace-multi.md](workspace-multi.md) を参照。

### 8.2 harmony.json スキーマガバナンス

`harmony.json` の schema は `schemas/v3/harmony.v3.schema.json`。このスキーマは **フレームワーク製作者 (設計者) の専権事項** であり、AI が勝手に変更してはならない。詳細は [schema-governance.md](schema-governance.md) を参照。

### 8.3 未実装機能

以下の機能は v1 では未対応。必要に応じて別 ISSUE で設計・実装する:

- **workspace export/import**: ワークスペースを zip 化してポータブルにする機能
- **テンプレート機能**: 業界別サンプルから新規ワークスペースを初期化する機能
- **共有 workspace**: URL からリモートワークスペースを開く機能
- **dirty タブの確認ダイアログ**: 切替時に未保存タブを `console.warn` で記録するのみ (ユーザー確認は未実装)

---

## 付録: ソースファイル対照表

| spec 節 | 実装ファイル |
|---------|------------|
| 用語定義 / lockdown state | `backend/src/workspaceState.ts:1-97` |
| recent 永続化 / write lock | `backend/src/recentStore.ts:1-193` |
| inspect / initializeWorkspace / autoActivate | `backend/src/workspaceInit.ts:1-240` |
| WS リクエストハンドラ | `backend/src/wsBridge.ts:671-801` |
| MCP tools 定義 | `backend/src/tools.ts:1233-1284` |
| root スナップショット規約 | `backend/src/projectStorage.ts:14-104` |
| フロントエンドストア | `frontend/src/store/workspaceStore.ts:1-190` |
| WorkspaceIndicator | `frontend/src/components/workspace/WorkspaceIndicator.tsx:1-204` |
| WorkspaceListView | `frontend/src/components/workspace/WorkspaceListView.tsx:1-586` |
| WorkspaceSelectView | `frontend/src/components/workspace/WorkspaceSelectView.tsx:1-217` |
| redirect / cleanup / splash | `frontend/src/components/AppShell.tsx:76-423` |
| CommonHeader への配置 | `frontend/src/components/CommonHeader.tsx:1-30` |

## 改訂履歴

- 2026-05-06: workspace folder 構造を root + dataDir に分離。`project.json` → `harmony.json` rename。`harmony.v3.schema.json` スキーマ新設。シリーズ #849-#854 (PR #856) で統合実施。
