# PageLayout + Gadget 仕様

RFC #1021 で導入された **共通レイアウト機能** の仕様書。schemas/v3/page-layout.v3.schema.json と本ドキュメントを並行参照すること。

## 1. 目的

採用プロジェクトからの要望で、Harmony を使う業務アプリで「共通ヘッダ / フッタ / サイドバー」「ナビ」「メッセージ表示」等の **layout 横断部品** を first-class artifact として扱う仕組みを提供する。

## 2. モデル E (採用設計)

### 2.1 中核概念

```
PageLayout (新 entity 1 種)
├ regions: header / sidebar / footer / main (=content slot) など
├ assignments: regionName → gadget Screen ID
├ processFlowId?: ガジェット間連携 orchestrator (optional)
└ design: editorKind / cssFramework / designFileRef? / puckDataRef?

Screen (既存拡張)
├ purpose: "page" | "gadget"
├ pageLayoutId?: PageLayout 参照 (purpose=page のみ意味)
├ processFlowId?: Screen 専用 ProcessFlow (#1019/#1020 整合)
└ path: purpose=page で required (conditional via if-then)

ProcessFlow (既存、無変更)
└ page / gadget / PageLayout のいずれにも紐付け可
```

### 2.2 ガジェット = 自律ユニット

- ガジェット (`Screen{purpose: "gadget"}`) は **自身の design + items + ProcessFlow + handler** を持つ
- Thymeleaf 大規模パターン (各 fragment が専用 controller を持つ) を踏襲
- 例: ヘッダガジェットの logoutButton は header gadget の専用 ProcessFlow.act-logout を呼ぶ

### 2.3 PageLayout は本質 passive

- 横断的 context (`@session.*` / `@project.*` / i18n / CSRF) は **HTTP request / session に紐づく** ため PageLayout は context を宣言しない
- PageLayout.processFlowId は **ガジェット間連携** (例: 検索フィルタガジェット change → リストガジェット refresh) のみに使用、optional
- MVP では schema 上に optional 枠を用意するだけ、実装は Phase 2

## 3. データ配置

| ファイル | 役割 |
|---------|------|
| `<dataDir>/page-layouts/<id>.json` | PageLayout entity 本体 (regions / assignments / design 参照) |
| `<dataDir>/page-layouts/<id>.design.json` | PageLayout 自身の GrapesJS / Puck design payload (任意) |
| `<dataDir>/screens/<id>.json` | Screen entity (purpose / pageLayoutId / processFlowId / items 等) |
| `<dataDir>/screens/<id>.design.json` | Screen の GrapesJS / Puck design payload |
| `harmony.json` | `entities.pageLayouts[]` + `entities.screens[]` (ScreenEntry に purpose / pageLayoutId / hasDesign を含む) |

## 4. region 命名規約

予約名 (推奨):
- `header` — 最上部、グローバルヘッダ
- `sidebar` — 左右いずれかのナビゲーション
- `footer` — 最下部、コピーライト等
- `main` — content slot、page Screen 本文が嵌まる位置

任意追加名も許容 (例: `breadcrumb` / `notification` / `subHeader`)。pattern: `^[a-z][a-zA-Z0-9_-]*$`

## 5. Routing (frontend)

| URL | コンポーネント | tab |
|-----|----------------|-----|
| `/page-layout/list` | `PageLayoutListView` | singleton |
| `/page-layout/edit/:pageLayoutId` | `PageLayoutEditor` | per-resource |
| `/page-layout/design/:pageLayoutId` | `PageLayoutDesigner` | per-resource |
| `/gadget/list` | `GadgetListView` (Screen filter for purpose=gadget) | singleton |
| `/screen/list` | 改修: purpose=page のみ表示 | singleton |
| `/screen/flow` | 改修: purpose=page のみ ReactFlow に描画 | singleton |
| `/screen/edit/:screenId` | 改修: purpose=page の場合に pageLayoutId 選択フィールド表示 | per-resource |
| `/screen/design/:screenId` | 改修: pageLayoutId 設定時に composition preview modal | per-resource |

## 6. Backend MCP tools (6 種完備)

| MCP tool | 用途 |
|----------|------|
| `designer__list_page_layouts` | 一覧取得 |
| `designer__add_page_layout` | 新規追加 (PageLayoutEntry meta も更新) |
| `designer__get_page_layout` | id 指定で完全定義取得 |
| `designer__update_page_layout` | 完全定義で更新 (meta も同期) |
| `designer__save_page_layout` | AI 連携用、柔軟保存 |
| `designer__remove_page_layout` | 削除 + meta 削除 |

加えて、Screen MCP tools を拡張:
- `designer__add_screen` に `purpose` 引数
- `designer__update_screen` に `purpose` / `pageLayoutId` 引数 (pageLayoutId='' or null で解除)
- `designer__list_screens` に `purpose` フィルタ引数

