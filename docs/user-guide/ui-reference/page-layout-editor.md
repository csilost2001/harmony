# ページレイアウト編集

> **対象画面**: `PageLayoutEditor` (`frontend/src/components/page-layout/PageLayoutEditor.tsx`)
> **ルート**: `/w/:wsId/page-layout/edit/:pageLayoutId`
> **種別**: マルチインスタンスタブ

## 概要

PageLayout をレイアウトマネージャとして編集する画面。共通ヘッダー、サイドバー、フッターなどの固定 region に Gadget を割り当て、`main` content slot に page Screen 本文が動的に入る構造を定義する。

PageLayout 画面では Gadget や page Screen 本体を編集しない。中身の編集は各 Screen Designer で行い、本画面では read-only 合成プレビューで配置結果を確認する。

## 到達経路

- ページレイアウト一覧 (`/page-layout/list`) → 行を開く
- 直接 URL: `/w/<wsId>/page-layout/edit/<pageLayoutId>`
- 旧 URL `/page-layout/design/:id` からの互換 redirect

## 画面構成

![ページレイアウト編集](../../ui-screenshots/ui-reference/page-layout-editor/01-default.png)

### 主要エリア

1. **EditorHeader** — レイアウト名、編集セッション、id 変更、保存、破棄
2. **基本情報** — 名前、説明、成熟度、editorKind / cssFramework の参照表示
3. **レイアウトパターン** — `header-main-footer` / `header-sidebar-main-footer` などの定型分割を選択
4. **合成プレビュー** — region に割り当てた Gadget と sample page を read-only で合成表示
5. **Regions** — region 名、説明、並び順の詳細調整
6. **Assignments** — content slot 以外の region に Gadget を割り当てる
7. **ProcessFlow 連携** — ガジェット間連携 orchestrator の任意指定

## 主要操作

| 操作 | 手段 | 結果 |
|---|---|---|
| レイアウト分割を選ぶ | レイアウトパターン selector | `regions[]` を定型構成に更新 |
| Gadget を配置 | Assignments の selector | `assignments[region]` に gadget Screen ID を保存 |
| content slot を確認 | 合成プレビューの `main` 領域 | page Screen 本文の差し込み位置を確認 |
| sample page 表示 | サンプル表示画面 selector | preview 専用に page Screen 本文を read-only 表示 |
| region 詳細調整 | Regions table | region 説明、順序、追加 region を編集 |
| 保存 / 破棄 | `Ctrl+S` / 「破棄」 | edit-session 経由で保存・破棄 |
| rename | EditorHeader の id 変更 | RenameEntityDialog |

## データ前提

- 固定 region に配置できるのは `Screen{purpose:"gadget"}` のみ
- `main` は content slot の canonical 予約名で、PageLayout 側に具体 page Screen ID は保存しない
- `content` は既存データ互換 alias として UI 上 content slot 扱いにする
- sample page selector は preview 専用で、PageLayout entity には保存しない

## 関連仕様書

- [`docs/spec/page-layout.md`](../../spec/page-layout.md) — PageLayout / gadget / content slot 仕様
- [`docs/spec/list-common.md`](../../spec/list-common.md)

## 既知の制約・注意

- Gadget / page Screen 本体の編集は Screen Designer で行う
- preview は read-only 合成表示であり、Gadget 内のボタンや入力操作は編集対象外
- design HTML を取得できない Screen は名前 / ID の fallback 表示になる
