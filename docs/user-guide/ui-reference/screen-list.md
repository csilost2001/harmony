# 画面一覧

> **対象画面**: `ScreenListView` (`frontend/src/components/flow/ScreenListView.tsx`)
> **ルート**: `/w/:wsId/screen/list`
> **種別**: シングルトンタブ

> **実画面で確認した日**: 2026-10-17 — 「画面を追加」のダイアログと、ダブルクリックで開く・「項目定義」で項目の画面へ移る操作。ほかの行は、続編の前のまま

## 概要

プロジェクトの全画面 (Screen リソース) を一覧する。カード / 表の 2 表示モード切替、フィルタ、ソート、複数選択、コピー / 切り取り / 貼り付け、ID 変更 (rename refactor)、ドラフト中マークの可視化など、一覧 UI 共通仕様 ([`list-common`](../../spec/list-common.md)) を全部備える代表的な画面。

`purpose='gadget'` の画面は本一覧では非表示 (ガジェット一覧 `/gadget/list` で管理、#1025)。

## 到達経路

- HeaderMenu → 「画面」→「画面一覧」
- ダッシュボード「機能別定義数」パネル → 「画面」リンク
- 直接 URL: `/w/<wsId>/screen/list`

## 画面構成

![画面一覧 (card view)](../../ui-screenshots/ui-reference/screen-list/01-card.png)

![画面一覧 (table view)](../../ui-screenshots/ui-reference/screen-list/02-table.png)

### 主要エリア

1. **ヘッダー** — タイトル「画面一覧」+ 件数 + 「画面を追加」ボタン (画面が 0 件のときは、中央の案内にも同じボタンがある)
2. **フィルタバー** (`FilterBar`) — キーワード検索 (画面名 / URL / 説明)
3. **ソートバー** (`SortBar`) — 画面名 / 種別 / URL / 更新日時 で昇降順
4. **表示モード切替** (`ViewModeToggle`) — カード ⇔ 表
5. **一覧本体** (`DataList`)
   - **カードビュー** — グリッド上に画面アイコン + 名前 + 種別 + バッジ群
   - **表ビュー** — 列: draft●(未保存マーク) / 画面名 / 検証(error/warning 件数) / 成熟度 / 種別 / URL / 更新日時

## 主要操作

| 操作 | 手段 | 結果 |
|---|---|---|
| 新規作成 | 右上「画面を追加」 (右クリックのメニューの「新規作成」も同じ) | 「画面の追加」ダイアログ。**画面名** (必須)・**画面種別** (ログイン / ダッシュボード / 一覧 / 詳細 / 入力フォーム / 検索 / 確認 / 完了 / エラー / モーダル / ウィザード / その他)・**想定 URL**・**画面 ID** (kebab-case)・説明。**画面 ID は、辞書にある言葉だけの名前 (例: 「顧客一覧」→ `customer-list`) なら自動で入る**。入らないとき (例: 「貸出登録」) は、英数字で自分で入れるか、ID 欄の下の「仮の ID を付ける」・候補の「… を使う」・「AI 提案」を使う (ID が空のあいだは「保存」を押せない)。「保存」で一覧に増える (編集画面へは移らない) |
| 画面を開く | カード / 行を**ダブルクリック** (または選んで `Enter`)。**1 回のクリックは「選択」だけで、開かない** | 画面デザイナー (`/screen/design/:id`) が新タブで開く |
| 画面項目編集を開く | カード内の「項目定義」(表では、同じ名前のアイコン) | `/screen/items/:id` が新タブで開く |
| 右クリックのメニュー | カード / 行 (または空き地) を右クリック | 新規作成・コピー・切り取り・貼り付け・複製・ID 変更・参照元を見る・削除 (キーボードは `Shift+F10` / メニューキー) |
| 開く (キーボード) | 選んで `Enter` または `F2` | どちらも「画面を開く」と同じ (デザイナが開く)。名前・種別などの編集画面は開かない |
| 削除 | 右クリック → 「削除」 or `Delete` キー | デザインデータと edges も削除、確認ダイアログあり |
| 複数選択 | Ctrl+Click / Shift+Click | カード / 行に選択枠 |
| コピー / 切り取り / 貼り付け | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | 別 workspace へも貼り付け可 |
| 複製 | 右クリック → 「複製」 or `Ctrl+D` | 同名末尾に番号付きで複製 |
| ID 変更 (rename refactor) | 右クリック → 「ID 変更…」 | `RenameEntityDialog` で kebab-case 新 id を入力、全 ref 自動更新 + undo toast |
| 並び替え | カード / 行をドラッグ | `renumber()` で No 列再採番、save 必要 |
| ソート | ソートバー or 表のヘッダクリック | 表示順のみ変わる (永続化されない) |
| フィルタ | キーワード入力 | 部分一致で絞込み |
| カード ⇔ 表切替 | 右上の切替ボタン | localStorage (`list-view-mode:screen-list`) に永続化 |
| 保存 | `Ctrl+S` or 「保存」ボタン (編集中のみ表示) | `commitScreens` でサーバ反映 |
| 編集破棄 | 「破棄」ボタン (編集中のみ) | 確認後サーバの状態に戻す |

## データ前提

- **空状態**: 「画面が未登録です」プレースホルダ + 「新規作成」ボタンのみ
- **意味のある状態**: retail サンプル等の場合、各 ScreenKind (page / dialog / partial 等) の画面が混在表示、`MaturityBadge` (draft / committed) や `ValidationBadge` (error / warning 件数) が情報量を増やす
- **ドラフト中状態**: `useDraftRegistry` で `data/.drafts/<wsId>/screen/<id>.json` 存在検知 → 1 列目に `●` マーク

## 関連仕様書

- [`docs/spec/list-common.md`](../../spec/list-common.md) — 一覧 UI 共通仕様 (本画面が典型)
- [`docs/spec/draft-state-policy.md`](../../spec/draft-state-policy.md) — `MaturityBadge` / `ValidationBadge` の判定基準
- [`docs/spec/multi-editor-puck.md`](../../spec/multi-editor-puck.md) — `editorKind` (grapesjs / puck) の選択意義
- [`docs/spec/page-layout.md`](../../spec/page-layout.md) — `pageLayoutId` (ページレイアウト) の役割

## 関連 skill

- `/rename-screen-ids` — 画面項目 ID を AI 推論で一括 rename (本画面の rename refactor とは別、項目側)

## 既知の制約・注意

- ソート結果は **表示順のみ**で永続化されない。並び順を変えたい場合はカード / 行をドラッグ
- `purpose='gadget'` の画面は本一覧に出ない。ガジェット一覧で管理
- カード / 表の切替は localStorage 永続化なので、ブラウザ / PC 毎にユーザー設定が分かれる
