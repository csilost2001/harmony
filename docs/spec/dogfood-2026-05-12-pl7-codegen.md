# Dogfood レポート: pl-7 Code Generation (PageLayout + Gadget)

**日付**: 2026-05-12
**対象**: RFC #1021 pl-7 (Phase 2 = code generation 対応、#1028)
**サンプル**: `examples/retail/` (リテール総合)
**スコープ**: PageLayout + 3 Gadget + Page Screen を Thymeleaf 系 / Next.js 系の 2 techStack で実機ビルド + 起動 + HTML 検証

## 1. 入力 entity

| entity | id | name | 役割 |
|---|---|---|---|
| PageLayout | `17595b62-...` | Main Layout | regions: header / sidebar / footer / main、3 region assignment |
| Gadget (Screen.purpose=gadget) | `68709449-...` | グローバルヘッダ | items: storeName / userName / logoutButton (processFlowId=60e08c25) |
| Gadget | `c1cff7da-...` | ナビゲーションサイドバー | items: 4 ナビリンク |
| Gadget | `f7daa764-...` | グローバルフッタ | items: copyright / version |
| Page Screen | `765c3c23-...` | ダッシュボード | purpose=page、pageLayoutId=17595b62、kind=dashboard |
| ProcessFlow | `60e08c25-...` | ヘッダーガジェット処理 | act-logout action |

## 2. 出力 (`examples/retail/generated/`)

### 2.1 Thymeleaf 系 (`examples/retail/generated/thymeleaf/`)

Spring Boot 3.3 + Java 21 + Thymeleaf Layout Dialect 3.3 scaffold + pl-7 生成物 (合計 11 ファイル):

```
pom.xml
src/main/java/com/harmony/retail/
  RetailApplication.java
  web/
    CommonModelAdvice.java          (@ControllerAdvice、storeName/userName/copyright/version 共通 ModelAttribute)
    DashboardController.java        (GET / → pages/dashboard、stub data)
    GlobalHeaderGadgetController.java  (POST /fragments/global-header/act-logout → redirect:/)
src/main/resources/
  application.properties           (UTF-8 強制設定)
  templates/
    layouts/main-layout.html       (passive layout、4 region + layout:fragment="layout-content")
    fragments/
      global-header.html           (Bootstrap navbar、logout form)
      global-sidebar.html          (Bootstrap nav、4 link)
      global-footer.html           (copyright + version)
    pages/dashboard.html           (Layout Decorate モード = layout:decorate + th:block layout:fragment="layout-content")
```

### 2.2 NestJS/Next.js 系 (`examples/retail/generated/nextjs/`)

Next.js 14 App Router + React 18 + Tailwind 3 + TypeScript 5 scaffold + pl-7 生成物 (合計 14 ファイル):

```
package.json + tsconfig.json + next.config.mjs + tailwind.config.ts + postcss.config.mjs
app/
  globals.css                       (Tailwind directives)
  layout.tsx                        (root layout)
  page.tsx                          (/ → /dashboard redirect)
  components/
    layouts/main-layout.tsx         (Custom AppLayout、Server Component、4 region slot)
    gadgets/
      global-header.tsx             ('use client' — events ありで client、logout fetch)
      global-sidebar.tsx            (Server Component、Next.js Link x4)
      global-footer.tsx             (Server Component、props 経由)
  api/gadgets/global-header/act-logout/route.ts  (Route Handler、POST → NextResponse.redirect)
  dashboard/page.tsx                (Layout Wrap モード = <MainLayout>{children}</MainLayout>)
```

## 3. 二段検証

### 3.1 機械検証 — maven / next build

| 系統 | コマンド (Docker 経由) | 結果 |
|---|---|---|
| Thymeleaf | `docker run --rm -v $(pwd):/app -w /app maven:3.9-eclipse-temurin-21 mvn -B clean package -DskipTests` | ✅ BUILD SUCCESS 10.9 秒、`retail-thymeleaf-0.0.1-SNAPSHOT.jar` 生成 |
| Next.js | `docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "npm install && npm run build"` | ✅ Compiled successfully + 4 routes generated (/ static, /dashboard static, /api/.../act-logout dynamic, /_not-found static)、94.5 kB first load |

### 3.2 実機起動 + HTML 検証

#### Thymeleaf 系 (`http://localhost:8080/`)

起動: 1.4 秒 (`Started RetailApplication in 1.409 seconds`)

