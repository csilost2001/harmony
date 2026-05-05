# CSS フレームワーク切替対応 (#793) — 仕様書

画面ごとに CSS フレームワーク (Bootstrap / Tailwind) を選択可能にする framework 中規模再設計の仕様書。

> **改訂履歴 (2026-05-05)**: 当初は project 単位固定 / 途中切替非サポートで設計したが、マルチエディタ対応 (`multi-editor-puck.md`) と同時に **画面単位固定 + project default + 画面間混在可** に再設計。これにより「旧システムの部分更新 (一部画面のみ Tailwind 化)」シナリオに対応可能となった。実装影響は最小 (Designer.tsx の theme 解決順序変更のみ)、既存サンプルは regression なし。

## 関連

- メタ ISSUE: [#793](https://github.com/csilost2001/html-designer/issues/793) (project 単位設計の元起票) + 2026-05-05 マルチエディタ対応メタ ISSUE (画面単位化を含む統合 PR)
- 関連仕様: [`multi-editor-puck.md`](multi-editor-puck.md) — Puck 併設 + editorKind / cssFramework 画面単位化を含む正規仕様
- 動機: 設計書 = 画面仕様書という核心思想に対し、現状は Bootstrap class が blocks.ts にハードコードされ Bootstrap 固定の見た目しか出せない実装負債がある。さらに「旧システム部分更新」シナリオでは画面ごとに framework を選べる必要がある
- 議論履歴: 設計者と Opus のセッション (2026-05-04 = project 単位案 / 2026-05-05 = 画面単位再設計)

---

## 1. 背景

### 1.1 現状の構造的乖離

**設計意図 (CSS 変数 + テーマ層を持つ抽象化)**:

`designer/src/styles/common.css:1-23` (抜粋):

```css
@charset "UTF-8";
/* common.css — 業務システム向け共通スタイル（Flexboxベース）
   - Bootstrap 5 と共存可能（独自セマンティッククラスのみ）  ← 設計意図
   - PC業務画面専用（スマホ/IE対応なし）
   - React対応: class→className 変換のみで動作
*/

:root {
  --app-label-width: 130px;
  --app-label-bg: #f1f3f5;
  --app-label-color: #212529;
  --app-border: #dee2e6;
  /* ...他多数の CSS 変数 + .app-shell / .form-section / .form-row / .form-field 等の独自クラス定義 */
}
```

`designer/src/components/Designer.tsx:88-93` で `THEME_URLS` 経由で iframe にテーマ CSS を注入する仕組み実装済 (standard / card / compact / dark)。

**実装の負債 (Bootstrap class ハードコード)**:

`designer/src/grapes/blocks.ts:35-47` (抜粋):

```ts
const textInput = (ph = "") =>
  `<input type="text" class="form-control form-control-sm" placeholder="${ph}">`;
const numberInput = () =>
  `<input type="number" class="form-control form-control-sm">`;
// ... 他に form-select / form-check / form-row / fcol-* 等
```

1034 行のうち 50 箇所以上が Bootstrap class を直接埋め込み。さらに `form-row` / `fcol-*` のような **common.css 独自クラスも 10 箇所** 混在。テーマで CSS を上書きしても `form-control` 等の Bootstrap class は HTML 内に残り続けるため、Tailwind に切り替えても効かない。

### 1.2 目的の確認 — α (見た目) であって β (DX) ではない

設計者との議論で確認:

- **α**: 見た目だけ Tailwind 風 (近年の SaaS 風モダンな見た目) — **本仕様の目的**
- **β**: Tailwind の utility-first 開発体験 (responsive prefix / arbitrary value / utility class 直書き) — **本仕様の目的外**

β を真に得るには GrapesJS 自体を別ツール (Webstudio / Pinegrow Tailwind) に置き換える話になり、本フレームワークの根本見直しが必要。本仕様は GrapesJS WYSIWYG 思想を維持したまま α を達成する。

### 1.3 切替タイミング (2026-05-05 改訂)

設計者との議論で確認:

- **画面作成時に CSS フレームワークを固定** (画面ごと、以降変更不可)
- **project レベルに default を持つ** — 画面側未指定時のフォールバック。typical case (全画面同じ) は project default 1 行で済む
- **画面間で混在可能** — 旧システム部分更新シナリオ (大半 Bootstrap、一部 Tailwind) を素直に表現
- 切替可能性を担保するための抽象化コストは高い (margin/padding/shadow/border の defaults が theme 間で微妙に異なる) ため、画面ごと固定で割り切る
- 案件単位で CSS フレームワークが決まる典型ケースは project default 1 行で対応、移行案件は画面ごとに override

#### 1.3.1 解決順序 (画面ロード時)

1. `screen.design.cssFramework` (画面個別指定があればそれ)
2. `project.techStack.designer.cssFramework` (なければ project default、#826 で `project.design` から移行)
3. 最終 default (`"bootstrap"`)

#### 1.3.2 「画面作成後の変更不可」ポリシー

editor / cssFramework ともに画面作成時に決定、以降変更不可。理由:

- HTML 内 `form-control` (Bootstrap) → Tailwind utility の自動変換は不可能 (特に Open Code / customBlock 貼り付けの自由 HTML)
- migration コードを書かなくていい (切替操作 / 確認ダイアログ / undo 機構 / draft の dirty 判定が複雑化しない)
- AI 連携で source of truth が動かない (編集中に framework が変わると AI 入力ファイル形式も変わるため、長時間タスク中の整合性破壊リスクがある)
- edit-session-draft (#683) との整合 (ロック保有中に framework 変更が起きたら draft の意味が変わる → 排除)

ユーザールート: 「画面複製 → 別 cssFramework の新画面で作り直し」が公式ルート。旧画面は参照用に残し、片方ずつ移行する形が「旧システム部分更新」シナリオの自然な形。

## 2. 設計概要

### 2.1 アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ blocks.ts (60+ → 15-20 個に絞り込み、AI 自動追加排除)   │
│   ↓ 出力 HTML                                           │
│ class="btn btn-primary"  ← semantic class のみ          │
│ class="card"  / class="form-control"  / etc.            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 解決順序 (画面ロード時):                                │
│   1. screens/<id>.json  design.cssFramework             │
│   2. project.json       design.cssFramework (default)   │
│   3. 最終 default       "bootstrap"                     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Designer.tsx — canvas iframe に画面の framework CSS を  │
│ 読み込む (画面ごとに iframe が独立、衝突なし)           │
│                                                          │
│  bootstrap → theme-bootstrap.css                         │
│  tailwind  → theme-tailwind.css                          │
└─────────────────────────────────────────────────────────┘
                          ↓
                 [WYSIWYG 描画]
```

### 2.2 semantic class 一覧 (案)

`blocks.ts` 出力に使う semantic class を定義する。具体的な class 名は実装フェーズ (子 3) で確定するが、原則は **Bootstrap class 名を踏襲 + common.css 独自セマンティッククラス継承**:

**Bootstrap 由来 (Bootstrap CSS で直接定義済)**:

| カテゴリ | semantic class 例 |
|---|---|
| レイアウト | `container`, `row`, `col` (`col-1` ... `col-12`) |
| 見出し | `h1` `h2` `h3` `h4` |
| テキスト | `text-muted`, `text-center`, `text-end`, `small` |
| ボタン | `btn`, `btn-primary`, `btn-secondary`, `btn-danger`, `btn-sm`, `btn-lg` |
| フォーム入力 | `form-control`, `form-control-sm`, `form-select`, `form-label`, `form-check`, `form-check-input` |
| カード | `card`, `card-body`, `card-header`, `card-footer`, `card-title` |
| ナビ | `navbar`, `navbar-brand`, `nav`, `nav-item` |
| バッジ/アラート | `badge`, `alert`, `alert-info`, `alert-warning` |
| テーブル | `table`, `table-striped`, `table-hover` |
| ユーティリティ最低限 | `mb-*` `mt-*` `gap-*` `d-flex` `justify-content-*` (rem ベース、Bootstrap 互換) |

**common.css 独自 (本フレームワークの業務系 layout 補助、Bootstrap には存在しない)**:

| カテゴリ | semantic class 例 | 用途 |
|---|---|---|
| アプリ shell | `app-shell`, `app-header`, `app-sidebar`, `app-main` | サイドバー + ヘッダー + メインの 3 ペイン構造 |
| フォームセクション | `form-section`, `form-section-title` | グループ化されたフォーム枠 |
| フォーム行/フィールド | `form-row`, `fcol-1`, `fcol-2`, `fcol-3`, `fcol-4`, `form-field`, `field-label`, `field-value` | 多列フォームレイアウト (Bootstrap の `row`/`col` とは別軸の業務系 grid) |
| ページヘッダー | `page-header`, `page-title`, `breadcrumb-area` | 一覧画面の見出し帯 |

→ Bootstrap class 名 + common.css 独自クラスを semantic class layer として両方扱う。これにより:
- `theme-bootstrap.css` は **Bootstrap CSS + common.css を import** するだけで済む (両方の class が含まれる)
- `theme-tailwind.css` は **Bootstrap class + common.css 独自クラスを `@apply` で Tailwind utility にマップ** する必要あり (子 4 で定義)

実際の network 内 class 定義の出所マッピングは子 4 で確定。

### 2.3 theme CSS 構造

`designer/src/styles/themes/` (新規ディレクトリ) に:

- `theme-bootstrap.css` — Bootstrap 5 の CSS をそのまま import + project 固有上書き
- `theme-tailwind.css` — Tailwind の `@apply` で semantic class を utility class にマップ

**theme-bootstrap.css 雛形**:

```css
@import "bootstrap/dist/css/bootstrap.min.css";
@import "../common.css";  /* common.css 独自 semantic class (.app-shell / .form-row / .fcol-* 等) を継承 */
/* 注: variant CSS (theme-card.css / theme-compact.css / theme-dark.css) は
   Designer.tsx の applyThemeToCanvas() で別途上書き読み込みするため、ここでは import しない。
   2 軸構造 (framework × variant) の詳細は 7.3 節参照 */
```

**theme-tailwind.css 雛形**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
  /* Bootstrap 由来 semantic class */
  .btn {
    @apply inline-flex items-center justify-center px-4 py-2 rounded font-medium transition-colors;
  }
  .btn-primary {
    @apply bg-blue-600 text-white hover:bg-blue-700;
  }
  .btn-secondary {
    @apply bg-gray-200 text-gray-900 hover:bg-gray-300;
  }
  .card {
    @apply bg-white rounded-lg shadow-md border-0;
  }
  .card-body {
    @apply p-4;
  }
  .form-control {
    @apply block w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500;
  }
  /* common.css 独自 semantic class (Bootstrap 不在のため必須) */
  .app-shell {
    @apply flex flex-col min-h-screen;
  }
  .form-section {
    @apply rounded-lg border border-gray-200 mb-4 overflow-hidden;
  }
  .form-row {
    @apply grid gap-3;
  }
  .fcol-1 { @apply grid-cols-1; }
  .fcol-2 { @apply grid-cols-2; }
  .fcol-3 { @apply grid-cols-3; }
  .fcol-4 { @apply grid-cols-4; }
  /* ... */
}
```

**ビルドツール要件 (子 4 スコープ)**:

`@apply` は PostCSS + `tailwindcss` プラグインが Vite pipeline に組み込まれている前提。子 4 で:

1. `designer/package.json` に `tailwindcss` / `postcss` / `autoprefixer` を依存追加
2. `designer/postcss.config.js` 作成
3. `designer/tailwind.config.ts` 作成 (content scan path に `themes/theme-tailwind.css` を含める)
4. `theme-tailwind.css` を build 時に正しく PostCSS 経由でコンパイル

詳細マッピングと依存追加は子 4 で確定。

### 2.4 schema 拡張 (画面単位化)

#### 2.4.1 `schemas/v3/project.v3.schema.json` (project default)

```json
{
  "design": {
    "type": "object",
    "additionalProperties": false,
    "description": "プロジェクト全画面の default 設定。画面側で override 可能。",
    "properties": {
      "cssFramework": {
        "type": "string",
        "enum": ["bootstrap", "tailwind"],
        "default": "bootstrap",
        "description": "プロジェクト全画面の default CSS フレームワーク。画面側 (screen.design.cssFramework) で override 可能。省略時は 'bootstrap' 相当。"
      }
    }
  }
}
```

#### 2.4.2 `schemas/v3/screen.v3.schema.json` (画面単位、ScreenDesign)

```json
{
  "ScreenDesign": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "cssFramework": {
        "type": "string",
        "enum": ["bootstrap", "tailwind"],
        "description": "本画面の CSS フレームワーク。画面作成時に固定、以降変更不可。省略時は project.techStack.designer.cssFramework を参照、それも省略なら 'bootstrap'"
      }
    }
  }
}
```

両方とも optional。**既存 3 サンプル (retail / realestate / english-learning) は project レベル `cssFramework: "bootstrap"` 設定済 (#793 子 6 でマージ済)** — 仕様改訂後も「画面側 default」として全画面 bootstrap が継続適用、regression なし。

`editorKind` (本仕様改訂と同時にマルチエディタ対応で追加される field) も同じく **画面側 + project default** 構造。詳細は [`multi-editor-puck.md`](multi-editor-puck.md) § 2.5 を参照。

### 2.5 Designer.tsx の theme ロード機構 (画面単位化)

現状 (`designer/src/components/Designer.tsx`):

```ts
const FRAMEWORK_URLS: Record<CssFramework, string> = {
  bootstrap: new URL("../styles/themes/theme-bootstrap.css", import.meta.url).href,
  tailwind: new URL("../styles/themes/theme-tailwind.css", import.meta.url).href,
};
```

#### 2.5.1 解決ロジック (画面単位化)

```
const cssFramework =
  screen.design.cssFramework
  ?? project.techStack?.designer?.cssFramework  // #826: project.design から移行
  ?? "bootstrap";
const themeUrl = FRAMEWORK_URLS[cssFramework];
// canvas iframe に themeUrl を注入
```

canvas iframe は画面ごと独立 (`/screen/design/:screenId` の per-resource タブ) なので、**画面ごとに別 framework theme をロードしても CSS 衝突なし**。variant CSS (card / compact / dark) は引き続き framework theme の上に重ねる 2 層構造。

#### 2.5.2 最終実装 (生成された Thymeleaf / React アプリ) の CSS 隔離

本仕様の射程外。最終実装側は画面単位で必要な theme CSS のみロードする前提 (Thymeleaf 案件は画面 = ページ単位で自然解決、SPA React 案件は CSS chunk 分割 / scoped CSS / shadow DOM 等で隔離)。詳細は別文書化候補 (本シリーズ後の future ISSUE)。

## 3. 実装ロードマップ

### 3.1 #793 元仕様 (project 単位、実装完了済 2026-05-04)

| 子 | 内容 | PR / commit |
|---|---|---|
| 子 1 | 仕様書 (`docs/spec/css-framework-switching.md`) 初版 | マージ済 |
| 子 2 | schema 変更 (`project.v3.schema.json` に `design.cssFramework`) | マージ済 |
| 子 3 | `blocks.ts` を semantic class 出力に全面書き換え + ブロック数 60+ → 15-20 削減 | マージ済 |
| 子 4 | `theme-bootstrap.css` + `theme-tailwind.css` 新規作成 + Tailwind ビルド環境 | マージ済 (#800) |
| 子 5 | `Designer.tsx` theme ロード機構を framework × variant 2 軸対応 | マージ済 (#801) |
| 子 6 | 既存 3 サンプルに `design.cssFramework: "bootstrap"` 明示追加 | マージ済 (#802) |
| 子 7 | 英会話学習アプリ Tailwind 版 サンプル追加 (視覚実証) | マージ済 (#803) + ナビゲーション破綻修正 (#805) |

### 3.2 画面単位化 (本改訂、マルチエディタ対応シリーズで対応)

画面単位化は別仕様書 [`multi-editor-puck.md`](multi-editor-puck.md) のシリーズの一部として実装される。本書は画面単位化部分の正規仕様 (schema 設計・解決ロジック・既存サンプル regression 確認) を提供する。

実装対象 commit:
- `screen.v3.schema.json` の `ScreenDesign` に `cssFramework` field 追加
- `Designer.tsx` の cssFramework 解決ロジック画面単位化
- 画面単位混在 dogfood

詳細子分解は [`multi-editor-puck.md`](multi-editor-puck.md) § 12 参照。

## 4. ブロック絞り込み方針 (子 3)

### 4.1 削減原則

現状 60+ ブロックは AI が次々追加した蓄積で、業務特化複合ブロックを含む。**設計者意図ではなく AI の自動追加** が大半。

絞り込み方針:

- **必要最低限の汎用部品** に絞る (15-20 個目安)
- 業務特化複合 (検索バー / データリスト等) は 4 個程度残す
- それ以外は **Custom Block (`customBlockStore`)** で運用に任せる

### 4.2 残すブロック (案)

| カテゴリ | ブロック | 必要性 |
|---|---|---|
| レイアウト | container / row / col / heading / paragraph / link | 必須 |
| フォーム | input / select / textarea / checkbox / radio / button | 必須 |
| データ表示 | table / image / icon | 必須 |
| 業務複合 | form-field-set / search-bar / data-list / pagination | 高頻度 |

合計 15-19 個程度。

### 4.3 削除候補

`blocks.ts` の以下カテゴリ群は基本削除 (Custom Block で代替可能):

- `CAT_PAGE` (ページテンプレート) — Custom Block で各案件に最適化
- `CAT_NAVI` (ナビゲーション) — 案件依存性が高い
- `CAT_DETAIL` (詳細表示) — レイアウト + フィールドの組合せで作る
- `CAT_COMPOUND` (複合フィールド) — 多様すぎ、Custom Block で

実際の取捨選択は子 3 で確定。

## 5. 自由デザイン経路の維持

Open Code (生 HTML 貼り付け) / Custom Block / Style Manager / 顧客提供デザイン HTML / AI 生成 HTML 貼り付け は **すべて維持**。これらは GrapesJS 本体の機能で、本仕様変更は影響しない。

「自由デザインで `class="flex p-4 bg-blue-500..."` のような Tailwind utility class が直接埋め込まれる」場合の運用方針:

- **再利用するものは semantic class 化** (theme CSS で定義)
- **1 回限りのユニークセクションは utility class 直書きで OK** (画面ごと framework 固定なので theme 切替で崩れる懸念なし)

## 6. 受け入れ基準

### 6.1 #793 元仕様 (project 単位、実装完了済)

- [x] `schemas/v3/project.v3.schema.json` に `design.cssFramework` field 追加
- [x] `designer/src/types/` に `CssFramework` 型定義追加
- [x] `designer/src/grapes/blocks.ts` から Bootstrap / common.css ハードコード排除 (semantic class のみ出力)
- [x] ブロック数 60+ → 15-20 個程度に絞り込み
- [x] `designer/src/styles/themes/theme-bootstrap.css` + `theme-tailwind.css` 新規作成
- [x] `designer/package.json` に Tailwind 関連依存追加、`postcss.config.js` / `tailwind.config.ts` 作成
- [x] `Designer.tsx` が `project.techStack.designer.cssFramework` を読み取り、対応 theme CSS を canvas iframe に注入 (#826 で `project.design` から移行)
- [x] 既存 3 サンプル (retail / realestate / english-learning) で `cssFramework: "bootstrap"` 設定後、regression なし

### 6.2 画面単位化 (本改訂、マルチエディタ対応シリーズで対応)

- [ ] `schemas/v3/screen.v3.schema.json` の `ScreenDesign` に `cssFramework` field 追加 (画面側 override、optional)
- [x] `Designer.tsx` の cssFramework 解決ロジックを画面単位化 (`screen.design.cssFramework` ?? `project.techStack.designer.cssFramework` ?? `"bootstrap"`) (#826)
- [ ] 既存 3 サンプルが project default で全画面 bootstrap を継続適用すること (regression なし)
- [ ] 画面単位混在 dogfood: 1 プロジェクトで bootstrap 画面と tailwind 画面が共存、各々が canvas iframe で正しい theme をロードすることを E2E で検証
- [ ] dogfood report 作成 (マルチエディタ対応シリーズの dogfood に統合)

## 7. リスク / 懸念

### 7.1 既存 3 サンプルへの影響 (画面単位化後も regression なし)

- 既存 3 サンプルは project レベル `cssFramework: "bootstrap"` 設定済 (#793 子 6 でマージ済)
- 画面単位化後も「画面側未指定 → project default = bootstrap」として全画面 bootstrap が継続適用
- リリース前のため migration 不要 (`feedback_no_backward_compat_pre_release.md`)

### 7.2 Tailwind theme で `@apply` の限界

Tailwind の `@apply` は静的 CSS 化なので、responsive prefix (`md:` `lg:`) や hover state は CSS 側で全部書く必要があり、HTML class に utility prefix を埋め込む β 体験は得られない (本仕様の目的外)。

ただし Puck 併設 (`multi-editor-puck.md`) では **Puck props 経由で限定的レイアウト指定 (右寄せ・余白等)** が可能になる。これは β の一部を「Puck props で表現可能な有限集合」に絞って取り入れるアプローチ。

### 7.3 既存 4 テーマ (standard / card / compact / dark) との関係

現状の `theme-card.css` / `theme-compact.css` / `theme-dark.css` は Bootstrap 上書き variant。本仕様の cssFramework 選択は別軸 (画面単位):

- bootstrap framework × standard / card / compact / dark variant
- tailwind framework × standard / card / compact / dark variant (各々で再実装が必要)

MVP では tailwind framework は standard variant のみ実装、card / compact / dark は future work。

### 7.4 画面単位化による CSS スコープ問題 (Designer 内は安全)

| 場面 | 干渉リスク | 対応 |
|---|---|---|
| Designer 画面編集 (`/screen/design/:screenId`) | なし — 画面ごとに canvas iframe が独立、各々で必要な theme CSS のみロード | 既存設計のまま OK |
| ScreenListView サムネイル | なし — サムネイルは画像 (PNG / SVG snapshot) | 既存のまま |
| Dashboard 等で複数画面のリアルタイム iframe を並べる場合 | あり | per-iframe で個別 cssFramework theme をロード |
| 最終実装 (生成された Thymeleaf / React アプリ) | あり (SPA で画面遷移時の CSS 衝突) | **本仕様の射程外**: Thymeleaf 案件 (画面 = ページ単位) なら自然解決、SPA React 案件は CSS chunk 分割 / scoped CSS / shadow DOM 等で隔離する責務を出力側に委ねる |

## 8. 関連 memory / 仕様書

- `feedback_schema_governance_strict.md` (#511) — schema 変更は設計者承認必須、本仕様で承認済
- `feedback_consolidate_related_proposals_into_one_issue.md` — 子間の派生提案は同 ISSUE 統合
- `feedback_no_backward_compat_pre_release.md` — リリース前の後方互換性方針
- [`multi-editor-puck.md`](multi-editor-puck.md) — マルチエディタ対応 (Puck 併設) 正規仕様。本仕様の画面単位化 (#793 改訂) はこのシリーズの一部として実装される
