# examples/retail/ — リテール総合サンプル仕様書

`examples/retail/` の業務スコープ・データモデル・画面構成・進め方をまとめた spec。Sonnet サブエージェントへの briefing 兼用。

関連: [#680](https://github.com/csilost2001/harmony/issues/680) (親メタ) / [#706](https://github.com/csilost2001/harmony/issues/706) (本作業) / `examples/retail/README.md`

## 1. 目的

リリース時に examples として提供する **完結 業務 workspace サンプル**。業務概要から AI が全仕様書を生成できることを実証 (Phase 4 の継続)、かつ業務系として **見本となる品質** (画面の見栄え / 整合性 / カバレッジ) を確保する。

## 2. 業務スコープ

### 2.1 業態

EC + 店舗 POS + 在庫管理 のミックス。中規模 (画面 ~11、テーブル ~8、処理フロー ~4、view ~3-4、sequence ~2-3)。

### 2.2 4 シナリオ + 補助

| シナリオ ID | 概要 | 関連 entity |
|---|---|---|
| **S-1 店舗在庫照会** | 商品コード・店舗で在庫検索。低在庫閾値で警告表示。 | 画面: 商品検索 / 在庫一覧 ・ flow: search-inventory ・ table: products / inventory / stores |
| **S-2 カート追加** | 商品をカートへ追加 (重複排除 + null/0 区別)。 | 画面: カート画面 / 追加モーダル ・ flow: add-to-cart ・ table: carts / cart_items |
| **S-3 注文確定 (TX)** | カート → 確認 → 完了。在庫引き当て + 注文登録 + 採番を 1 TX。 | 画面: カート確認 / 完了 ・ flow: confirm-order ・ table: orders / order_items / inventory ・ sequence: order-number |
| **S-4 配送指示** | 注文一覧 (バックオフィス) → 配送指示。外部キャリア API。 | 画面: 注文一覧 / 配送指示 ・ flow: dispatch-shipment ・ table: shipments ・ extension: retail dbOperations + stepKinds |

補助画面: ダッシュボード、商品マスター、顧客マスター、店舗マスター。

### 2.3 画面一覧 (約 11)

| # | 画面名 | kind | path | 関連シナリオ |
|---|---|---|---|---|
| 1 | ダッシュボード | dashboard | `/` | (root) |
| 2 | 商品検索 | search | `/products/search` | S-1 |
| 3 | 在庫一覧 | list | `/inventory` | S-1 |
| 4 | カート画面 | retail:cart | `/cart` | S-2/S-3 |
| 5 | カート確認 | confirm | `/cart/confirm` | S-3 |
| 6 | 注文完了 | complete | `/order/complete` | S-3 |
| 7 | 注文一覧 (BO) | list | `/orders` | S-4 |
| 8 | 配送指示 | form | `/orders/:id/dispatch` | S-4 |
| 9 | 商品マスター | list | `/master/products` | 補助 |
| 10 | 顧客マスター | list | `/master/customers` | 補助 |
| 11 | 店舗マスター | list | `/master/stores` | 補助 |

### 2.4 テーブル一覧 (約 8)

| # | physicalName | カテゴリ | 主用途 |
|---|---|---|---|
| 1 | products | マスタ | 商品 |
| 2 | customers | マスタ | 顧客 |
| 3 | stores | マスタ | 店舗 |
| 4 | inventory | トランザクション | 店舗別在庫 |
| 5 | carts | トランザクション | カート (顧客 1:1) |
| 6 | cart_items | トランザクション | カート明細 (`(cart_id, product_id, store_id)` で重複排除、multi-store inventory 整合) |
| 7 | orders | トランザクション | 注文 |
| 8 | order_items | トランザクション | 注文明細 (`store_code_snapshot` で発送元店舗を履歴保存) |
| (9) | shipments | トランザクション | 配送指示 (S-4 で必要なら追加) |

### 2.5 拡張 namespace `retail`

- `extensions/retail.v3.json` — fieldTypes / actionTriggers / dbOperations / stepKinds / responseTypes を 1 ファイルに統合した v3 canonical combined format

### 2.6 conventions catalog

- `numbering.order-number` — 注文番号採番 (sequences/order-number と紐付き)
- `regex.product-code` — 商品コード正規表現
- `regex.jan-code` — JAN コード正規表現
- `messages.stock-shortage` — 在庫不足メッセージ
- `lowStockThreshold` — 低在庫閾値 (S-1 で参照)

## 3. 設計判断

### 3.1 ID 規約

- top-level entity (Project / Screen / Table / ProcessFlow / View / Sequence) は **`Uuid` 形式 (RFC 4122 v4)** を使用。`crypto.randomUUID()` 由来の値を埋め込む。
- ネスト LocalId は kebab-case (例: `step-01`, `col-product-code`)。
- 業務識別子 (画面項目 ID / 処理フロー変数名) は lowerCamelCase (例: `productCode`, `cartId`)。
- DB 物理名は snake_case (例: `order_items`, `inventory`)。

### 3.2 画面 HTML の品質要件

- Bootstrap 5 ベース、**清潔・実用的** (派手すぎない、業務見本として違和感ないレベル)
- 4 テーマ (standard / card / compact / dark) で破綻しないこと (CSS 過剰指定を避ける)
- `data-item-id` / `name` 属性は screen-items 定義と一致 (#323 抽出機能で連携)
- レスポンシブ: FHD / 4K で情報密度活用、極端に狭い幅では破綻可
- アクセシビリティ: form の `<label for>`, button の `aria-label` を最低限カバー

### 3.3 動作確認は data/ コピー (デプロイ相当) を推奨

`examples/retail/` は **git 管理の正本** で、直接開いて編集すると git 差分になる。本プロジェクトのサンプル更新作業以外では、以下の運用を推奨する。

- **動作確認 / 試行錯誤**: `examples/retail/` を **`data/` または任意フォルダにコピー** (デプロイ相当) して使う。data/ は gitignored なので自由に編集できる
- **直接開いて見るだけ**は可。ただし編集して保存すると git 差分になるので **自己責任**
- AI は examples/ 配下を **明示指示なしには git add しない** (誤コミット防止)
- **lockdown モードの誤解注意**: env `DESIGNER_DATA_DIR` で起動する lockdown モードは「workspace 切替を禁止する固定モード」であり、データの read-only モードではない。lockdown でも編集 / 保存は可能でファイルが書き換わる
- **本プロジェクトのサンプル更新**は examples/ 直接編集して PR (例: schema v4 移行に伴う retail サンプル更新)

### 3.4 schemas/v3 は変更しない

- 業務記述で表現できないものは extension で対処。schemas/v3 を変更したくなったら ISSUE 起票して停止 (#511 / AGENTS.md schema governance 準拠)

### 3.5 multi-store inventory 整合 (#780)

- 商品検索 (S-1) → カート追加 (S-2) → 注文確定 (S-3) の遷移で **「どの店舗から商品を確保するか」を一貫して保持** する
- `cart_items.store_id` (NOT NULL FK→stores) で店舗単位の重複排除 (UNIQUE `(cart_id, product_id, store_id)`)。同一商品でも別店舗から追加した場合は別行として保持
- カート画面 (c73fa05c) は `addStoreCode` 入力で店舗を必須選択させる
- 注文確定 TX の在庫減算は `UPDATE inventory ... WHERE store_id = @cartItem.storeId` で各店舗の inventory を独立に減算
- `order_items.store_code_snapshot` に注文時点の店舗コードを保存し、配送指示 (S-4) や履歴照会で参照する
- 中央倉庫モデルが必要になれば 'CENTRAL' 等の専用 storeCode を導入すれば対応可能 (現状は店舗網羅 multi-store 前提)

## 4. 受け入れ基準

- [ ] `examples/retail/project.json` が `schemas/v3/project.v3.schema.json` で AJV pass
- [ ] 全 entity ファイルが対応する v3 schema で pass
- [ ] designer 上で「フォルダを追加 → examples/retail」で開け、各一覧が描画される
- [ ] 4 シナリオの画面が画面フロー上で繋がっている (画面遷移定義あり)
- [ ] 画面 HTML が **見栄え要件 (3.2)** を満たす
- [ ] AJV 全件検証 test に examples/ を追加し、`npx vitest run` 全 pass
- [ ] vitest / Playwright / TypeScript 全 pass
- [ ] 半角カナ混入 0 件

## 5. 進め方 (シリーズ実装、`feat/samples-retail` ブランチ)

| Step | 担当 | スコープ |
|---|---|---|
| Step 1 | Opus | spec docs (本ファイル) + project.json 雛形 + README + .gitignore |
| Step 2 | Sonnet | 業務データ層 (tables / extensions/retail / conventions catalog)。テーブル ID を確定 |
| Step 3 | Sonnet | 処理フロー × 4 (Step 2 の table ID 参照、4 シナリオ実装) |
| Step 4 | Sonnet | UI 層 (screens HTML 見栄え重視 / screen-items / 画面フロー / view / view-definition / sequence) |
| Step 5 | Opus | AJV 全件検証 test に examples/ 追加 + smoke (multi-workspace で開いて表示確認) |
| Step 6 | Opus | PR 作成 → 独立レビュー → Must-fix 解決 → マージ |

## 6. 既存材料との関係

- `docs/sample-project/` の retail 材料 (Phase 4 retail validation 由来、`gggggggg-0001..0004` 等) は **本サンプルでは使用しない**。docs/sample-project/ は dogfood 一時作業領域、examples/retail/ はリリース版正本という役割分担 (memory `project_samples_strategy_2026_05_02.md`)
- リリース前なので backward compat は考慮しない (memory `feedback_no_backward_compat_pre_release.md`)

## 7. テスト fixture としての利用

```bash
# 固定 workspace でアプリ起動 (AI の動作確認 / E2E テスト)
DESIGNER_DATA_DIR=examples/retail npm run dev:mcp
```

`schemas/v3/*.test.ts` (AJV) に examples/**/*.json を組み込み、schema 進化時の regression を検出。
