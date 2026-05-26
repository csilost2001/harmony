# ProcessFlow Tier C 仕様

**改訂日: 2026-04-28 (v3 反映)**

関連 issue: #426

本仕様は処理フロー JSON Schema の Tier C 拡張を定義する。一次成果物は `schemas/v3/process-flow.v3.schema.json` であり、TypeScript 型と UI 表示定義は派生物として追従する。

v3 では step の `type` フィールドは `kind` に改称。以下のすべての例は v3 形式。

## C-1 ExternalSystemStep の耐障害性設定

`ExternalSystemStep` は外部システム呼び出し単位で circuit breaker と bulkhead を任意指定できる。

```json
{
  "kind": "externalSystem",
  "id": "step-external-resilient",
  "description": "外部システムを耐障害性設定付きで呼び出す",
  "systemRef": "inventoryService",
  "circuitBreaker": {
    "failureThreshold": 5,
    "timeout": 60000,
    "halfOpenMaxCalls": 2
  },
  "bulkhead": {
    "maxConcurrent": 4,
    "maxWait": 3000
  }
}
```

`circuitBreaker.failureThreshold` と `circuitBreaker.timeout` は必須。`halfOpenMaxCalls` は half-open 時に許可する試行数を表す。

`bulkhead.maxConcurrent` は必須。`maxWait` は同時実行枠が空くまで待つ最大時間を表す。

## C-2 ClosingStep

`ClosingStep` は日次・月次・四半期・年次などの締め処理境界を表す。Round 3 で実機検証済み。

```json
{
  "id": "step-close",
  "kind": "closing",
  "description": "月次在庫締めを確定する",
  "period": "monthly",
  "cutoffAt": "23:59:59",
  "idempotencyKey": "inventory-close-@targetMonth",
  "rollbackOnFailure": true
}
```

`period` は `daily` / `monthly` / `quarterly` / `yearly` / `custom` のいずれか。`custom` を使う場合は `customCron` でスケジュール式を補足できる。

## C-3 CdcStep

`CdcStep` は対象テーブルの変更捕捉と、その出力先を宣言する。Round 3 で実機検証済み。

`destination.kind` は以下 3 種が利用可能 (CdcDestination):

| kind | 説明 |
|---|---|
| `auditLog` | 監査ログへ送信 |
| `eventStream` | イベントストリームへ送信 |
| `table` | 別テーブルへ書き込み |

```json
{
  "id": "step-cdc",
  "kind": "cdc",
  "description": "在庫締め結果の変更履歴を監査ログへ送る",
  "tableIds": ["inventory-monthly-close"],
  "captureMode": "incremental",
  "destination": {
    "kind": "auditLog",
    "auditAction": "inventory.monthlyClose"
  },
  "includeColumns": [
    { "tableId": "inventory-monthly-close", "columnId": "col-item-id" },
    { "tableId": "inventory-monthly-close", "columnId": "col-closing-month" },
    { "tableId": "inventory-monthly-close", "columnId": "col-closing-quantity" }
  ]
}
```

**v3 変更点**:
- `tableIds` の要素は物理テーブル名ではなく **Table の EntityId (kebab-case)** を指定する
- `destination.kind: "auditLog"` は `auditAction` に監査アクション名を指定する

### CdcDestination 詳細

`eventStream` 出力の場合:

```json
{
  "destination": {
    "kind": "eventStream",
    "topic": "inventory.stock_closed"
  }
}
```

`table` 出力の場合:

```json
{
  "destination": {
    "kind": "table",
    "tableId": "inventory-close-history"
  }
}
```

`tableIds`、`captureMode`、`destination` は必須。

## C-4 Health / Readiness

`ProcessFlow` 直下に `health` と `readiness` を任意で定義できる。

```json
{
  "health": {
    "checks": [
      { "name": "inventory-db", "type": "db", "target": "inventory" }
    ]
  },
  "readiness": {
    "checks": [
      { "name": "warehouse-api", "type": "http", "target": "https://warehouse.example.com/health" }
    ],
    "minimumPassCount": 1
  }
}
```

`HealthCheck.type` は `db` / `http` / `custom` のいずれか。`readiness.minimumPassCount` は readiness 判定に必要な成功数を表す。

## C-5 ResourceRequirements

`ProcessFlow` 直下に `resources` を任意で定義できる。

```json
{
  "resources": {
    "cpu": { "request": "500m", "limit": "1" },
    "memory": { "request": "512Mi", "limit": "1Gi" },
    "dbConnections": 8,
    "timeout": 900000
  }
}
```

`resources` は実装時の実行基盤向け目安であり、既存フローに対して後方互換の optional フィールドとして扱う。

## EventTopic 規範

Tier C で使用するイベントトピック名は以下の規範に従う:

- 形式: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`
- 例: `inventory.monthly_close`, `inventory.stock_closed`, `inventory.not_found`
- NG: `inventory.monthlyClose` (camelCase 不可)

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `ClosingStep` / `CdcStep` / `HealthCheck` / `ResourceRequirements`
- `docs/spec/process-flow-workflow.md` — step 種別全体の v3 構造
- `docs/spec/process-flow-runtime-conventions.md` — 実行時規約
