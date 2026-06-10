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
| `<dataDir>/page-layouts/<id>.components.html` | GrapesJS design payload が `componentsRef` を使う場合の HTML companion (#1448) |
| `<dataDir>/screens/<id>.json` | Screen entity (purpose / pageLayoutId / processFlowId / items 等) |
| `<dataDir>/screens/<id>.design.json` | Screen の GrapesJS / Puck design payload |
| `<dataDir>/screens/<id>.components.html` | GrapesJS design payload が `componentsRef` を使う場合の HTML companion (#1448) |
| `harmony.json` | `entities.pageLayouts[]` + `entities.screens[]` (ScreenEntry に purpose / pageLayoutId / hasDesign を含む) |

## 4. region 命名規約

予約名 (推奨):
- `header` — 最上部、グローバルヘッダ
- `sidebar` — 左右いずれかのナビゲーション
- `footer` — 最下部、コピーライト等
- `main` — content slot、page Screen 本文が嵌まる位置

UI では既存データ互換の alias として `content` も content slot 扱いにする。ただし schema / spec 上の canonical 予約名は `main` とし、新規 PageLayout pattern は `main` を生成する。

任意追加名も許容 (例: `breadcrumb` / `notification` / `subHeader`)。pattern: `^[a-z][a-zA-Z0-9_-]*$`

## 5. Routing (frontend)

| URL | コンポーネント | tab |
|-----|----------------|-----|
| `/page-layout/list` | `PageLayoutListView` | singleton |
| `/page-layout/edit/:pageLayoutId` | `PageLayoutEditor` (レイアウトマネージャ) | per-resource |
| `/page-layout/design/:pageLayoutId` | 互換 redirect → `/page-layout/edit/:pageLayoutId` | なし |
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

**design payload routing** (legacy):
- `loadScreen` / `saveScreen` で `screenId.startsWith("page-layout:")` を検出した場合、`<dataDir>/page-layouts/<id>.design.json` に routing する互換経路が残る。
- 新しい PageLayout UI は PageLayout 自身の design payload を primary source とせず、`regions[]` / `assignments` とレイアウトパターンから read-only 合成プレビューを表示する。

## 8. Designer 連携

### 8.1 PageLayout Manager (`/page-layout/edit/:id`)

- PageLayout は GrapesJS / Puck の自由編集対象ではなく、レイアウトマネージャで定義する。
- レイアウトパターン (`header-main-footer` / `header-sidebar-main-footer` 等) を選び、`regions[]` を生成・調整する。
- `main` は content slot として固定し、PageLayout 側では具体的な page Screen ID を保存しない。
- `header` / `sidebar` / `footer` 等の固定 region には `Screen{purpose:"gadget"}` のみ割り当てる。
- 合成プレビューでは assignments で指定された gadget design HTML と、任意に選択した sample page Screen の design HTML を read-only 表示する。design HTML を取得できない場合は Screen 名 / ID の fallback 表示にする。
- Gadget / page Screen 本体の編集は `/screen/design/:screenId` で行う。

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

## 13. Code Generation (Phase 2、pl-7 #1028 完了)

PageLayout + Gadget の code generation 対応を pl-7 (#1028) で実装。`/generate-code` skill が以下を生成する。

| 入力 entity | Thymeleaf 系 出力 | Next.js 系 出力 |
|---|---|---|
| PageLayout (passive layout) | `templates/layouts/<id>.html` (`layout:fragment="layout-content"` + region slot) | `app/components/layouts/<id>.tsx` (Custom AppLayout、Server Component、4 region slot) |
| Gadget (`Screen.purpose=gadget`) | `templates/fragments/<id>.html` (`th:fragment="gadget"`) + `<id>GadgetController.java` (events ありなら `@PostMapping` action 配線) | `app/components/gadgets/<id>.tsx` (events ありなら `'use client'`、なしは Server Component) + `app/api/gadgets/<id>/<actionId>/route.ts` (Route Handler) |
| Page Screen (`Screen.purpose=page` + `pageLayoutId`) | `templates/pages/<path>.html` (Layout Decorate モード = `layout:decorate` + `<th:block layout:fragment="layout-content">`) | `app/<path>/page.tsx` (Layout Wrap モード = `<AppLayout>{children}</AppLayout>`) |

検証 (examples/retail を題材に Docker 経由で実機):
- Thymeleaf 系: maven build pass + Spring Boot 起動 1.4 秒 + curl / HTTP 200 + 4 region + 日本語表示 + Layout Decorate slot 注入 全 OK
- Next.js 系: npm install + next build pass (4 routes) + npm start + curl /dashboard HTTP 200 + 4 region + 日本語表示 + 307 redirect from / 全 OK

詳細テンプレ規約: `ai-skills/generate-code/templates/frontend/<framework>/{LAYOUT,FRAGMENT,COMPONENT,PAGE}.md`。
region → CSS class マッピング: [`css-framework-switching.md § 8`](css-framework-switching.md)。
生成物例: `examples/retail/generated/{thymeleaf,nextjs}/`。

未実装 (将来):
- inter-gadget event (検索フィルタガジェット ↔ リストガジェット pub/sub) — pl-Y 候補、dogfood で需要が明確化してから着手
- 全画面の code generation 自動回し (現在は 1 entity ずつ skill 起動) — 別 ISSUE 候補

## 14. AGENTS.md Routing 表への反映

`AGENTS.md` § Routing の URL 規約表に追加 (`feat/page-layout-series` で更新):

```
| `/page-layout/list` | PageLayoutListView | ページレイアウト一覧 | ✅ singleton |
| `/page-layout/edit/:pageLayoutId` | PageLayoutEditor | ページレイアウト編集 | ✅ per-resource |
| `/page-layout/design/:pageLayoutId` | PageLayoutDesigner | ページレイアウト Designer | ✅ per-resource |
| `/gadget/list` | GadgetListView | ガジェット一覧 (purpose=gadget filter) | ✅ singleton |
```
