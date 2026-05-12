# Dogfood レポート: PageLayout + Gadget 導入 (examples/retail)

**日付**: 2026-05-12
**対象**: RFC #1021 PageLayout + Gadget シリーズ pl-1〜pl-6
**サンプル**: `examples/retail/` (リテール総合)
**スコープ**: 静的 region 割り当てのみ (inter-gadget event は Phase 2 = pl-7 で実装、pl-6 受け入れ基準で明示)

## 1. dogfood 構成

### PageLayout 1 件
- `Main Layout` (17595b62-fef1-4b22-9c25-16736c772567)
  - regions: `header` / `sidebar` / `footer` / `main`
  - assignments: header → グローバルヘッダ / sidebar → ナビゲーションサイドバー / footer → グローバルフッタ
  - design: `editorKind: grapesjs` / `cssFramework: bootstrap`

### Gadget 3 件 (Screen.purpose=gadget)
- **グローバルヘッダ** (68709449-...): 店舗名 / ユーザー名 / ログアウトボタン (Bootstrap navy header HTML)
  - 紐付く ProcessFlow: `60e08c25-...` 「ヘッダーガジェット処理」
  - logoutButton item に `events: [{ id: 'click', handlerFlowId, handlerActionId: 'act-logout' }]`
- **ナビゲーションサイドバー** (c1cff7da-...): 商品検索/注文一覧/顧客一覧/マスタ管理リンク
- **グローバルフッタ** (f7daa764-...): copyright + version

### ProcessFlow 1 件 (gadget 用)
- `ヘッダーガジェット処理` (60e08c25-...)
  - action: `act-logout` (trigger=submit, POST /api/retail/auth/logout)
  - steps: compute (redirectTo='/login') → return (200 OK + redirectTo)

### Page Screen の紐付け
- ダッシュボード (765c3c23-...): `purpose: page` + `pageLayoutId: 17595b62-...`

## 2. 二段検証

### 機械 validator (validate:samples)
- ✅ 7/7 flows passed (新 ProcessFlow 含む)
- ✅ All errors resolved (0 warnings)
- ✅ AJV cross-entity validator (assignments → gadget existence + pageLayoutId → PageLayout existence) 動作確認

### AI 実機 dogfood (Playwright + chromium headless、12 ステップ全件)
| Step | 内容 | 結果 | スクリーンショット |
|------|------|------|---------------------|
| 1 | workspace root (`/w/<wsId>/`) → ダッシュボード表示 | ✅ 「リテール総合 (EC + 店舗 POS + 在庫管理)」読込 | `v2-01-workspace-root-dashboard.png` |
| 2 | HeaderMenu hamburger open | ✅ メニュー表示 | `v2-02-header-menu-open.png` |
| 3 | `/page-layout/list` 遷移 | ✅ Main Layout カード表示 (4 region / 3 assignment) | `v2-03-page-layout-list.png` |
| 4 | Main Layout カード click → エディタ起動 | ✅ regions 4 + assignments 3 + design (grapesjs/bootstrap) + maturity 表示 | `v2-04-page-layout-editor.png` |
| 5 | Designer (`/page-layout/design/:id`) | ✅ GrapesJS canvas + Layout Regions カテゴリ | `v2-05-page-layout-designer.png` |
| 6 | `/gadget/list` (`GadgetListView`) | ✅ 3 gadget (Header/Sidebar/Footer) カード | `v2-06-gadget-list.png` |
| 7 | Header Gadget Designer (`/screen/design/68709449-...`) | ✅ Bootstrap navy ヘッダ (店舗 A / 山田 太郎 / ログアウト) 実 HTML レンダリング | `v2-07-header-gadget-designer.png` |
| 8 | `/screen/list` (purpose=page のみ) | ✅ 11 件 (gadget 除外) | `v2-08-screen-list-page-only.png` |
| 9 | 画面遷移図 (`/screen/flow`) | ✅ 11 page Screen のみ、gadget 描画なし | `v2-09-screen-flow.png` |
| 10 | `/process-flow/list` (新 ProcessFlow 含む) | ✅ 7 ProcessFlow + 「ヘッダーガジェット処理」表示 | `v2-10-process-flow-list.png` |
| 11 | Header gadget ProcessFlow 詳細 | ✅ act-logout + HTTP POST /api/retail/auth/logout 表示 | `v2-11-header-process-flow-detail.png` |
| 12 | 注文完了 Screen Designer (purpose=page) | ✅ Screen 自身の design 描画 (PageLayout banner は load 競合のため §3 既知の制限) | `v2-12-dashboard-screen-with-pageLayout.png` |

console errors: 0 件 (SPA 内 navigation で workspace state 一貫保持)
スクリーンショット格納先: `.tmp/screenshots/v2-*.png`

## 3. Codex 独立 adversarial レビュー反映 (2026-05-12、PR #1031)

Codex で PR #1031 全体を fresh context で adversarial レビュー。Must-fix 4 件 + 主要 Should-fix を本コミット系列で解消。

