# 帳票 — 仕様書

**Status**: 実装済 (2026-10、再設計 段階 4)
**関連**: [docs/plans/redesign-2026-10.md](../plans/redesign-2026-10.md) / [design-document.md](design-document.md) / [business-flow.md](business-flow.md)

## 1. 目的

納品書・請求書・一覧表・伝票など、**紙 (PDF・Excel・CSV) に出力する帳票**の設計を、画面・処理フローと同じ原本 (JSON) で持つ。日本の設計書で必ず作られる「帳票設計書」(帳票名・出力契機・用紙・出力条件・各部の項目と書式・改ページ・集計) を、データから自動で組み立てる。

- 原本は**項目の定義と並び**だけを持つ (座標を持たない)。用紙の見本図は、項目の並びと幅から自動で描く
- 出力契機 (どの画面のボタン / どのバッチで出すか) から、画面・処理フローへたどれる
- 設計書 (HTML) の章にも同じ見本を出す。帳票の実装 (PDF 生成コード) は、この設計書から AI が生成する

## 2. 原本

`<dataDir>/reports/<id>.json` (1 帳票につき 1 ファイル)。スキーマは [`schemas/v3/report.v3.schema.json`](../../schemas/v3/report.v3.schema.json)。`harmony.json` への登録は不要 (ディレクトリにあるものを一覧する)。

```jsonc
{
  "$schema": "../../../../schemas/v3/report.v3.schema.json",
  "version": 1,
  "id": "delivery-note",                 // kebab-case。ファイル名と一致
  "name": "納品書",
  "description": "…",
  "maturity": "draft",
  "output": { "format": "pdf", "paper": "A4", "orientation": "portrait" },
  "trigger": { "kind": "screen", "screenRef": "order-complete", "processFlowRef": "order-confirm", "description": "注文完了画面の「納品書を印刷」" },
  "params": [{ "id": "orderId", "label": "注文番号", "type": "string", "required": true }],
  "sort": [{ "field": "lineNo", "order": "asc" }],
  "sections": [
    { "id": "title", "kind": "reportHeader", "name": "表題", "fields": [
      { "id": "title", "label": "納品書", "kind": "text", "align": "center", "width": 100 } ] },
    { "id": "lines", "kind": "detail", "name": "明細", "fields": [
      { "id": "productName", "label": "商品名", "kind": "field", "source": "order-item.productName", "width": 50 },
      { "id": "qty", "label": "数量", "kind": "field", "source": "order-item.quantity", "format": "#,##0", "align": "right", "width": 20 },
      { "id": "amount", "label": "金額", "kind": "field", "source": "order-item.subtotal", "format": "¥#,##0", "align": "right", "width": 30 } ] },
    { "id": "total", "kind": "reportFooter", "name": "合計", "fields": [
      { "id": "grand", "label": "合計金額", "kind": "aggregate", "source": "order-item.subtotal", "aggregate": "sum", "format": "¥#,##0", "align": "right", "width": 100 } ] }
  ]
}
```

### 2.1 出力 (`output`)

| 項目 | 内容 |
|---|---|
| `format` | `pdf` / `excel` / `csv` / `html` |
| `paper` | `A4` / `A3` / `B4` / `B5` / `letter` (省略時 A4)。CSV では不要 |
| `orientation` | `portrait` 縦 / `landscape` 横 (省略時 縦) |

### 2.2 出力契機 (`trigger`)

| 項目 | 内容 |
|---|---|
| `kind` | `screen` 画面の操作 / `batch` バッチ・定期 / `api` 外部からの要求 |
| `screenRef` | 出力する画面の ID (任意) |
| `processFlowRef` | データを集めて出力する処理フローの ID (任意) |
| `description` | 契機の説明 (例: 「注文完了画面の『納品書を印刷』」) |

### 2.3 出力条件 (`params`)

帳票を出すときに指定する条件。`id` / `label` は必須、`type` は文字列の型名 (`string` / `integer` / `date` など)、`required` は必須か。

### 2.4 部 (`sections`)

上から順に並ぶ。`kind` は次のとおり。

| kind | 意味 | 出る位置 |
|---|---|---|
| `reportHeader` | 表題部 | 帳票の最初に 1 回 |
| `pageHeader` | ページヘッダ | 各ページの先頭 |
| `groupHeader` | グループヘッダ | `groupBy` の値が変わるたび |
| `detail` | 明細部 | データ 1 件ごとに 1 行 |
| `groupFooter` | グループフッタ (小計) | `groupBy` の値が変わる前 |
| `reportFooter` | 合計部 | 帳票の最後に 1 回 |
| `pageFooter` | ページフッタ | 各ページの末尾 |