## 7. WebSocket Bridge

- `loadPageLayout` / `savePageLayout` / `deletePageLayout` / `listAllPageLayouts`
- broadcast: `pageLayoutChanged` (data: { pageLayoutId } or { pageLayoutId, deleted: true })

**design payload routing** (Codex A-2 対応):
- `loadScreen` / `saveScreen` で `screenId.startsWith("page-layout:")` を検出した場合、`<dataDir>/page-layouts/<id>.design.json` に routing する。これは PageLayoutDesigner が Designer の synthetic id を流用するための bridge。

## 8. Designer 連携

### 8.1 PageLayout Designer (`/page-layout/design/:id`)

- GrapesJS の場合: `frontend/src/grapes/blocks.ts` の "Layout Regions" カテゴリで `region-header` / `region-sidebar` / `region-footer` / `region-main` の 4 ブロック (各 `data-region-name` 属性付き) を canvas に drag
- Puck の場合: Region primitive (`frontend/src/puck/primitives/Region{Header,Sidebar,Footer,Main}.tsx`) を Puck Config に register
- runtime composition preview: 各 region に assignments で指定された gadget の design HTML / Puck data を read-only inject

### 8.2 Page Screen Designer (`/screen/design/:id`、purpose=page)

- `pageLayoutId` 設定時に上部にバナー「ページレイアウトを使用中: <name>」
- バナーの「composition プレビューを開く」ボタンで modal 起動 → PageLayout 外枠 + 各 region の gadget + main slot に Screen 本文 を iframe (Bootstrap CDN 込み) で完全描画

### 8.3 editorKind / cssFramework ミスマッチ警告

PageLayout と Screen の editorKind / cssFramework が異なる場合、Designer 上部に warning banner を表示 (runtime composition が動作しない可能性を通知)。

## 9. AJV cross-entity validator (`validate-samples.ts`)

- `assignments[region]` で参照される Screen が `purpose: "gadget"` であることをチェック
- `assignments` のキーが PageLayout の `regions[].name` に存在することをチェック (typo 検出)
- Screen の `pageLayoutId` が PageLayout に実在することをチェック (PageLayout 0 件でも検出)

## 10. Migration (旧サンプル対応)

`scripts/migrate/page-layout-purpose.ts`:
- 既存 Screen 全件に `purpose: "page"` を一括付与
- `--dry-run` オプションで変更内容を事前確認
- 同一 path を持つ複数 Screen の重複を事前検出 → 重複時 abort
- rollback 手順は script header コメント参照

## 11. 既存仕様との整合

- [`docs/spec/multi-editor-puck.md`](multi-editor-puck.md): editorKind / cssFramework は作成時固定、PageLayout でも同方針
- [`docs/spec/edit-session-draft.md`](edit-session-draft.md): `DraftResourceType` に `"page-layout"` 追加、lock / draft 管理は他 entity と同様
- [`docs/spec/draft-state-policy.md`](draft-state-policy.md): PageLayout も maturity (draft / reviewing / committed) を持ち、5 原則 (保存可能 + UI 警告) を継承
- [`docs/spec/list-common.md`](list-common.md): PageLayoutListView / GadgetListView は DataList + ViewModeToggle + FilterBar の共通基盤を使用
- #1019 / #1020: 「1 画面 = 1 処理フロー + 複数アクション」モデル — gadget Screen + ProcessFlow + ScreenItemEvent.handlerActionId の 1:1 紐付け

## 12. 既知の制限 (本 PR でも残る)

- `screen-layout.v3` (画面フロー UI 座標) と `page-layout.v3` の命名類似 — 後者は本ドキュメント、前者は `docs/spec/schema-v3-design.md` を参照
- Puck composition の nested render は React Context 経由で `<Render>` を呼ぶ実装 (循環依存回避)。@measured/puck の Render に制約がある場合 fallback で概要表示
- GrapesJS composition preview は gadget design HTML を read-only inject するが、CSS scope は wrapper 内に閉じるため Bootstrap class が必要なケースで visual が崩れる可能性あり (preview modal は iframe 内で CDN を読み込んで補正)

## 13. AGENTS.md Routing 表への反映

`AGENTS.md` § Routing の URL 規約表に追加 (`feat/page-layout-series` で更新):

```
| `/page-layout/list` | PageLayoutListView | ページレイアウト一覧 | ✅ singleton |
| `/page-layout/edit/:pageLayoutId` | PageLayoutEditor | ページレイアウト編集 | ✅ per-resource |
| `/page-layout/design/:pageLayoutId` | PageLayoutDesigner | ページレイアウト Designer | ✅ per-resource |
| `/gadget/list` | GadgetListView | ガジェット一覧 (purpose=gadget filter) | ✅ singleton |
```
