# ViewDefinition (画面 一覧 UI viewer)

**ステータス**: v3 整合 (schema v3、3 レベル DSL #745 反映済)
**初版日**: 2026-05-03
**関連 issue**: #649 (Phase 4 子 1 — schema / type / validator 新設) / #666 (UI 編集機能 — ListView / Editor / store) / #745 (Level 2 Structured / Level 3 Raw SQL の 3 レベル DSL 化) / #761 (本 spec docs 整備)

本書は `ViewDefinition` (画面側の一覧 UI viewer 設定) の仕様を定める。`schemas/v3/view-definition.v3.schema.json` の機械可読仕様を補完し、設計者および AI 実装者が「どのレベルで書くか」「Screen とどう連携するか」「どの validator が何を検出するか」を判断できるよう情報を集約する。

## 位置づけ

`ViewDefinition` は画面 UI 上で配列データを「表 / カード / カンバン / カレンダー」として表現する **viewer 設定** である。同じ「View」という単語が DB にも存在するため軸を明確にする:

| 概念 | 場所 | axis | 役割 |
|---|---|---|---|
| **ViewDefinition** (本書) | `view-definitions/<id>.json` | 画面 (UI viewer) | 1 viewer = 1 source、列を画面表示型 (FieldType) で表現。Screen は items[] の `direction: "viewer"` screen-item から `viewDefinitionId` で 1:N 参照される |
| DB View | `views/<id>.json` (`schemas/v3/view.v3.schema.json`) | DB (永続化層 SELECT) | SQL VIEW / Materialized View の物理定義。複数アクションから共通の SELECT として参照される |

両者は名前が似ているが axis が異なるため独立 schema として分離されている (#649 設計判断)。ViewDefinition は ViewColumn の値を「画面で見せる時の型 (FieldType)」で記述し、DB View は永続化された SELECT 結果のスキーマ (DataType) を持つ。ViewDefinition の Level 2 / Level 3 は DB View を介さず query を直接記述する (DB View の薄い置換ではなく、画面ごとに固有の集計が必要な場合の primary な手段)。

### 一次成果物

- JSON Schema: [`schemas/v3/view-definition.v3.schema.json`](../../schemas/v3/view-definition.v3.schema.json) ([README](../../schemas/README.md))
- TypeScript 型: [`frontend/src/types/v3/view-definition.ts`](../../frontend/src/types/v3/view-definition.ts)
- validator: [`frontend/src/schemas/viewDefinitionValidator.ts`](../../frontend/src/schemas/viewDefinitionValidator.ts)

## データモデル

### ViewDefinition

```typescript
interface ViewDefinition {
  /** UUID。同プロジェクト内で一意。 */
  id: Uuid;
  /** 表示名 (DisplayName)。 */
  name: DisplayName;
  /** 説明。 */
  description?: Description;
  /** 成熟度 (draft / review / committed)。draft-state policy に従う。 */
  maturity: Maturity;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601

  /** viewer 種別。組み込み 4 種 + 拡張参照。 */
  kind: "list" | "detail" | "kanban" | "calendar"
      | `${string}:${string}`;  // namespace:kindName

  /** Level 1 (Simple): 主要ソーステーブル ID。query と排他。 */
  sourceTableId?: Uuid;

  /** Level 2 / Level 3 の query 定義。sourceTableId と排他。 */
  query?: ViewQuery;

  /** 必須: viewer に表示する列定義 (1 件以上、表示順は配列順)。 */
  columns: ViewColumn[];

  /** 既定ソート (複数列対応、columnName は columns[].name 参照)。 */
  sortDefaults?: SortSpec[];

  /** 初期フィルタ (静的)。動的 filter binding は spec 範囲外 (#762)。 */
  filterDefaults?: FilterSpec[];

  /** ページング初期件数 (1〜1000)。 */
  pageSize?: number;

  /** kanban / グルーピング表示時の集約キー (columns[].name 参照)。 */
  groupBy?: Identifier;

  /** authoring 情報 (decisions / glossary 等)。 */
  authoring?: Authoring;
}
```

### ViewColumn

```typescript
interface ViewColumn {
  /** 列識別子 (camelCase、ViewDefinition 内で一意)。
   *  sortDefaults / filterDefaults / groupBy が参照する。 */
  name: Identifier;

  /** 参照する table カラム (Pattern B 複合参照)。
   *  Level 1: sourceTableId と一致するべき。違うと JOIN_NOT_DECLARED warning。
   *  Level 2: query.from / query.joins[] のいずれかに含まれる tableId であること。
   *  Level 3: 省略可 (SQL 結果として name + type のみで宣言)。 */
  tableColumnRef?: TableColumnRef;

  /** 列ヘッダー表示名。 */
  displayName?: DisplayName;

  /** 必須: 画面表示型 (FieldType)。
   *  Level 1/2 では参照先 Column.dataType と互換であること (validator 検査)、
   *  Level 3 では SQL 結果と一致することを設計者が保証する。 */
  type: FieldType;

  /** 表示書式 (例: '#,##0' / 'YYYY-MM-DD' / '¥#,##0')。 */
  displayFormat?: string;

  /** 列幅 (CSS 表記、例: '120px' / '1fr' / 'auto')。 */
  width?: string;

  align?: "left" | "center" | "right";
  sortable?: boolean;
  filterable?: boolean;

  /** 列表示条件式 (式言語)。 */
  visibleWhen?: ExpressionString;

  /** セル click で navigate する path (例: '/orders/:id'、:colon で同行値を埋め込み)。 */
  linkTo?: string;
}
```

### SortSpec / FilterSpec

```typescript
interface SortSpec {
  /** ViewColumn.name 参照。 */
  columnName: Identifier;
  order: "asc" | "desc";
}

interface FilterSpec {
  /** ViewColumn.name 参照。 */
  columnName: Identifier;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
          | "contains" | "startsWith" | "in" | "between";
  /** リテラル値 (operator 依存: in は array、between は [min, max] 等)。 */
  value?: unknown;
  /** 比較値を式で渡す場合 (例: '@conv.numbering.lowStockThreshold')。 */
  valueExpression?: ExpressionString;
}
```

## 3 レベル DSL の使い分け (#745)

`sourceTableId` と `query` は排他関係。次の判断フローでレベルを選ぶ:

```
1 テーブルだけで完結?
├─ Yes → Level 1 (Simple、sourceTableId)
└─ No  → 複数テーブル JOIN が必要
         │
         window / CTE / 再帰 / UNION 等が必要?
         ├─ No  → Level 2 (Structured、query.from + joins + where/groupBy/...)
         └─ Yes → Level 3 (Raw SQL、query.sql + parameterRefs)
```

### Level 1 (Simple)

1 ベース table をそのまま列挙する最小構成。マスタ画面・単純な明細一覧で多用される。

実例: [`examples/retail/view-definitions/db10b1f4-...json`](../../examples/retail/view-definitions/db10b1f4-459c-4bd3-bb27-76394209671d.json) (商品マスター一覧 5 列)

```jsonc
{
  "kind": "list",
  "sourceTableId": "652cbbfe-...",  // products テーブル
  "columns": [
    {
      "name": "productCode",
      "tableColumnRef": { "tableId": "652cbbfe-...", "columnId": "col-product-code" },
      "displayName": "商品コード",
      "type": "string",
      "width": "120px",
      "sortable": true,
      "filterable": true,
      "linkTo": "/master/products/:id"
    }
    // ...
  ],
  "sortDefaults": [{ "columnName": "productCode", "order": "asc" }],
  "filterDefaults": [{ "columnName": "isActive", "operator": "eq", "value": true }],
  "pageSize": 50
}
```

**Level 1 で済むケース**: 1 テーブル単独。ただし FK 参照のために `tableColumnRef.tableId` が `sourceTableId` と異なる列を混ぜると暗黙 join となり `JOIN_NOT_DECLARED` warning。多い場合は Level 2 にアップグレード。

### Level 2 (Structured)

`query.from` (起点テーブル + alias) + `query.joins[]` (INNER/LEFT/RIGHT/FULL) + `where` / `groupBy` / `having` / `orderBy` を SQL fragment 配列で記述する。alias を SQL 内で参照できる。

```jsonc
{
  "kind": "list",
  "query": {
    "from": { "tableId": "<orders-uuid>", "alias": "o" },
    "joins": [
      {
        "kind": "INNER",
        "tableId": "<customers-uuid>",
        "alias": "c",
        "on": ["o.customer_id = c.id"]
      }
    ],
    "where": ["o.status != 'cancelled'"],
    "orderBy": ["o.ordered_at DESC"]
  },
  "columns": [
    {
      "name": "orderNumber",
      "tableColumnRef": { "tableId": "<orders-uuid>", "columnId": "col-order-number" },
      "displayName": "注文番号",
      "type": "string"
    },
    {
      "name": "customerName",
      "tableColumnRef": { "tableId": "<customers-uuid>", "columnId": "col-name" },
      "displayName": "顧客名",
      "type": "string"
    }
    // ...
  ]
}
```

**Level 2 を選ぶ判断基準**:
- 2 テーブル以上の JOIN が必要
- WHERE で同テーブル内の列で絞り込みたい (e.g. `o.status != 'cancelled'`)
- GROUP BY / HAVING で集計が必要 (ただし window 関数や CTE は Level 3)

`alias` の pattern は `^[a-z][a-z0-9_]*$` (先頭小文字 + 小文字英数 / アンダースコア)、`from.alias` と `joins[].alias` の組合せ重複は不可 (validator `DUPLICATE_QUERY_ALIAS` が検査)。

### Level 3 (Raw SQL)

`query.sql` に完全 SQL 文を直接書く escape hatch。window 関数 / CTE / 再帰 / UNION / 複雑な ROW_NUMBER 等、Level 2 では表現できない場合に使う。validator は SQL 構文を解析せず `columns[]` の宣言を信頼する (実行時保証)。

実例: [`examples/retail/view-definitions/37a3af9a-...json`](../../examples/retail/view-definitions/37a3af9a-f240-4fbb-b33d-6937305b430b.json) (カテゴリ別売れ筋商品 上位 N、ROW_NUMBER + CTE)

```jsonc
{
  "kind": "list",
  "query": {
    "sql": "WITH ranked AS (SELECT id, name, category, unit_price, ROW_NUMBER() OVER (PARTITION BY category ORDER BY unit_price DESC) AS rn FROM products WHERE is_active = true) SELECT id, name, category, unit_price, rn FROM ranked WHERE rn <= @param.topN ORDER BY category ASC, rn ASC",
    "parameterRefs": [
      {
        "name": "topN",
        "fieldType": "integer",
        "description": "各カテゴリで取得する上位件数。"
      }
    ]
  },
  "columns": [
    { "name": "rn", "type": "integer", "displayName": "順位" }
    // ... tableColumnRef は省略可
  ]
}
```

**SQL 内の補間記法**:
- `@<var>` — フロー変数 (呼び出し側 context)
- `@conv.*` — 規約カタログ参照
- `@env.*` — 環境変数
- `@param.<name>` — `parameterRefs[]` で宣言した外部パラメータ (画面 filter / Screen binding 等から)

**注意**: parameterRefs は静的な型宣言のみ。画面の input 項目から動的に filter パラメータを渡す場合は、
D 案 (D-案: viewer screen-item、#762 確定) に従い **Screen.items[] に `direction='viewer'` の screen-item を追加**し、
`valueFrom.flowVariable` でフロー変数を binding する方式を採用する。
`@param.*` への直接 binding は廃止予定。詳細は [screen-items.md#F-viewer-項目](screen-items.md) を参照。

## kind 別の典型レイアウト

| kind | レイアウト想定 | 必須/推奨フィールド |
|---|---|---|
| **list** | テーブル (行 = レコード、列 = ViewColumn) | columns / sortDefaults / pageSize |
| **detail** | 1 レコードのフォーム表示 | columns (フィールド表示順)、sortDefaults / pageSize は無効 |
| **kanban** | カラム = groupBy 値、カード = レコード | groupBy 必須、columns はカード本文に表示 |
| **calendar** | カレンダー上に時系列でレコードを配置 | 日時列を columns に含める (validator 上の必須化はないが慣習) |
| `namespace:kindName` | 業界拡張 (例: `retail:storefront`) | extensions の `viewDefinitionKinds` で別途定義 |

組み込み 4 種以外の kind を使う場合、`extensions/<namespace>/view-definition-kinds.json` で `kind / requiredFields / layoutHint` を宣言する。

## Screen との連携

Screen は `items[]` の `direction: "viewer"` screen-item から `viewDefinitionId` で 1:N 参照する。

```jsonc
// screens/<id>.json
{
  "id": "<screen-uuid>",
  "kind": "list",
  "items": [
    {
      "id": "myList",
      "label": "一覧",
      "type": { "kind": "array", "itemType": "json" },
      "direction": "viewer",
      "viewDefinitionId": "<view-definition-uuid>"
    }
  ]
}
```

**1:N で複数 viewer を使う典型**: `kind="list"` の画面で、タブ切替や絞込パネル切替で複数 viewer を提示する場合 (例: 「全件 / アクティブのみ / 廃番含む」をそれぞれ別 ViewDefinition に分け、画面が切替制御を持つ) は、`direction: "viewer"` の screen-item を複数定義する。

**画面項目 (items[]) との関係**: items[] の input / output / viewer 項目がすべて同一配列に共存する。同じ画面内で input × N + viewer × M を同居させる構成が一般的 (検索画面 / 一覧画面の組合せ)。

`kind="list"` の Screen で `items[]` 内に `direction: "viewer"` の screen-item が 0 件の場合、`runtimeContractValidator [EMPTY_SCREEN_ITEMS]` が warning を発報する (画面が空白なため、空白意図ならコメントを残すか、設計途中なら maturity=draft で許容)。

## 設計上の決定事項

### (D-1) Screen と ViewDefinition は 1:N (#649 設計判断)

- 1:1 にすると「タブ切替 / 表示モード切替」を Screen 側に詰め込む必要が出る。
- 1:N で別 entity に分離することで viewer ごとの独立した authoring (decisions / glossary) を持てる。

### (D-2) DB View (`view.v3.schema.json`) と axis 分離 (#649)

- DB View は永続化層 SELECT (1 つの SQL VIEW を複数フローから参照)。
- ViewDefinition は画面 viewer (1 つの table またはカスタム query を画面で見せる時の列定義)。
- 同じ "View" 名でも責務が異なるため独立 schema 化。共通点があれば将来 mixin で抽出する余地は残す。

### (D-3) 3 レベル DSL の段階的拡張 (#745)

- Level 1 → Level 2 → Level 3 と段階的に表現力を上げる。
- Level 1 の暗黙 join は `JOIN_NOT_DECLARED` warning として検出し、Level 2 アップグレードを促す (旧 `COLUMN_REF_NOT_IN_SOURCE_TABLE` を再定義)。

### (D-4) `tableColumnRef` は Level 3 で省略可 (#745)

- Level 3 では SQL 結果に対応する table 列が必ずしも 1:1 で対応しないため (例: ROW_NUMBER の rn 列は table 由来ではない)。
- 省略時は `name + type` のみで列を宣言する。型整合は設計者が保証 (validator は走らせない)。

### (D-5) SQL SELECT 句の列は `AS "<camelCase>"` alias 必須 (#775)

ProcessFlow の `dbAccess.sql` で SELECT した列が ViewDefinition の `columns[].name` (camelCase Identifier) へ直接バインドされる場合 (viewer screen-item の `valueFrom.flowVariable` 経由) は、**SQL 内で明示 alias により名前を一致させる**。

> **規約**: SQL SELECT 句で DB 物理名 (snake_case) と `columns[].name` (camelCase) が異なる列は `AS "<camelCase>"` で alias 必須。
>
> 例: `SELECT p.unit_price AS "unitPrice", p.product_code AS "productCode" FROM products p`

**理由**: snake_case 物理名 (`unit_price`) と camelCase Identifier (`unitPrice`) を runtime で暗黙変換すると validator で検出不能なバインドミスが発生する。明示 alias で SQL ↔ ViewDefinition binding を構文上確定させ、sqlColumnValidator の整合チェック対象に含める。

**適用範囲**:
- `dbAccess` の SQL 出力が ViewDefinition `columns[].name` と直接バインドされる SELECT 句のみ
- 中間 compute step を挟む場合は compute 式の key で変換してもよいが、SQL alias で統一する方が明示的
- 既存フローへの適用例: `examples/retail/process-flows/267e94bf-...json` / `examples/realestate/process-flows/d4b5c6e7-...json`

## validator 観点 (11 件、#745 反映)

`viewDefinitionValidator.ts` が次の観点を検出する。Phase 4 PR #656 で 9 件登録され、PR #745 で Level 2 / Level 3 対応に伴い 2 件追加 (合計 11 観点)。`validate:samples` の登録 9 番目 (`npm run validate:samples -- <projectDir>`)。

| issue code | severity | 検出内容 |
|---|---|---|
| `UNKNOWN_SOURCE_TABLE` | error | `sourceTableId` / `query.from.tableId` / `query.joins[].tableId` が同プロジェクト内に存在しない |
| `UNKNOWN_TABLE_COLUMN_REF` | error | `ViewColumn.tableColumnRef` が存在しないテーブル列を参照 |
| `UNKNOWN_TABLE_REF_IN_VIEW` | error | Level 2: `ViewColumn.tableColumnRef.tableId` が `query.from` / `query.joins[]` のいずれにも含まれない (#745) |
| `JOIN_NOT_DECLARED` | warning | Level 1: `tableColumnRef.tableId` が `sourceTableId` と異なる (暗黙 join、Level 2 アップグレード推奨。#745、旧 `COLUMN_REF_NOT_IN_SOURCE_TABLE` を再定義) |
| `DUPLICATE_QUERY_ALIAS` | error | Level 2: `query.from.alias` と `query.joins[].alias` の組合せに重複 (#745) |
| `DUPLICATE_VIEW_COLUMN_NAME` | error | ViewDefinition 内で `ViewColumn.name` が重複 |
| `FIELD_TYPE_INCOMPATIBLE` | warning | `ViewColumn.type` が参照先テーブル列の DataType と互換なし |
| `UNKNOWN_SORT_COLUMN` | error | `sortDefaults` が `ViewDefinition.columns` に存在しない列を参照 |
| `UNKNOWN_FILTER_COLUMN` | error | `filterDefaults` が `ViewDefinition.columns` に存在しない列を参照 |
| `FILTER_OPERATOR_TYPE_MISMATCH` | warning | `filterDefaults.operator` が列 type と不整合 (text に between、数値に contains 等) |
| `UNKNOWN_GROUP_BY_COLUMN` | error | `groupBy` が `ViewDefinition.columns` に存在しない列を参照 |

テスト 24 ケース ([`viewDefinitionValidator.test.ts`](../../frontend/src/schemas/viewDefinitionValidator.test.ts))。

## maturity / draft-state policy との関係

ViewDefinition は通常リソース同様に maturity を持ち、`schema 違反でも保存可能、UI で警告可視化、committed への昇格時に解消する` という [`draft-state-policy.md`](draft-state-policy.md) の 5 原則に従う。

- `draft`: 列定義不完全 / 想定列数未達 でも保存可
- `review`: validator error 0 件、warning は許容
- `committed`: validator error 0 件 + warning も解消が望ましい (cf. retail 6 件の committed view-definition)

## 関連仕様

- [`screen-items.md`](screen-items.md) — 画面項目定義 (`Screen.items[]` の input / output / viewer 項目)
- [`schema-governance.md`](schema-governance.md) — `schemas/v3/view-definition.v3.schema.json` 等のグローバル schema 変更ガバナンス
- [`schema-design-principles.md`](schema-design-principles.md) — schema をどう書くかの規範 (本 schema は Pattern B 複合参照を採用)
- [`draft-state-policy.md`](draft-state-policy.md) — maturity による設計途中許容
- [`sample-project-structure.md`](sample-project-structure.md) — `view-definitions/<id>.json` のディレクトリ配置

## Screen との連携 — viewer screen-item パターン (#762)

`Screen.items[]` に `direction: "viewer"` の screen-item を追加することで、
ViewDefinition の列定義を使い ProcessFlow 出力を画面に表示する。

```jsonc
// screens/<id>.json
{
  "id": "<screen-uuid>",
  "items": [
    { "id": "keyword", "label": "キーワード", "type": "string", "direction": "input" },
    {
      "id": "searchButton",
      "label": "検索",
      "type": { "kind": "extension", "extensionRef": "realestate:button" },
      "direction": "output",
      "events": [
        {
          "id": "click",
          "handlerFlowId": "<検索フロー UUID>",
          "argumentMapping": { "keyword": "@screen.keyword" }
        }
      ]
    },
    {
      "id": "resultRows",
      "label": "検索結果",
      "type": { "kind": "array", "itemType": "json" },
      "direction": "viewer",
      "viewDefinitionId": "<viewer VD UUID>",     // 列定義を提供
      "valueFrom": {
        "kind": "flowVariable",
        "processFlowId": "<検索フロー UUID>",
        "variableName": "rows"                    // フロー outputs[] で宣言した変数
      }
    }
  ]
}
```

**設計方針**: ViewDefinition は「列定義・ソート・kind」専任、データ取得は ProcessFlow が担い、
viewer screen-item が両者を仲介する。ViewDefinition 側に filter/parameter binding ロジックは持たせない。

詳細は [`screen-items.md#F-viewer-項目`](screen-items.md) を参照。

## 範囲外 (別 ISSUE で進行中)

- **#763**: design.json の preview-only ダミーデータ vs 実バインディングのマーキング規約 — viewer screen-item で一覧バインディングしている場合に design.json 内のサンプル行をどう扱うか、関連話題

## 今後の拡張候補

- 業界拡張 `kind` の登録機構 (`extensions/<namespace>/view-definition-kinds.json`、現状 schema は受け入れるが extensions 側の宣言フォーマットは未確定)
- detail / kanban / calendar 各 kind 固有の必須フィールド早見表 (現状は list 中心の検証、他 kind は実例不足)
