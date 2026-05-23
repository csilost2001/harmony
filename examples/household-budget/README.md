# 家計簿アプリ (household-budget) サンプル

個人向け家計簿アプリの **Harmony v3 schema** 純正設計サンプル。設計者が新スキーマ (`schemas/v3/*.json`) のみを根拠に一から構築した、既存 examples からの流用を含まない参照実装。

## 業務概要

複数口座 (現金 / 銀行 / クレジット) を横断して日々の収支を記録し、カテゴリ別 / 月次の支出傾向を可視化する個人 PFM (Personal Finance Management) ツール。

### 想定ユーザー

家計を 1 人で管理する個人 (MVP は single-user 想定、user_id 列は将来の多人数対応を見据えた予約)。

### コアシナリオ

1. **取引登録**: 日付 + 口座 + カテゴリ + 金額 + メモ を入力して 1 件 INSERT
2. **取引一覧**: 時系列降順で過去取引を閲覧、行スワイプで削除
3. **月次レポート**: 対象月のカテゴリ別収支 + 収入 / 支出合計 / 差引残高
4. **カテゴリ管理**: 収支カテゴリの CRUD (初期 seed で 8 種類投入想定)

## 技術スタック (techStack)

| layer | 採用 | 理由 |
|---|---|---|
| frontend.library | `react` | コンポーネント指向 + 豊富な可視化エコシステム (recharts / d3 等) |
| frontend.framework | `vite` | 軽量 + HMR が速い、個人開発に最適 |
| designer.editorKind | `puck` | React コンポーネントツリー編集、後で生コード生成しやすい |
| designer.cssFramework | `tailwind` | 余白 / soft shadow / rounded-2xl で先進的 B2C アプリの見た目を実現 |
| backend.language | `typescript` | frontend と型を共有可能、JSON Schema → 型生成と相性良 |
| backend.framework | `nestjs` | DI + Module 構造で家計簿の境界 (transaction / account / category) を素直に表現 |
| database.type | `sqlite` | 軽量、個人規模 (取引数 < 数万) で十分 / ファイル 1 つで持ち運べる |
| auth.method | `jwt` | API stateless、PWA / モバイル拡張への布石 |
| deployment.target | `docker` | nestjs + sqlite を 1 コンテナで配布 |

## エンティティ構成

### Tables (4 個)

| 物理名 | 役割 |
|---|---|
| `users` | アプリ利用者 (jwt 認証元) |
| `accounts` | 口座 (現金 / 銀行 / クレジット)、複数所有可 |
| `categories` | 収支カテゴリ (食費 / 給与 等)、`category_type` で income / expense 判別 |
| `transactions` | 取引ログ (本アプリの中核)、`account_id` / `category_id` への FK 必須 |

### Views (1 個)

| 物理名 | 役割 |
|---|---|
| `v_monthly_summary` | `user_id × year_month × category_type` で SUM 集計、レポート画面が SELECT |

### Screens (5 個)

| path | kind | 役割 |
|---|---|---|
| `/` | dashboard | 当月収支 KPI + 直近取引 + カテゴリ別ドーナツ |
| `/transactions` | list | 取引一覧 (occurred_on DESC) |
| `/transactions/new` | form | 取引新規入力 |
| `/categories` | list | カテゴリ管理 |
| `/reports/monthly` | detail | 月次レポート (年月セレクタ + KPI + 棒グラフ) |

### ViewDefinitions (2 個)

| name | source | 役割 |
|---|---|---|
| 取引一覧 viewer | `transactions` + JOIN (accounts / categories) | level 2 構造化クエリ |
| カテゴリ一覧 viewer | `categories` | level 1 (sourceTableId) シンプル |

### ProcessFlows (3 個)

| name | flowType | screen | 主処理 |
|---|---|---|---|
| 取引登録 | `screen` | `/transactions/new` | validation → INSERT → 201 |
| 取引削除 | `screen` | `/transactions` | DELETE (user_id 一致 WHERE) → affectedRows=1 検査 → 204 |
| 月次レポート取得 | `screen` | `/reports/monthly` | validation → category 別 SELECT → 合計 SELECT → compose → 200 |

## 設計判断 (主なもの)

- **残高は永続化せず集計クエリで算出** (createTransaction flow の ADR-001): 整合 update を避けるため。SQLite + 個人規模では集計コストは無視できる
- **金額は常に正値** (transactions.amount CHECK 制約): 符号は category_type で表現、UI 側で income/expense を視覚的に分離
- **所有者チェックは WHERE で防御**: DELETE / UPDATE 時に `user_id = @sessionUserId` を必須化、ID 直叩きで他ユーザーデータを触れない
- **収支カテゴリは user ごとに独立**: 同一ユーザー内で `(user_id, name)` UNIQUE、ユーザー間の分離は cascade FK で担保

## v3 schema 採用ポイント

| 領域 | 採用機能 | 場所 |
|---|---|---|
| EntityMeta mix-in | allOf で全 entity 共通 meta | 全 entity JSON |
| Pattern A 参照 | Uuid 直接参照 (`tableId`, `screenId`, `processFlowId`) | 全画面 / flow |
| ConstraintDefinition | FK / UNIQUE / CHECK を kind discriminated | tables/*.json |
| FieldType extension | array + object + tableList + tableRow | screen `categoryBreakdown` 等 |
| ProcessFlow 4 セクション | meta / context / actions / authoring | process-flows/*.json |
| context.catalogs.errors | UPPER_SNAKE error code | createTransaction の VALIDATION_FAILED 等 |
| ValidationStep + inlineBranch | NG 時 400 即返却 | createTransaction step-01 |
| dbAccess.affectedRowsCheck | 更新件数で異常検出 | deleteTransaction step-01 (404 へ throw) |
| ViewDefinition Level 1 / 2 | 単純 + JOIN を kind 別 | view-definitions/*.json |
| Convention catalog | currency / regex / limit / msg / db | conventions/catalog.json |

## ディレクトリ構成

```
examples/household-budget/
├── harmony.json              # workspace marker + techStack + entities 一覧
├── README.md                 # 本ファイル
└── harmony/                  # dataDir (harmony.json の dataDir で指定)
    ├── conventions/catalog.json
    ├── tables/<uuid>.json    × 4
    ├── views/<uuid>.json     × 1
    ├── view-definitions/<uuid>.json × 2
    ├── screens/<uuid>.json   × 5
    └── process-flows/<uuid>.json × 3
```

## 動作確認

```bash
cd frontend
npm install
npm run validate:samples -- ../examples/household-budget
```

## 既知の MVP 範囲外

- 認証画面 (login) — jwt 発行 / 検証は backend NestJS guard 想定、画面 / フローは未実装
- 口座 CRUD 画面 — 初期 seed で 1 口座固定、複数口座 UI は将来
- 取引編集画面 — 新規入力のみ、編集は同 form 画面の URL 引数で対応する想定
- 予算機能 — `budgets` table + 進捗バー UI は別 sample / 別 PR で
- インポート (CSV / Money Forward) — 将来検討
