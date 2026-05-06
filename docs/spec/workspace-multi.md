# マルチワークスペース対応仕様 (workspace-multi)

PR #679 シリーズで導入する「同時複数ワークスペース対応」の正規仕様。
本書は v1 仕様 [workspace.md](workspace.md) の拡張 (v2) として位置付ける。

---

## 1. 背景

PR #676 (workspace v1) では「1 サーバ = 1 active workspace」を原則とし、`docs/spec/workspace.md` 8.1 で同時複数 workspace 対応を「将来対応」と明記した。

#683 シリーズ (サーバ側 draft 管理 + 全エディタ明示保存) の完了により、localStorage がほぼ廃止されサーバ側の `data/.drafts/` に作業コピーを保持するモデルへ移行した。これにより #679 の設計が大幅に簡素化され、本書で再構成した v2 設計を確定する。

具体的な変化点:
- v1 では「1 サーバ = 1 active」が原則
- #683 で localStorage 依存がほぼ消え、サーバ側 draft 管理導入
- 本仕様 (v2) で per-session active state + URL への wsId 埋め込みを導入し、ブラウザタブ単位で独立した active workspace を持てるようにする

---

## 2. 用語定義 (v1 からの追加・変更)

v1 用語定義は [workspace.md § 1](workspace.md) を参照。本書は差分のみ定義する。

| 用語 | 説明 |
|------|------|
| connection / clientId | WS 接続 1 本 (= ブラウザタブ 1 つ) または MCP セッション 1 つ。`wsBridge` が払い出す文字列 ID |
| per-session active workspace | connection ごとに独立して持つ active workspace。v1 の global active に代わる |
| wsId | recent エントリの `workspace.id` (UUID)。URL に埋め込まれ、broadcast の宛先絞り込みキーになる |
| ConnectionContext | `{ clientId, activePath, lockdown }` の 3 フィールドを持つ per-session state オブジェクト |
| WorkspaceContextManager | `Map<clientId, ConnectionContext>` を管理する backend クラス |
| VSCode モデル | 1 ブラウザタブ = 1 active workspace。切替時はアプリタブ全 close → 新 wsId URL navigate。並行編集は新ブラウザタブで行う |

---

## 3. URL 設計 (D-1)

### 3.1 新 URL 規約

全ページ URL に wsId を埋め込む: `/w/:wsId/<元ページパス>`

| 旧 URL | 新 URL (例) |
|--------|-------------|
| `/screen/list` | `/w/abc-123-uuid/screen/list` |
| `/table/edit/customer` | `/w/abc-123-uuid/table/edit/customer` |
| `/process-flow/edit/order-flow` | `/w/abc-123-uuid/process-flow/edit/order-flow` |

### 3.2 横断ページ (wsId なし)

workspace 一覧・選択画面は workspace-agnostic のため wsId を持たない:
- `/workspace/list` — ワークスペース一覧
- `/workspace/select` — ワークスペース選択 (フルスクリーン welcome)

### 3.3 Backward compat

**旧 URL の backward compat は実装しない。** リリース前のためブックマーク互換は考慮しない (`feedback_no_backward_compat_pre_release.md` と整合)。

### 3.4 リロード時の復元

1. URL の `:wsId` を `workspace.open(id=...)` で active 化
2. recent miss (該当 wsId がない) の場合は `/workspace/select` へ redirect