`groupHeader` / `groupFooter` は `groupBy` (グループ化する項目の `source`) が必要。

### 2.5 項目 (`fields`)

| 項目 | 内容 |
|---|---|
| `id` | 項目 ID (camelCase。帳票内で一意) |
| `label` | 見出し・固定文言 |
| `kind` | `text` 固定文言 / `field` データの項目 / `aggregate` 集計 / `pageNumber` ページ番号 / `date` 出力日 |
| `source` | データの出どころ (`<テーブル ID>.<列の物理名>`、または `@param.<出力条件 ID>`)。`field` / `aggregate` で使う |
| `aggregate` | `sum` / `count` / `avg` / `min` / `max` (`aggregate` のとき) |
| `format` | 書式 (例: `#,##0` `¥#,##0` `YYYY/MM/DD`) |
| `align` | `left` / `center` / `right` |
| `width` | 幅 (部の中の割合 %)。省略すると残りを均等に分ける |
| `description` | 説明 |

## 3. 用紙の見本図

`shared/src/report.ts` の `reportToHtml` が、原本から決定的に描く (同じ入力から同じ図)。

- 用紙サイズと向きの比率の白い紙面に、部を上から並べる
- 各部の項目を横に並べる (`width` の割合)。`field` はデータ名を灰色の見本値で、`aggregate` は「合計: 見本値」のように示す
- 明細部は見本の行を 3 行出す。グループヘッダ / フッタには「グループ」の見本を示す
- 紙面の色は設計対象 (紙) の見本なので、アプリのテーマに関係なく明色

## 4. 検証

保存は妨げず、要確認として表示する (draft-state の方針)。

| コード | 重大度 | 内容 |
|---|---|---|
| `duplicate-id` | error | 部 ID / 項目 ID が重複 |
| `no-detail` | warning | 明細部がない (一覧・伝票系で CSV 以外) |
| `group-without-key` | warning | グループヘッダ / フッタに `groupBy` がない |
| `field-without-source` | warning | `field` / `aggregate` に `source` がない |
| `aggregate-without-func` | warning | `aggregate` に集計の種類 (`aggregate`) がない |
| `aggregate-in-detail` | info | 明細部の中の集計 (小計・合計は通常フッタに置く) |
| `unknown-param` | warning | `@param.<id>` が出力条件にない |
| `unknown-table` / `unknown-column` | warning | `source` のテーブル・列が存在しない |
| `unknown-screen` / `unknown-flow` | warning | 出力契機の画面・処理フローが存在しない |
| `width-over` | warning | 1 つの部の項目の幅の合計が 100% を超える |
| `no-trigger` | info | 出力契機がない |

## 5. 操作 (UI)

- ヘッダーメニュー「帳票」→ 一覧 (`/report/list`)。新規作成・複製・削除
- 編集 (`/report/edit/:id`): 左に基本設定 (名前・出力・契機・出力条件)、中央に用紙の見本図、右に選んだ部・項目の設定
  - 部の追加 (種類を選ぶ)、並べ替え、削除。項目の追加・並べ替え・削除
  - 項目の設定: 種類・見出し・データの出どころ (テーブル / 列を選ぶ)・書式・揃え・幅
  - 保存は明示的 (「保存」)。開いただけでは原本を書き換えない。元に戻す / やり直し
- 要確認 (検証結果) を見本図の下に表示する

## 6. AI (MCP) から

| ツール | 内容 |
|---|---|
| `designer__list_reports` | 帳票の一覧 (id / 名前 / 出力 / 部数 / 項目数 / 要確認の件数) |
| `designer__get_report` | 1 件の原本 + 検証結果 |
| `designer__save_report` | 1 件の保存 (検証結果を返す) |
| `designer__delete_report` | 1 件の削除 |

## 7. 関連の追従

画面・処理フローの ID を改名すると、出力契機の `screenRef` / `processFlowRef` も追従する。テーブル ID の改名は `source` の `<テーブル ID>.` に追従する。

## 8. 設計書

「帳票」の章 (定義があるときだけ) に、帳票ごとの基本情報 (出力・契機・出力条件)・用紙の見本図・項目定義表 (部 / 項目 / 種類 / 出どころ / 書式 / 揃え / 幅) を出す。出力契機から画面・処理フローへリンクする。
