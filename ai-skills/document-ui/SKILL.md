---
name: document-ui
description: "Harmony の UI 各画面の操作リファレンス (docs/user-guide/ui-reference/) を、Playwright MCP screenshot + a11y snapshot を使って自動生成・更新する。引数なし = 全画面網羅。`<screen-key>` 指定で 1 画面のみ更新可能。発動条件: ユーザーが UI ドキュメント (操作マニュアル / 画面リファレンス / screenshot 付き使い方) の作成・更新を明示的に依頼した時のみ。spec / schema / code generation の説明依頼では起動しない。"
argument-hint: "[<screen-key>] (省略時は全画面、例: /document-ui dashboard で Dashboard のみ更新)"
---

<!--
  使い方:
    - `/document-ui` で全画面 (routing 表のタブ対象 28 画面) を網羅
    - `/document-ui <screen-key>` で 1 画面のみ更新 (例: dashboard / process-flow-editor)
    - 出力: docs/user-guide/ui-reference/<screen-key>.md + docs/ui-screenshots/ui-reference/<screen-key>/*.png
    - 配布: docs-site rebuild で docs/html/user-guide/ui-reference/ に HTML 生成

  目的:
    - エンドユーザー向け UI 操作マニュアルを spec / schema 起点ではなく実機 UI から生成
    - UI 変更時に再実行すれば screenshot + 主要操作の差分が出る (regression 検出にも転用可)

  発動制御:
    - **明示呼び出し** `/document-ui` を優先
    - 自動起動は description 末尾の絞り込み条件 (UI ドキュメント作成・更新依頼) を満たす場合のみ
    - 「画面の使い方を教えて」「この機能は何?」等の単純な質問では起動しない (Read で既存 md を参照すれば足りる)
    - spec / schema の説明、code-generation skill の出力説明では起動しない
-->

Harmony の UI 各画面の操作リファレンスドキュメントを生成・更新します。引数: `$ARGUMENTS` (省略時は全画面)。

## 前提

以下が満たされていない場合は **着手前にユーザーに報告して止まる** (AI が勝手に立てない、`feedback_no_ai_managed_dev_server.md`):

1. backend dev server が `http://localhost:5179/mcp` で起動済み
2. frontend dev server が `http://localhost:5173` で起動済み
3. active workspace が `workspaces/dogfood-uidoc-YYYYMMDD/` または retail データを含む workspace

確認方法 (1 つでも fail なら停止):

```bash
curl -sf -o /dev/null -w '%{http_code}' http://localhost:5173 || echo "frontend not running"
curl -sf -o /dev/null -w '%{http_code}' http://localhost:5179 || echo "backend not running"
```

ユーザーへの依頼文 (定型):

```
UI ドキュメント生成には dev server が必要です。以下のコマンドを実行して起動してください
(canonical: root から npm workspaces で起動、PR #1400):
  1. ターミナル A (backend): `npm run backend`
  2. ターミナル B (frontend): `npm run frontend`
subdir で `cd backend && npm run dev` / `cd frontend && npm run dev` も等価です。
起動完了後 ("ready in XXX ms" 表示後) に再度本コマンドを呼んでください。
```

## 画面カテゴリと screen-key 一覧 (canonical、AGENTS.md routing 表と整合)

`docs/user-guide/ui-reference/README.md` の index と機械的に対応する。新規 route 追加時は本表 + README + skill 内ループ対象を同時更新。

### A. ダッシュボード・全体俯瞰 (シングルトン)

| screen-key | route | コンポーネント | 種別 |
|---|---|---|---|
| `dashboard` | `/` | DashboardView | singleton |
| `screen-flow` | `/screen/flow` | FlowEditor | singleton |
| `er-diagram` | `/table/er` | ErDiagram | singleton |
| `generic-definition-catalog` | `/generic-definition` | GenericDefinitionCatalogView | singleton |
| `conventions-catalog` | `/conventions/catalog` | ConventionsCatalogView | singleton |

### B. リソース一覧 (シングルトン)

| screen-key | route | コンポーネント |
|---|---|---|
| `screen-list` | `/screen/list` | ScreenListView |
| `table-list` | `/table/list` | TableListView |
| `process-flow-list` | `/process-flow/list` | ProcessFlowListView |
| `sequence-list` | `/sequence/list` | SequenceListView |
| `view-list` | `/view/list` | ViewListView |
| `view-definition-list` | `/view-definition/list` | ViewDefinitionListView |
| `page-layout-list` | `/page-layout/list` | PageLayoutListView |
| `gadget-list` | `/gadget/list` | GadgetListView |

### C. リソース個別エディタ (per-resource)

| screen-key | route | コンポーネント | 想定リソース ID |
|---|---|---|---|
| `screen-designer` | `/screen/design/:id` | Designer (GrapesJS) | retail の主要 screen |
| `screen-items` | `/screen/items/:id` | ScreenItemsView | 同上 |
| `table-editor` | `/table/edit/:id` | TableEditor | retail の主要 table |
| `process-flow-editor` | `/process-flow/edit/:id` | ProcessFlowEditor | retail の主要 flow |
| `sequence-editor` | `/sequence/edit/:id` | SequenceEditor | retail の主要 sequence |
| `view-editor` | `/view/edit/:id` | ViewEditor | retail の主要 view |
| `view-definition-editor` | `/view-definition/edit/:id` | ViewDefinitionEditor | retail の主要 view-definition |
| `page-layout-editor` | `/page-layout/edit/:id` | PageLayoutEditor | retail の主要 page-layout |
| `page-layout-designer` | `/page-layout/design/:id` | PageLayoutDesigner | 同上 |
| `generic-definition-list` | `/generic-definition/:kind` | GenericDefinitionListView | kind 単位 (1 件目) |
| `generic-definition-editor` | `/generic-definition/:kind/:name` | GenericDefinitionEditor | retail の主要 generic-def |

### D. 設定・管理 (シングルトン)

| screen-key | route | コンポーネント |
|---|---|---|
| `extensions` | `/extensions` | ExtensionsPanel |
| `tech-stack` | `/project/tech-stack` | TechStackView |
| `workspace-list` | `/workspace/list` (top-level) | WorkspaceListView |
| `ai-settings` | `/ai-settings` (top-level) | CodexSettingsView |

合計: 28 画面 (AGENTS.md Routing 表のタブ対象 = 28 件と一致、route only の `/workspace/select` は対象外)。

## 手順

### Step 0: 前提確認 + screen-key 解決

1. 上記「前提」を満たすか確認 (満たさなければ停止)
2. `$ARGUMENTS` が空 → 全 screen-key を対象
3. `$ARGUMENTS` が screen-key → 1 件のみ対象 (一覧に無ければエラー終了)
4. workspaces/ 配下に dogfood-uidoc-YYYYMMDD/ が無い場合は user に確認後コピー作成:
   ```bash
   cp -r examples/retail/* workspaces/dogfood-uidoc-$(date +%Y%m%d)/
   ```
5. WorkspaceSelectView で対象 workspace を active にする (Playwright で navigate して click)

### Step 1: 各 screen-key について以下をループ

#### 1-A: navigate + a11y snapshot 取得

```
mcp__playwright__browser_navigate → http://localhost:5173/w/<wsId>/<route>
mcp__playwright__browser_wait_for → 主要要素 (ヘッダー / 一覧 / canvas) 描画完了
mcp__playwright__browser_snapshot → a11y tree 取得 (主要 button / link / input を抽出)
```

per-resource 画面 (`:id` 含む) は dogfood workspace から代表的なリソースを 1 つ選んで navigate (`workspaces/dogfood-uidoc-YYYYMMDD/screens/*.json` 等を ls → 1 件目を id に展開)。

#### 1-B: screenshot 撮影

```
mcp__playwright__browser_take_screenshot → 保存先:
  docs/ui-screenshots/ui-reference/<screen-key>/01-default.png
```

主要状態が 2 つ以上ある画面 (例: 一覧の card view / table view、editor の expanded / collapsed) は追加で `02-<state>.png` を撮影。

#### 1-C: md ファイル生成

`docs/user-guide/ui-reference/<screen-key>.md` を以下テンプレートで作成:

```markdown
# <画面の表示名>

> **対象画面**: `<コンポーネント名>` (`frontend/src/...`)
> **ルート**: `<route>`
> **種別**: シングルトン / per-resource

## 概要

<この画面で何ができるか、設計者・利用者は何を達成するためにここに来るか、2-4 文>

## 到達経路

- HeaderMenu → `<メニュー名>` (ある場合)
- 他画面からの遷移: <一覧 → 編集など、ある場合>
- 直接 URL: `<route>`

## 画面構成

![<画面の表示名> (default)](../../ui-screenshots/ui-reference/<screen-key>/01-default.png)

### 主要エリア

1. **<エリア名>** — <何を表示・何を操作するか>
2. ...

(必要に応じて screenshot を追加: `02-<state>.png` 等)

## 主要操作

| 操作 | 手段 | 結果 |
|---|---|---|
| <例: 新規追加> | <例: 右上「+」ボタン> | <例: 編集画面が開く> |

## データ前提

- <空状態で何が見えるか>
- <意味のあるデータが入っている時に何が見えるか>
- <この画面を活かすには事前に何が必要か (例: テーブル定義がある状態で初めて ProcessFlow Editor が活きる)>

## 関連仕様書

- [`docs/spec/<関連 spec>.md`](../../spec/<関連 spec>.md) — <一言補足>

## 関連 skill

- `/create-flow` — <この画面で扱うリソースを AI が作成する skill> など

## 既知の制約・注意

- <あれば>
```

#### 1-D: 説明文生成のヒント (AI 用)

a11y snapshot から自動抽出できる要素:

- ヘッダー / nav / menu の text → 「主要操作」表の「手段」列に展開
- button label / link label → 同上
- form field の label / placeholder → 「主要操作」表に展開
- table の column header → 「主要エリア」の表記に活用

a11y では取れない情報 (画面の **目的・データ前提・典型ワークフロー**) は、対応するコンポーネントを `frontend/src/components/<area>/<Component>.tsx` で Read して JSDoc / コメント / 主要 prop から推察。推察できない場合は **空欄 + TODO コメントを残す** (適当に書かない、`feedback_no_silent_test_modification.md` の精神)。

### Step 2: index 更新

全画面 (または対象画面) を生成後、`docs/user-guide/ui-reference/README.md` を再生成:

- カテゴリ別 (A/B/C/D) に画面を並べ、各画面の link + 1 行説明
- 新規追加 / 変更 / 削除があれば diff を確認

### Step 3: docs-site rebuild

```bash
cd docs-site && npm run build
```

成功確認:

- `docs/html/user-guide/ui-reference/` 配下に対象画面の HTML が生成されている
- screenshot 相対 path が HTML で正しく resolve できる (file:// で開いてリンク確認)

### Step 4: 完了報告

ユーザーに以下を報告:

- 生成 / 更新した screen-key の一覧
- 各画面の screenshot 枚数
- a11y snapshot で取得できなかった部品 (TODO 残しがあれば明示)
- 想定と違う UI 挙動を見つけた場合は **ISSUE 起票** を提案 (鉄則 0、放置禁止)

## 既知の落とし穴

- **シングルトン画面でも `/w/:wsId/` prefix が必要** — `WorkspaceSelectView` (`/workspace/select`) と `/ai-settings` 以外は workspace 配下
- **`screen-designer` (GrapesJS) の iframe 内 canvas は a11y tree に出ない** — 内部要素の説明は別 frame に切り替えるか、TableEditor 等の通常 DOM 画面と書き分ける
- **`screen-flow` (ReactFlow) は drag-drop が必要** — 静的 screenshot だけでは操作説明が薄くなる、操作録画 GIF は本 PoC では対象外 (将来検討)
- **空 workspace でも撮影してしまうと意味のない画面が並ぶ** — dogfood-uidoc-* workspace が active になっているか必ず確認
- **Playwright MCP screenshot のデフォルト保存先** — 何も指定しないと CWD に出力されるため、必ず file_path 引数で `docs/ui-screenshots/ui-reference/<screen-key>/*.png` を明示

## 関連 memory / spec

- `feedback_tmp_file_placement.md` — 一時 screenshot は `.tmp/screenshots/` (生成完成版は `docs/ui-screenshots/`)
- `feedback_no_ai_managed_dev_server.md` — dev server は AI が立てない
- `feedback_browser_smoke_headless_chrome_devtools.md` — Playwright MCP の罠
- `docs/spec/list-common.md` / `docs/spec/multi-editor-puck.md` / `docs/spec/page-layout.md` — UI 仕様
- AGENTS.md の "Routing" 表 — screen-key と route の対応の正本
