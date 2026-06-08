# 家計簿アプリ (household-budget) サンプル

個人向け家計簿アプリの **Harmony v3 schema** 純正設計サンプル。設計者が新スキーマ (`schemas/v3/*.json`) のみを根拠に一から構築した、既存 examples からの流用を含まない参照実装。

## 業務概要

複数口座 (現金 / 銀行 / クレジット) を横断して日々の収支を記録し、カテゴリ別 / 月次の支出傾向を可視化する個人 PFM (Personal Finance Management) ツール。

### 想定ユーザー

家計を 1 人で管理する個人 (MVP は single-user 想定、user_id 列は将来の多人数対応を見据えた予約)。

### コアシナリオ

1. **取引登録**: 日付 + 口座 + カテゴリ + 金額 + メモ を入力して 1 件 INSERT
2. **取引一覧**: 時系列降順で過去取引を閲覧、行 click で取引編集画面へ遷移 (削除は編集画面の deleteButton から)
3. **月次レポート**: 対象月のカテゴリ別収支 + 収入 / 支出合計 / 差引残高
4. **カテゴリ管理**: 収支カテゴリの CRUD (初期 seed で 12 種類投入: 支出 8 + 収入 4、後述の seed/categories.json と整合)

## 技術スタック (techStack)

| layer | 採用 | 理由 |
|---|---|---|
| frontend.library | `react` | コンポーネント指向 + 豊富な可視化エコシステム (recharts / d3 等) |
| frontend.framework | `next` | App Router + Server Components で SSR/CSR を柔軟に切替可、`/generate-code` の React 系テンプレが Next.js を前提とするため整合 (#1306 で vite → next に変更) |
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

### Screens (6 個)

| path | kind | 役割 |
|---|---|---|
| `/` | dashboard | 当月収支 KPI + 直近取引 + クイックアクション |
| `/transactions` | list | 取引一覧 (日付グループ + occurred_on DESC、行 click で編集) |
| `/transactions/new` | form | 取引新規入力 (大きな金額入力 + 種別タブ + フォームカード) |
| `/transactions/:transactionId/edit` | form | 取引編集 (mount 時 load action で pre-fill、削除ボタン併設) |
| `/categories` | list | カテゴリ管理 (アイコン + 色プレビュー grid) |
| `/reports/monthly` | detail | 月次レポート (年月セレクタ + 3 KPI + カテゴリ別棒グラフ) |

各画面に対応する `<screen-id>.design.json` (GrapesJS shape + Tailwind HTML) を同梱しているため、designer で開いた瞬間からビジュアル付きで表示される (空キャンバスにならない)。

**注意**: design.json 内の表示値 (¥320,000 等の KPI 数値、6/14 等の日付、店名 / 用途のメモ等) は **demo 用のハードコード値**。実 runtime ではダッシュボード画面が `fetchDashboardData` flow を mount 時に実行し、`@summary.monthlyIncome` 等の flow variable で動的に上書きされる (各 item の `binding.kind="flowVariable"` 参照)。design.json は Tailwind aesthetic のプレビュー目的で seed データ相当の現実値を埋めてあるだけで、業務 logic 上の意味は持たない。

### ViewDefinitions (2 個)

| name | source | 役割 |
|---|---|---|
| 取引一覧 viewer | `transactions` + JOIN (accounts / categories) | level 2 構造化クエリ |
| カテゴリ一覧 viewer | `categories` | level 1 (sourceTableId) シンプル |

### ProcessFlows (5 個)

| name | flowType | screen | 主処理 |
|---|---|---|---|
| 取引登録 | `screen` | `/transactions/new` | validation → INSERT → 201 |
| 取引削除 | `screen` | `/transactions/:transactionId/edit` | snapshot SELECT → DELETE (user_id 一致 WHERE) → event publish → 204 (削除 UX は編集画面 deleteButton から発火) |
| 月次レポート取得 | `screen` | `/reports/monthly` | validation → category 別 SELECT → 合計 SELECT → compose → 200 |
| 取引更新 | `screen` | `/transactions/:transactionId/edit` | 2 アクション: load (GET, mount 時 pre-fill) + update (PUT, submit 時 UPDATE) |
| ダッシュボードデータ取得 | `screen` | `/` | mount 時 (trigger=load) に当月収支サマリ + 直近 5 件取引を取得、画面 items の `binding.kind="flowVariable"` 経由で bind |

## 設計判断 (主なもの)

- **残高は永続化せず集計クエリで算出** (createTransaction flow の ADR-001): 整合 update を避けるため。SQLite + 個人規模では集計コストは無視できる
- **金額は常に正値** (transactions.amount CHECK 制約): 符号は category_type で表現、UI 側で income/expense を視覚的に分離
- **所有者チェックは WHERE で防御**: DELETE / UPDATE 時に `user_id = @sessionUserId` を必須化、ID 直叩きで他ユーザーデータを触れない
- **収支カテゴリは user ごとに独立**: 同一ユーザー内で `(user_id, name)` UNIQUE、ユーザー間の分離は cascade FK で担保

## v3 schema 採用ポイント

| 領域 | 採用機能 | 場所 |
|---|---|---|
| EntityMeta mix-in | allOf で全 entity 共通 meta | 全 entity JSON |
| Pattern A 参照 | EntityId 直接参照 (`tableId`, `screenId`, `processFlowId`、kebab-case 例: `transactions-table`) | 全画面 / flow |
| ConstraintDefinition | FK / UNIQUE / CHECK を kind discriminated | tables/*.json |
| FieldType extension | array + object + tableList + tableRow | screen `categoryBreakdown` 等 |
| ProcessFlow 4 セクション | meta / context / actions / authoring | process-flows/*.json |
| context.catalogs.errors | UPPER_SNAKE error code | createTransaction の VALIDATION_FAILED 等 |
| ValidationStep + inlineBranch | NG 時 400 即返却 | createTransaction step-01 |
| dbAccess.affectedRowsCheck | 更新件数で異常検出 | deleteTransaction step-01 (404 へ throw) |
| ViewDefinition Level 1 / 2 | 単純 + JOIN を kind 別 | view-definitions/*.json |
| Convention catalog | currency / regex / limit / msg / db | conventions/catalog.json |

## 初期データ (seed)

examples だから最初から多様なデータを入れている。`seed/` ディレクトリに以下:

| ファイル | 件数 | 内容 |
|---|---|---|
| `seed/users.json` | 1 | デモユーザー (login_id=`demo`) |
| `seed/accounts.json` | 3 | 財布 / みずほ銀行 / 楽天カード |
| `seed/categories.json` | 12 | 支出 8 + 収入 4 (色 + アイコン付き) |
| `seed/transactions.json` | 40 | 2026-04 〜 2026-06 の取引 (給与 / 家賃 / 食費 / GW 旅行 / 副収入 / ボーナス 等を含む現実的な多様性) |

詳細は `seed/README.md` 参照。NestJS の起動時 seed として読み込む想定 (`INSERT OR IGNORE` で idempotent)。

## Generic Definition Catalog (14 kind, 38 entries)

`harmony/generic-definitions/<kind>/<Name>.json` 配下に v3 schema の有効 kind のうち 14 kind を dogfood している。conventions catalog がフラット辞書を提供するのに対し、こちらは「kind ごとの構造化された再利用ピース」として 1 ファイル 1 エントリで管理。

| kind | 件数 | 例 |
|---|---:|---|
| `message` | 10 | TransactionCreated / DeleteConfirm / AmountRequired / InvalidYearMonthFormat 等 (i18n source、`@msg.<Name>` 参照元) |
| `validation-rule` | 4 | AmountPositiveRange / AmountRequired / MemoMaxLength / YearMonthFormat (`@validation.<Name>`) |
| `domain-type` | 3 | Money (通貨単位付き) / YearMonth / AccountType (`@<scope>.<Name>` で参照) |
| `exception-type` | 3 | TransactionNotFoundException / ValidationException / ForeignKeyViolationException — `errorCatalog.exceptionTypeRef` で参照 |
| `domain-event` | 3 | TransactionCreated / Updated / Deleted — `context.catalogs.events` に登録 + `EventPublishStep` から発火 |
| `constants` | 2 | TransactionLimits (minAmount / maxAmount / memoMaxLength) / UndoWindow (`@const.<Name>` 参照元) |
| `data-contract` | 2 | TransactionCreateRequest / MonthlyReportResponse (API I/O 契約) |
| `application-rule` | 2 | DeficitWarning (赤字バナー) / HighExpenseAlert (10 万円超 confirm) |
| `component-definition` | 2 | BalanceCalculator (NestJS service) / CurrencyFormatter (純粋関数) |
| `ui-behavior` | 1 | FormDirtyConfirmExit (未保存離脱の確認) |
| `runtime-policy` | 2 | BackendRetryPolicy / HttpTimeoutPolicy |
| `log-config` | 1 | DefaultLogConfig (env-based level / 構造化 JSON / PII redact) |
| `log-event` | 2 | TransactionAuditCreated / TransactionAuditDeleted (監査ログ、365 日保管) |

### v3 schema との配線

- **`processFlow.context.catalogs.errors.<CODE>.exceptionTypeRef`** → `generic-definitions/exception-type/<Name>` (process-flows/createTransaction / deleteTransaction / updateTransaction / fetchMonthlyReport の 4 flow で配線済、fetchDashboardData は読取のみで error catalog 不要)
- **`processFlow.context.catalogs.events.<topic>`** に domain-event を登録 → `EventPublishStep.topic` で発火 (createTransaction / deleteTransaction / updateTransaction)
- **`ValidationRule.exceptionTypeRef`** → exception-type 参照 (全 6 rule × 3 flow で配線済)
- **`Description` 等のテキスト**で `generic-definitions/<kind>/<Name>` パスを reference 文字列として相互リンク

### dogfood で見つけた validator gap

- `@msg.<Name>` 形式の参照は `identifierScope` validator が `@msg` を bare variable と誤解する。canonical 設計では `@msg.<Name>` が generic-definitions/message/ の参照だが、現在の validator はこれを認識しない。**回避策**: 本サンプルでは `ValidationRule.message` に `@conv.msg.<key>` (旧 conventions 規約参照) を使用、参照表現の dogfood は exception-type/domain-event/context.catalogs で実施。

## ディレクトリ構成

```
examples/household-budget/
├── harmony.json              # workspace marker + techStack + entities 一覧
├── README.md                 # 本ファイル
├── seed/                     # 初期サンプルデータ (1 + 3 + 12 + 40 = 56 行)
│   ├── README.md
│   ├── users.json
│   ├── accounts.json
│   ├── categories.json
│   └── transactions.json
└── harmony/                  # dataDir (harmony.json の dataDir で指定)
    ├── conventions/catalog.json
    ├── tables/<uuid>.json           × 4
    ├── views/<uuid>.json            × 1
    ├── view-definitions/<uuid>.json × 2
    ├── screens/<uuid>.json          × 6
    ├── screens/<uuid>.design.json   × 6  (Tailwind HTML)
    ├── process-flows/<uuid>.json    × 5
    └── generic-definitions/         # 14 kind dogfood (38 ファイル)
        ├── message/                 × 10
        ├── validation-rule/         × 4
        ├── domain-type/             × 3
        ├── exception-type/          × 3
        ├── domain-event/            × 3
        ├── constants/               × 2
        ├── data-contract/           × 2
        ├── application-rule/        × 2
        ├── component-definition/    × 2
        ├── ui-behavior/             × 1
        ├── runtime-policy/          × 2
        ├── log-config/              × 1
        └── log-event/               × 2
```

## 動作確認

```bash
cd frontend
npm install
npm run validate:samples -- ../examples/household-budget
```

## 生成 app (generated/)

`examples/household-budget/generated/` には Harmony JSON 設計から生成した動く NestJS + Next.js + Prisma + JWT アプリケーションが配置されている (#1306)。

### 構成

| layer | 場所 | 技術 |
|---|---|---|
| Backend | `generated/src/` | NestJS 10 + Prisma 5 + SQLite + JWT |
| Frontend | `generated/src/app/` | Next.js 14 App Router + React 18 + Tailwind 3 |
| DB | `generated/prisma/` | schema + seed loader |
| E2E test | `generated/test/e2e/` | Playwright (J1-J7 user journey) |

### 起動手順

```bash
cd examples/household-budget/generated
npm install
DATABASE_URL=file:./prisma/dev.db npm run db:push
DATABASE_URL=file:./prisma/dev.db npm run db:seed

# 別ターミナルで backend (port 3001)
npm run start:backend

# 別ターミナルで frontend (port 3000)
npm run start:frontend
```

ブラウザで http://localhost:3000 にアクセスし、デモアカウント (login_id: `demo` / password: `demo123`) でログイン可能。

### E2E テスト実行

```bash
cd examples/household-budget/generated
npx playwright install chromium  # 初回のみ
npm run test:p4
```

J1〜J7 を網羅した 9 spec が pass する。

## 既知の MVP 範囲外

- 認証画面 (login) — jwt 発行 / 検証は backend NestJS guard 想定、画面 / フローは未実装
- 口座 CRUD 画面 — seed で 3 口座を投入済だが、UI からの追加 / 編集はない (将来)
- 予算機能 — `budgets` table + 進捗バー UI は別 sample / 別 PR で
- インポート (CSV / Money Forward) — 将来検討
- カテゴリ CRUD 画面 — 一覧表示のみ、新規 / 編集 / 削除 UI はない (seed で 12 件投入済)