実装対象 PR: R-4 (#702)

---

## 4. タブと workspace の関係 (D-2、VSCode モデル)

### 4.1 1 ブラウザタブ = 1 active workspace

- 1 つのブラウザタブは常に 1 つの workspace のみを active として持つ
- ブラウザタブ内で並行に複数 workspace を表示することはできない
- 別 workspace を並行で見たい場合は **新ブラウザタブで開く**

### 4.2 ブラウザタブ内の workspace 切替フロー

1. WorkspaceIndicator のドロップダウンまたは `/workspace/list` から別 workspace を選択
2. アプリ側が現在のアプリタブを全 close (`clearPersistedTabs()` + `gjs-*` 削除)
3. 新 wsId の URL `/w/<新wsId>/<同じページ or デフォルト>` へ navigate
4. backend に `workspace.open(id=新wsId)` を request、broadcast 受信で active 復元

### 4.3 関連既存実装

現行 `frontend/src/components/AppShell.tsx:106-148` で「workspace 切替時に `clearPersistedTabs()` + `gjs-*` 削除 + `window.location.reload()`」を実装している。本仕様 (R-4) でこれを `reload()` → `navigate(新wsId URL)` に書き換える。

---

## 5. Backend per-session active state (D-3)

### 5.1 ConnectionContext

```ts
type ConnectionContext = {
  clientId: string;       // WS connection ID または MCP sessionId
  activePath: string | null;
  lockdown: boolean;      // global flag のコピー (env DESIGNER_DATA_DIR 由来)
};
```

`WorkspaceContextManager` が `Map<clientId, ConnectionContext>` を管理する。

### 5.2 ライフサイクル

| イベント | 処理 |
|----------|------|
| WS 接続時 | clientId 払い出し + context 作成。初期 `activePath` は `recent.lastActiveId` 由来 or null |
| WS 切断時 | `Map` から remove |
| MCP session | StreamableHttp の sessionId を clientId として同様に管理 |
| lockdown | env `DESIGNER_DATA_DIR` 設定時、全 context の `activePath` が env 値固定 |

### 5.3 公開 API の per-session 化

旧グローバル API から per-session API へ移行する:

| 旧 API | 新 API |
|--------|--------|
| `getActivePath()` | `getActivePath(clientId)` |
| `setActivePath(path)` | `setActivePath(clientId, path)` |
| `clearActive()` | `clearActive(clientId)` |
| `requireActivePath()` | `requireActivePath(clientId)` |

`recentStore` は global のまま (read/write は引き続き `withWriteLock` で直列化)。

### 5.4 projectStorage の per-session 化

`backend/src/projectStorage.ts` の全公開関数 entry で `requireActivePath(clientId)` を呼ぶ形に書き換える。

手順:
1. 関数開始時に `const root = requireActivePath(clientId)` で root スナップショット取得
2. 以降の全 I/O は `root` 変数に対して実施
3. これにより、操作中に workspace 切替が起きても書き込み先が分散しない (v1 の root スナップショット規約を per-session に拡張)

実装対象 PR: R-2 (#700)

---

## 6. Broadcast wsId scoping (D-4)

### 6.1 シグネチャ変更

```ts
broadcast({
  wsId: string | null,
  event: string,
  data: unknown,
  excludeClientId?: string
}) → void
```

`wsId` には actor session の `activePath` (絶対パス) を渡す。実装は以下:

- `wsId` が path 文字列 → `WorkspaceContextManager.getClientIdsByPath(wsId)` で同 path を active にしている session のみに配信 (= 同 workspace を見ているブラウザタブ)
- `wsId === null` → 全 active session に配信 (用途は § 6.3 で限定列挙)

通常の resource 系 broadcast (`screenChanged` / `tableChanged` 等) では `wsId: <actorActivePath>` を渡す。

### 6.2 対象 broadcast (全 workspace scoped)

すべての resource 系 broadcast は **wsId scoping 必須** (= 同 workspace を見ているセッションのみに配信)。

| event | 配信元 | 配信先 |
|-------|--------|--------|
| `workspace.changed` | `wsBridge.workspace.open` / `workspace.close` | actor の新 / 旧 activePath を持つ session |
| `projectChanged` | `project.json` 書換時 | actor activePath |
| `screenChanged` | screens 書込み / 削除 / リネーム時 | actor activePath |
| `screenItemsChanged` / `screenEntityChanged` | `screens/<id>.json#items[]` 書込み時 (Phase 4-β migration 後は screen entity に embed、#712) | actor activePath |
| `tableChanged` | tables 書込み / 削除時 | actor activePath |
| `processFlowChanged` | actions 書込み / 削除時 | actor activePath |
| `viewChanged` / `viewDefinitionChanged` | views / view-definitions 書込み時 | actor activePath |
| `sequenceChanged` | sequences 書込み時 | actor activePath |
| `extensionsChanged` | `extensions/*.json` 書込み時 (steps / fieldTypes / triggers / dbOperations / responseTypes) | actor activePath |
| `customBlocksChanged` | custom-blocks.json 書込み時 | actor activePath |
| `erLayoutChanged` / `screenLayoutChanged` | レイアウト保存時 | actor activePath |
| `conventionsChanged` | conventions/catalog.json 書込み時 | actor activePath |
| `draft.changed` | draft 作成 / 更新 / commit / discard 時 | actor activePath |
| `lock.changed` | lock 取得 / 解放 / 強制解除時 | actor activePath |

### 6.3 `wsId === null` (全配信) の用途

`wsId === null` は **設計上のフォールバック** であり、resource 系 broadcast で使ってはならない。現状の正当な用途:

- **全 session 通知系** が将来必要になった場合の予約 (例: server 再起動予告、global error)
- 現時点で実装側に該当ケースなし

resource 系で `wsId: null` を渡してしまうと、他 workspace を見ているブラウザタブに誤配信されてストア状態が汚染される。grep audit で `wsId: null` の混入を検知すること:

```bash
grep -rn 'wsId: null' backend/src/  # resource broadcast では 0 件であること
```

実装対象 PR: R-2 (#700) で導入、R-5 (#703) と post-merge 修正で全 broadcast を scoping 化完了 (2026-05-02)。

---

## 7. Draft の隔離 (D-5)

draft は **ワークスペース毎にファイルシステム上で物理隔離** される設計を採用する。実装上の path:

```
<workspace_root>/.drafts/<resourceType>/<id>.json
```

### 7.1 wsId path prefix を採用しない理由

メタ #679 / #683 D-12 では「global `data/.drafts/<wsId>/<resourceType>/<id>.json`」を想定していたが、以下の理由で **採用しない**:

- workspace folder が物理的な isolation 境界として既に機能している (path collision 不可能)
- workspace 削除時に draft も自然に消える (lifecycle の整合)
- enumeration の必要が生じれば path から workspace を辿れる (= 性能要件は workspace の中で完結)
- per-workspace 設計の方が単純で理解しやすい

### 7.2 migration

採用 path が **既存 (#683 PR-2 から)** と同一のため、**migration は発生しない**。

### 7.3 gitignore

- リポジトリ直下の `.gitignore` で `data/.drafts/` を ignore (legacy workspace = `<repo>/data/` 用)
- 各 workspace owner は **自身の workspace folder 内に `.drafts/` ignore ルール** を必要に応じて設定する責任がある (フレームワーク側では強制しない)

### 7.4 lockdown 互換

env `DESIGNER_DATA_DIR` 設定時、active workspace は env 値固定 (`<env_path>/.drafts/`)。他 workspace は存在しないので draft 隔離は自動的に成立。

### 7.5 onBehalfOfSession (#683 D-7) との関係

owner clientId と actor clientId が異なる場合でも、active workspace は actor (= MCP session) の context で解決される。draft path の隔離も actor の active workspace 単位。

実装対象 PR: R-3 (#701) — spec 修正のみ (実装は #683 PR-2 で導入済み)

---

## 8. Dirty 確認 / store 設計 (D-6)

### 8.1 Dirty 確認ダイアログ

#683 で **dirty マーク + draft 永続化** として達成済み。本シリーズでは追加対応なし。

- タブヘッダーの dirty マーク (●) は #683 で実装済み
- 強制ロック解除時の引継ぎ UI は #683 D-5 で実装済み

### 8.2 frontend store の ws-keyed 化

**不要。** AppShell が workspace 切替時に `clearPersistedTabs()` + navigate (R-4 で書き換え) するため、各 store は新 wsId で fresh に起動する。`Map<wsId, Store>` 構造の導入は本シリーズに含めない。

---

## 9. lockdown 互換

env `DESIGNER_DATA_DIR` 設定時の挙動:

| 項目 | 挙動 |
|------|------|
| 全 connection の `activePath` | env 値固定 (変更不可) |
| workspace 切替操作 | 全 session で `LockdownError` |
| broadcast | wsId scoping するが、lockdown 時は実質 1 つの wsId (`lockdown` 固定) のみ存在 |
| recent read/write | 完全 skip (v1 と同じ) |
| draft path | `data/.drafts/lockdown/<resourceType>/<id>.json` |

v1 の lockdown 仕様 ([workspace.md § 4](workspace.md)) と後方互換を保つ。

---

## 10. リスクマトリクス

| リスク | 影響度 | 対応 PR | mitigation |
|--------|--------|---------|------------|
| `requireActivePath` snapshot 規約の per-session 化漏れ → A workspace の操作が B に書込む | **致命** | R-2 | `projectStorage.ts` 全公開関数を audit、entry 時 `requireActivePath(clientId)` に置換、unit test で per-session 隔離検証 |
| broadcast 誤配信で別 workspace タブが reload | 高 | R-2 | wsId 必須化 + unit test で wsId フィルタ検証、grep で旧 broadcast 全件改修確認 |
| MCP agent session で workspace 切替が他 agent 巻き込み | 高 | R-2 | session 単位完全隔離 + test、`httpTransport.test.ts` 拡張 (2 MCP session で別 workspace open) |
| URL `/w/:wsId/` 切替時に AppShell guard が無限ループ | 中 | R-4 | initial hydration はリロードしない既存ガード (`AppShell.tsx:114-149`) を per-session 化、e2e で navigate チェック |
| draft path isolation | 低 | R-3 | per-workspace folder が物理 isolation 境界。migration 不要。workspace 隔離を unit test で確認 (#701) |
| lockdown 時の per-session 動作 | 中 | R-2/R-4 | env `DESIGNER_DATA_DIR` 設定時 test ケース追加、全 session の activePath が env 値固定であることを assertion |
| broadcast subscriber 多重登録 | 低 | R-5 | wsId 切替時に unsubscribe → subscribe しなおす |
| `recentStore` write の per-session 競合 | 低 | R-2 | global `withWriteLock` で従来通り直列化、active 切替の write は session 識別子と一緒に upsert |

---

## 11. テスト戦略

### 11.1 unit (vitest)

- per-session active 隔離: 2 clientId で別 workspace active → 各 `getActivePath(clientId)` が独立した値を返す
- broadcast wsId フィルタ: wsId が異なる session には配信されないことを unit test で検証
- `projectStorage` per-session スナップショット: in-flight 操作中の workspace 切替で書込み先が混在しないことを確認
- draft path 隔離: 2 clientId (別 workspace) で同一 id の draft を作成 → 互いに独立、削除も独立 (`draftStore.test.ts` — workspace 隔離 describe)
- URL `/w/:wsId/` parse: wsId 抽出と workspace.open への連携

### 11.2 integration (backend/src/httpTransport.test.ts 拡張)

- 2 MCP session で別 workspace open → 各 session が独立した active workspace を持ち、相互干渉しないことを検証

### 11.3 e2e (Playwright)

**R-4 向け:**
- 新 URL (`/w/:wsId/screen/list`) でリロード → workspace が正しく復元される
- ブラウザタブ内 workspace 切替 → アプリタブ全 close + 新 wsId URL navigate が起きる
- recent miss の wsId でアクセス → `/workspace/select` へ redirect

**R-5 向け:**
- 2 ブラウザタブで別 workspace を並行編集 → broadcast 隔離 (片方の保存でもう一方が reload しない)
- WorkspaceIndicator がブラウザタブごとに独立した active workspace 名を表示

---

## 12. マイグレーション

| 項目 | 対応 PR | migration 内容 |
|------|---------|----------------|
| 旧 URL → 新 URL | R-4 | **migration なし** (リリース前のためブックマーク互換不要) |
| 旧 draft path → 新 draft path | R-3 | **migration なし** (採用 path が #683 PR-2 導入時と同一。per-workspace folder が isolation 境界) |
| WS broadcast 引数追加 | R-2 | 既存呼び出し全件 grep + wsId 引数追加 |
| `getActivePath()` API 変更 | R-2 | 全呼び出し点を `getActivePath(clientId)` に書換 |

---

## 13. 関連 ISSUE / 仕様書

- 親仕様: [workspace.md](workspace.md) (v1)
- 前提シリーズ: #683 (サーバ側 draft 管理) / #690 (全エディタ migration)
- サーバ側 draft 管理詳細: [edit-session-draft.md](edit-session-draft.md)
- メタ ISSUE: #679
- 子 ISSUE: #699 (R-1 spec) / #700 (R-2 backend) / #701 (R-3 draft path) / #702 (R-4 URL) / #703 (R-5 UI)

---

## 付録: ソースファイル対照表 (R-2〜R-5 実装時の参照)

| 仕様節 | 実装ファイル (現状) | 改修 PR |
|--------|-------------------|---------|
| 5.1 ConnectionContext | `backend/src/workspaceState.ts:1-97` | R-2 |
| 5.4 projectStorage per-session | `backend/src/projectStorage.ts:1-104` | R-2 |
| 6 broadcast scoping | `backend/src/wsBridge.ts:671-801` | R-2 |
| 7 draft path 隔離 | `backend/src/draftStore.ts:35-47` (#683 PR-2 で導入済) | R-3 (spec 修正のみ) |
| 3 URL routing | `frontend/src/App.tsx` (Route 定義) | R-4 |
| 4.2 切替フロー | `frontend/src/components/AppShell.tsx:106-148` | R-4 |
| 4 WorkspaceIndicator | `frontend/src/components/workspace/WorkspaceIndicator.tsx` | R-5 |
| 6 broadcast subscriber | `frontend/src/store/workspaceStore.ts:163-190` | R-5 |
