# 画面レイアウト (業務部品の木) — 仕様書

**Status**: 実装済 (2026-10、再設計 段階 1)
**関連**: [docs/plans/redesign-2026-10.md](../plans/redesign-2026-10.md) / [screen-items.md](screen-items.md) / [schema-governance.md](schema-governance.md)

## 1. 目的

画面の設計を「業務部品の入れ子」として JSON で持つ。旧形式 (GrapesJS の HTML 文字列 / Puck Data) では、

- 画面の見た目 (HTML) と画面項目 (items) が二重管理になり、同期処理が原本を汚していた
- HTML 文字列は AI にも人にも意味が読み取りにくく、差分レビューができなかった
- 描画方式 (GrapesJS / Puck × Bootstrap / Tailwind) ごとに保存形式が分かれていた

業務部品の木は、**配置 (layout) と項目定義 (items) を分け、配置は項目を ID で参照するだけ**にする。描画方式は持たない (どう描くかはプレビューと、コード生成時の AI の責務)。

## 2. データ形式

`screens/<id>.json` の `layout` に置く (schemas/v3/screen.v3.schema.json `ScreenLayout`)。

```json
{
  "id": "product-search",
  "items": [
    { "id": "productCode", "label": "商品コード", "type": "string", "direction": "in", "maxLength": 20 },
    { "id": "inventoryRows", "label": "在庫一覧", "type": { "kind": "array", "itemType": "json" },
      "direction": "out", "presentation": { "kind": "table", "viewDefinitionId": "inventory-list" } }
  ],
  "layout": {
    "version": 1,
    "nodes": [
      { "id": "heading", "type": "heading", "props": { "text": "商品検索", "level": 1 } },
      { "id": "searchPanel", "type": "search-panel", "props": { "columns": 2 }, "children": [
        { "id": "productCode", "type": "field", "itemRef": "productCode" },
        { "id": "buttons", "type": "button-bar", "props": { "align": "right" }, "children": [
          { "id": "searchButton", "type": "button", "itemRef": "searchButton", "props": { "label": "検索", "variant": "primary" } }
        ] }
      ] },
      { "id": "inventoryRows", "type": "table", "itemRef": "inventoryRows" }
    ]
  }
}
```

### 2.1 部品の種別

| 種別 | 名前 | 子 | 主な props |
|---|---|---|---|
| `section` | 区画 | 任意 | `title`, `variant` (card / panel / plain), `collapsible` |
| `form` | 入力フォーム | field / button / text / columns / button-bar / section 等 | `title`, `columns` (1–4) |
| `search-panel` | 検索条件 | form と同じ | `title`, `columns` |
| `columns` / `column` | 段組 / 段 | columns の子は column のみ | column: `span` (12 分割) |
| `tabs` / `tab` | タブ群 / タブ | tabs の子は tab のみ | tab: `title` |
| `button-bar` | ボタン群 | button / link のみ | `align` |
| `heading` | 見出し | — | `text`, `level` (1–3) |
| `text` | 文章 | — | `text`, `tone` (normal / muted / note / warning) |
| `field` | 項目 | — | `itemRef` 必須 |
| `table` | 一覧表 | — | `itemRef` 必須 (presentation.kind=table/list の項目) |
| `button` | ボタン | — | `itemRef` (click イベントを持つ項目) または `label`, `variant`, `screenRef` |
| `link` | リンク | — | `label`, `screenRef` |
| `message-area` | メッセージ領域 | — | — |
| `image` | 画像 | — | `src`, `alt` |
| `divider` | 区切り線 | — | — |
| `html` | 自由 HTML | — | `html` (旧形式から変換できなかった部分。置き換え候補) |

配置可否は `canContain()` (shared/src/screenLayout.ts) が唯一の定義。

### 2.2 原則