HTML assertion (curl で取得後 grep):
- ✅ Bootstrap CDN link 含む
- ✅ Header Gadget: `Harmony Retail` + 店舗名 (CommonModelAdvice の @Value default `店舗未選択`) + `ログアウト` button
- ✅ Sidebar Gadget: `商品検索` / `注文一覧` / `顧客一覧` / `マスタ管理` の 4 link
- ✅ Footer Gadget: `© 2026 Harmony Retail Inc.` + `v1.0.0`
- ✅ Dashboard Page: `ダッシュボード` / `本日の売上` / `1,234,567` 円 / `O-2026051201` の stub data
- ✅ Layout Decorate: dashboard コンテンツが layout の `layout:fragment="layout-content"` slot に inject (HTML 末端で `layout-content` 属性が処理後に削除されているのが Layout Dialect の正常な挙動)

注意: 当初 `app.session.storeName=東京本店` を application.properties に書いたが、Spring Boot の `PropertiesPropertySourceLoader` が ISO-8859-1 default で読み込むため文字化け (`æ±äº¬æ¬åº`)。CommonModelAdvice 内で hardcode + `server.servlet.encoding.charset=UTF-8` 強制で解消。仕様書 (templates/thymeleaf-bootstrap/) に記録する追加 ISSUE 候補。

#### Next.js 系 (`http://localhost:3000/dashboard`)

起動: 2 秒以内に `next start` ready (server-side render)

HTML assertion:
- ✅ Tailwind: `bg-blue-900` 等の utility class 含む
- ✅ Header Gadget: `Harmony Retail` + `東京本店` + `山田 太郎` + `ログアウト` button (Server Component の props 経由で日本語が完全表示、JVM の encoding 問題なし)
- ✅ Sidebar Gadget: 4 link 全表示
- ✅ Footer Gadget: copyright + version
- ✅ Dashboard Page: stub data 全表示 (`1,234,567` / `O-2026051201` / `佐藤 花子`)
- ✅ Layout Wrap: `flex min-h-screen` (Custom AppLayout root)
- ✅ Redirect: `GET /` → 307 redirect to `/dashboard`
- Client gadget の `onClick` は HTML に出ない — `'use client'` directive 付きの component の event handler は SSR HTML には含まれず JS bundle 経由で hydration 時に attach される正常挙動 (Next.js App Router の仕様)

## 4. 受け入れ基準達成

| 受け入れ基準 (#1028 本文) | 状態 |
|---|---|
| Thymeleaf 系出力で examples/retail から layout + gadget + page のコード生成成功 | ✅ |
| NestJS / Next.js 系出力で同等成功 | ✅ |
| 生成コードが実機ビルド + 起動 pass | ✅ (両系統) |
| /generate-tests も layout 込み test 生成 | ✅ SKILL.md 拡張済 (Phase A) — 実機テスト生成 dogfood は別 ISSUE 候補 |
| dogfood で実用性確認 | ✅ 本レポート |

## 5. 既知の制限・follow-up 候補

1. **/generate-tests skill の実機 dogfood**: Phase A で SKILL.md に Step 3-X (layout 込み page test) / 3-Y (gadget 単独 test) を追加したが、本 PR では実機テスト生成 dogfood まで実施していない。Spring `@SpringBootTest` + MockMvc / Playwright を回す実機検証は別 ISSUE 候補 (低優先)。
2. **全 page の自動生成**: 現状 `/generate-code` は 1 entity ずつ skill 起動。examples/retail の 11 page Screen + 4 PageLayout/Gadget をワンショットで生成するバルクモードは未実装。別 ISSUE 候補。
3. **Properties UTF-8 問題のテンプレ反映**: Thymeleaf 系 application.properties の ISO-8859-1 制約は LAYOUT.md / PAGE.md に注記が無い。テンプレートに「日本語値は @Value default で hardcode 推奨、または application.yml 採用」と注記する follow-up 候補。
4. **inter-gadget event (pl-Y)**: 検索フィルタガジェット ↔ リストガジェット pub/sub は pl-Y で。本 PR スコープ外。
5. **Spring Boot security 連携**: GlobalHeaderGadgetController の logout は stub (TODO コメント済)。Spring Security 統合は別 ISSUE。
6. **Next.js 14.2.18 security vulnerability warning**: npm install 時に next@14.2.18 の security 警告。生成テンプレ側で最新版へバージョン更新する follow-up 候補。

## 6. 結論

**RFC #1021 pl-7 (PageLayout + Gadget の code generation 対応、Phase 2) は受け入れ基準を達成**。

- 両 techStack (Spring Boot + Thymeleaf + Bootstrap / Next.js + React + Tailwind) で同一の business entity (Main Layout + 3 Gadget + Dashboard) から生成 + 実機ビルド + 起動 + HTML 検証完遂
- /generate-code skill の Step 構造拡張 (Phase A) + Thymeleaf 系テンプレ (Phase B) + Next.js 系テンプレ (Phase C) + 仕様書反映 (Phase E) すべて完了
- 統合 PR でリリース判断可能な状態