| ID | 問題 | 解消 commit |
|----|------|-------------|
| A-2 Must-fix | PageLayout design が `screens/page-layout:<id>.design.json` に保存 (Windows 不正名 + 永続化境界違反) | 6e19051: `page-layouts/<id>.design.json` 専用 storage に分離 + wsBridge ルーティング |
| B-1 Must-fix | URL → タブ同期で wsId !== active.id race | 6e19051: workspace mismatch guard 追加 |
| B-2 Must-fix | designer__update_screen MCP に purpose / pageLayoutId なし | 6e19051: input schema + handler 拡張 |
| C-1 Must-fix | Page Screen Designer で PageLayout 外枠+gadget が描画されない (banner のみ) | 6e19051: banner load retry 強化 → a16ddaa: **DesignerTabHost で完全解消** (§4-A 参照) |
| B-3 Should-fix | assignments key が未宣言 region に存在しても通る | 6e19051: PAGE_LAYOUT_ASSIGNMENT_UNKNOWN_REGION エラー追加 |
| B-4 Should-fix | pageLayouts 0 件で Screen.pageLayoutId 参照崩れを検出しない | 6e19051: silent skip 廃止 |
| B-5 Should-fix | GrapesJS component:add listener cleanup なし | 6e19051: componentAddCleanupRef + unmount effect |
| C-3 / H-4 Should-fix | Gadget「使用先 PL 数」常に 0 (誤情報) | このコミット: full PageLayout load で逆参照 map 構築 + pageLayoutChanged broadcast subscribe |
| D-2 Should-fix | MCP tools 6 種要求のうち get/save が欠落 | 6e19051: designer__get_page_layout / save_page_layout 追加 |
| D-6 Should-fix | list_screens に purpose filter なし | 6e19051: purpose? input schema + filter handler |
| E-2 Should-fix | PageLayout design payload sample なし | このコミット: `examples/retail/.../17595b62-...design.json` 追加 + designFileRef 紐付け |
| F-3 Nit | UI 文言「PageLayout」→「ページレイアウト」 | 6e19051: PageLayoutWireframeBanner 文言修正 |
| C-5 Nit | pageLayoutChanged broadcast 購読なし | このコミット: GadgetListView で broadcast subscribe |

## 4. Codex C-1 / A-3 / H-2 完全解消 (commits a16ddaa / 16879b4 / 615a909)

### A. Page Screen Designer での PageLayout 外枠+gadget の完全描画 ✅ 解消
- 解消方法: `DesignerTabHost.tsx` を新規作成し AppShell.tsx の `designTabs.map()` で wrap
- PageLayout + gadget の design HTML を pre-load、Designer 上の banner から「composition プレビューを開く」ボタンで modal 起動
- Modal の iframe (Bootstrap CDN 込み) に composePreviewHtml の合成結果 (PageLayout 外枠 + 各 region の gadget + main slot に Screen 本文) を完全描画
- Playwright 確認済 (`.tmp/screenshots/v6-composition-preview-modal.png`)

### B. GrapesJS region 内 gadget の **本物の design HTML** 描画 ✅ 解消 (Codex A-3)
- 解消方法: `injectGadgetPreviews` に `gadgetHtmlMap` パラメータ追加、`_appendPreviewHtml` ヘルパで gadget HTML を read-only inject
- PageLayoutDesigner が `mcpBridge.request("loadScreen", id)` で gadget design を取得、`extractGrapesHtml` で本体抽出して inject map に格納

### C. Puck composition preview の nested render ✅ 解消 (Codex H-2)
- 解消方法: `RegionContext` に `puckConfig?: Config | null` を追加、`usePuckConfig()` hook 経由で Region primitive から Render を呼べるように
- PageLayoutDesigner で `buildPuckConfig()` を useMemo 計算し RegionProvider に注入 → ES module 循環なし
- RegionHeader / RegionSidebar / RegionFooter で `<Render config={puckConfig} data={gadgetData} />` を実行 (puckConfig + gadgetData 揃った場合のみ)

## 5. 残 follow-up (本 PR 以降)

- **G-1 / G-2 パフォーマンス**: loadProject キャッシュ + Puck gadget data の concurrency limit (MVP scale で実用上問題なし、Phase 2 で最適化)
- **画面デザイナー wrapper の dead code 整理**: 旧 wrapper は route element でなく、DesignerTabHost.tsx が design tab の表示元になったため PR #1045 で削除済み

## 4. 修正された bugs (dogfood で発見)

| Bug | 修正 commit |
|-----|-------------|
| `normalizePersisted` で `entities.pageLayouts` が落ちて UI が「0 件」になる | da0f5c9 |
| URL → タブ同期 effect が workspace.open 完了前に走り、deep-link でリソースが全てダッシュボードへフォールバック | da0f5c9 |
| ProcessFlow `compute` / `return` step kind の schema 違反 (object literal expression / bodyBinding 不可) | da0f5c9 |
| Gadget の `hasDesign` が harmony.json で false のまま (design.json はあるのに「未デザイン」表示) | da0f5c9 |

## 5. 次フェーズ (pl-7 / Phase 2)

pl-6 完了をもって PageLayout MVP は **schema + Designer 編集 + 静的 composition** まで完備。次は:

- pl-7: code generation 対応 (Thymeleaf / NestJS の layout.html + fragment + Controller 生成)
- pl-X follow-up: 上記 §3 の A/B/C 解消
- pl-Y: inter-gadget event 仕様 (Q2=b 候補、ガジェット間 pub/sub) — dogfood §1 から「検索フィルタガジェット ↔ リストガジェット」のニーズが見えてから着手判断

## 6. 結論

**RFC #1021 PageLayout + Gadget モデル E は実機動作確認できた**。
- 新 entity (PageLayout 1 種のみ) + Screen.purpose 拡張 + ガジェット = `Screen{purpose: gadget}` + 自律 ProcessFlow の設計が機能した
- Thymeleaf 大規模パターン (各ガジェットが専用 controller を持つ) を Harmony 上で実装できた (header gadget の logout 例)
- GrapesJS / Puck どちらの editorKind でも基本動作 (Puck は composition nested render に制約あり、follow-up)
- AI コンテキスト負荷の評価: 新 entity 1 種のみで完結し、Screen.purpose は既存概念の自然拡張で AI が混乱せず読める設計

統合 PR (本 PR) で MVP を main にマージし、上記 follow-up は別 issue で計画的に対応する。