1. **項目の定義は items[] にだけ書く**。部品は `itemRef` で参照する。同じ項目を複数の部品から参照してよい
2. **部品 ID は画面内で一意な lowerCamelCase**。項目を参照する部品は、項目 ID と同じ ID を基本にする
3. **props は意味だけを持つ**。色・CSS クラス・ピクセル値は持たない
4. 検証 (`validateLayout`) は保存を妨げない (draft-state)。重複 ID / 存在しない項目 / 置けない位置は error、項目未割当は warning、未配置の項目・空の容器・自由 HTML は info

## 3. 業務部品デザイナ (UI)

`/screen/design/:screenId`。layout を持つ画面で開く。

- 左: 部品パレット / 画面項目 (未配置の項目) / テーブル (列から項目を作成) / 構成ツリー
- 中央: 紙面プレビュー (設計対象アプリの見本。アプリのテーマに関係なく明色)。表示幅 (PC / タブレット / スマホ)・密度・設計情報 (項目 ID・型・桁) を切替
- 右: 選択した部品の属性と、参照する画面項目の定義 (型・桁・必須・書式・選択肢・一覧の列)。未選択時は画面全体の検証結果
- 操作: ドラッグ & ドロップ / クリックで選択中の部品の後ろに追加 / Alt+↑↓ 移動 / Ctrl+D 複製 / Delete 削除 / Ctrl+Z・Y 取り消し / Ctrl+S 保存
- テーブル列をドラッグすると、型・桁数・必須 (NOT NULL かつ自動採番・既定値なし)・表示名・DB 列参照 (`binding.kind=tableColumn`) を引き継いだ入力項目を作る
- 保存は画面項目と同じ編集セッション (`screen-item`) で items と layout を同時に確定する。画面を開いただけでは原本を書き換えない

## 4. 旧形式との関係

- layout を持たず旧デザイン (`design.designFileRef` / `puckDataRef`) だけを持つ画面は、旧デザイナで開き、上部に移行の案内を出す
- 移行は案内から業務部品デザイナの開始画面に切り替え、「旧デザインから自動変換」または「空の画面から作る」を選ぶ。保存するまで原本は変わらない
- 旧デザインファイルは移行後も削除しない (旧デザイナの廃止時にまとめて整理する)

## 5. 旧デザイン HTML からの自動変換

`designToLayout()` (shared/src/designToLayout.ts) が決定的に変換する。一括変換は `node scripts/dev/convert-screens-to-layout.mjs <workspace> [--apply]`。

| HTML | 部品 |
|---|---|
| `<main>` の外 (ヘッダ / サイドバー / フッタ) | 除外 (ページレイアウトの責務)。ガジェット画面では除外しない |
| `h1`〜`h6`, `.page-title` | heading (level は 3 まで) |
| `form`, `.search-area` | form / search-panel (検索ボタンや class 名で判定)。`.row > .col-*` の列数を columns に |
| ラベル + 入力欄 1 つのまとまり | field。`data-item-id` → `name` → 表示名一致の順で既存項目に結び付け、無ければ項目を作る (型・必須・桁・選択肢を引き継ぐ) |
| `<table>` (見出し行あり) | table。結び付く項目が無ければ列見出しから一覧項目を作る。名前は直前の見出しから |
| `data-item-id` を持つ空要素 (viewer 差し込み位置) | 項目の presentation に応じて table / field。直後の見本表は重複させない |
| `button`, `a.btn` | button。連続するものは button-bar にまとめる。`href` が画面 path なら `screenRef` |
| `.card`, `section`, `fieldset` | section (見出しを title に) |
| `.alert`, `[role=alert]` | message-area |
| `p`, 文字だけの `div` | text (`text-muted` / `small` は tone=muted) |
| `ul` / `ol` / `dl` / `svg` 等 | html (原文を保持) |

## 6. コード生成との関係

`/generate-code` は layout を画面構造の一次情報として読む (ai-skills/generate-code/SKILL.md Step 3-B)。layout が無い画面は従来どおり items と旧デザインから生成する。
