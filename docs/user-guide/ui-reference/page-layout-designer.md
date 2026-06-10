# ページレイアウト Designer

> **対象画面**: `PageLayoutDesigner` (`frontend/src/components/page-layout/PageLayoutDesigner.tsx`)
> **ルート**: `/w/:wsId/page-layout/design/:pageLayoutId`
> **種別**: マルチインスタンスタブ

## 概要

PageLayout の **ビジュアル編集**画面。上部の PageLayout Manager で header / sidebar / footer / main-content 等の slot を俯瞰し、各 slot の gadget 割り当てを変更する。下部には既存の GrapesJS / Puck Designer があり、PageLayout 自体の visual design payload を編集できる。

## 到達経路

- ページレイアウト一覧 (`/page-layout/list`) → 行 → 「デザイン」
- ページレイアウト編集 (`/page-layout/edit/:id`) → 「デザインへ」
- 直接 URL: `/w/<wsId>/page-layout/design/<pageLayoutId>`

## 画面構成

![ページレイアウト Designer](../../ui-screenshots/ui-reference/page-layout-designer/01-default.png)

### 主要エリア

1. **PageLayout Manager header** — レイアウト名 / slot 数 / assignment 数 / editorKind / cssFramework / 「構造編集」 / 「割り当て保存」
2. **Slot Canvas** — `regions` に基づく header / sidebar / main / footer / custom slot の俯瞰表示
3. **Slot assignments** — `main` 以外の region に gadget Screen を割り当てる selector
4. **Design editor** — GrapesJS / Puck による PageLayout design payload 編集

## 主要操作

| 操作 | 手段 | 結果 |
|---|---|---|
| gadget 割り当て | Slot assignments の selector | region → gadget Screen の割り当てを変更 |
| 割り当て保存 | 「割り当て保存」 | PageLayout 本体 (`assignments`) を保存 |
| slot 構成変更 | 「構造編集」 | `PageLayoutEditor` で `regions` を追加 / 削除 / 並び替え |
| 外部更新から復帰 | conflict banner の「再読み込み」 | 最新 PageLayout を読み直し、未保存 assignment draft を破棄 |
| 保存 / 破棄 | `Ctrl+S` / 「破棄」 | edit-session 経由 |

## データ前提

- **空状態**: 何も slot が無いキャンバス → `PageLayoutEditor` で slot を先に定義することを推奨
- **意味のある状態**: retail の `main-layout` は header (ロゴ + ナビ + ユーザーメニュー) + sidebar + main + footer の 4 領域

## 関連仕様書

- [`docs/spec/page-layout.md`](../../spec/page-layout.md) — PageLayout / gadget 仕様
- [`docs/spec/multi-editor-puck.md`](../../spec/multi-editor-puck.md) — Designer の編集モデル共通仕様

## 関連 skill

- なし

## 既知の制約・注意

- **構造 (slot 定義) は `PageLayoutEditor` で先に作る**のが推奨。本 Designer は slot の俯瞰 + gadget 割り当て + visual design payload 編集に特化
- gadget は事前に `/gadget/list` で定義済みのもののみ配置可
- `main` は page Screen 本文が入る content slot のため、gadget assignment selector は表示されない
