# ProcessFlow SLA / Timeout 仕様

**改訂日: 2026-04-28 (v3 反映)**

## 目的

処理フロー定義に、性能・待ち時間・タイムアウト時の扱いを宣言するための `sla` を追加する。AI 実装者はこの情報を使い、タイムアウト設定、監視、ログ、補償処理、エラー応答を生成する。

## 対象レベル

`sla` は次の 3 レベルで指定できる。

| レベル | 対象 | 用途 |
|---|---|---|
| ProcessFlow | フロー全体 | 画面操作やバッチ全体の上限時間、全体監視 |
| ActionDefinition | アクション単位 | submit / click / timer など 1 アクション内の上限時間 |
| StepBase | 任意ステップ | 外部 API、DB、計算、ログなど個別処理の上限時間 |

より内側のレベルが指定されている場合は、実装時に内側の宣言を優先する。例: `StepBase.sla.timeoutMs` は `ActionDefinition.sla.timeoutMs` より具体的な制約として扱う。

## Sla

```ts
interface Sla {
  timeoutMs?: number;
  onTimeout?: "throw" | "continue" | "compensate" | "log";
  errorCode?: string;
  warningThresholdMs?: number;
  p95LatencyMs?: number;
}
```

### timeoutMs

タイムアウトまでのミリ秒。ProcessFlow / ActionDefinition / StepBase のいずれでも同じ意味で、対象スコープの最大実行時間を示す。

各レベルでの解釈:

| レベル | 意味 |
|---|---|
| ProcessFlow | フロー全体 (全アクション + 全ステップ合計) の最大実行時間 |
| ActionDefinition | アクション 1 回 (HTTP リクエスト 1 回など) の最大実行時間 |
| StepBase | 個別ステップ (DB 1 クエリ、外部 API 1 呼出 など) の最大実行時間 |

### onTimeout

タイムアウト時の挙動。

| 値 | 意味 |
|---|---|
| `throw` | エラーとして扱い、通常のエラー処理へ進める |
| `continue` | タイムアウトを記録し、次の処理へ継続する |
| `compensate` | 補償処理や Saga の戻し処理へ進める |
| `log` | タイムアウトをログ・監視に残すが、業務フローは止めない |

### errorCode

`context.catalogs.errors` のキーと連携するエラーコード。`onTimeout: "throw"` または `compensate` の場合、HTTP レスポンスや業務エラーへの変換に利用する。

**スキーマ制約 (#412)**: `onTimeout` が `throw` または `compensate` の場合、`errorCode` は必須 (JSON Schema の `if/then` で強制)。`continue` / `log` では `errorCode` は不要。

### warningThresholdMs

タイムアウトより手前で警告を出す閾値。例: `timeoutMs: 2000`, `warningThresholdMs: 1500` の場合、1.5 秒を超えた処理を遅延警告として監視できる。

### p95LatencyMs

P95 レイテンシ目標 (ms)。SRE 監視・SLO 評価で「95% のリクエストが満たすべき応答時間」として使用する。`timeoutMs` (絶対上限) と異なり、超過しても処理は継続するが、観測値が継続的に超えた場合は監視 alert 対象。

例: `timeoutMs: 5000`, `p95LatencyMs: 500` — 上限 5 秒 / SLO 目標 P95 < 500ms。

## v3 での利用例

ProcessFlow レベルの sla 指定 (v3 形式):

```json
{
  "meta": {
    "id": "order-processing-flow",
    "uuid": "11111111-1111-4111-8111-111111111111",
    "name": "注文処理",
    "sla": {
      "timeoutMs": 30000,
      "warningThresholdMs": 20000,
      "p95LatencyMs": 5000
    }
  },
  "context": {
    "catalogs": {
      "errors": {
        "TIMEOUT": {
          "httpStatus": 504,
          "defaultMessage": "処理がタイムアウトしました",
          "responseId": "504-timeout"
        }
      }
    }
  }
}
```

ステップレベルの sla 指定 (v3 形式):

```json
{
  "kind": "externalSystem",
  "id": "step-payment",
  "description": "決済 API を呼び出す",
  "systemRef": "paymentGateway",
  "sla": {
    "timeoutMs": 5000,
    "onTimeout": "throw",
    "errorCode": "TIMEOUT"
  }
}
```

## 設計判断

### timeoutMs の 3 レベル統合 (採用)

ISSUE #412 の当初案では、Flow / Action では `totalTimeoutMs`、Step では `timeoutMs` という別名を採用していたが、3 レベルすべてで `timeoutMs` に統一した。

理由:

- **シンプルな API**: フィールド名がレベルで変わらないため、AI 実装者が記憶しやすい
- **JSON 型再利用**: 同一の `Sla` 型を 3 レベルで使い回せる (型定義 / バリデーション / UI / テストが一段集約)
- **意味は文脈から自明**: 上述の通り、レベルに応じて「対象スコープの最大実行時間」と読み替えれば意味が一意に決まる
- 「フロー全体の上限」「アクション 1 回の上限」「ステップ 1 つの上限」はネスト関係 (内側 ⊆ 外側) なので、別名にする実用的メリットが薄い

トレードオフ: `totalTimeoutMs` という命名が持つ「全体合計」のニュアンスは失われるが、上の表で意味を明示することで補う。

## 将来追加候補

### errorBudget (SRE error budget)

SRE プラクティスの「許容エラー率」(例: 99.9% SLO なら error budget = 0.1%) を Sla に追加することを検討中。

```jsonc
// 将来案
"sla": {
  "errorBudget": 0.001  // 許容エラー率 0.1%
}
```

別 ISSUE で扱う予定。実装時には `monitoring.errorBudgetBurnRate` のような関連フィールドとセットで設計する。

## 後方互換

既存の `ExternalSystemStep.timeoutMs` は deprecated として残す。新規定義では `StepBase.sla.timeoutMs` を使用する。

外部システムステップで両方が指定された場合、`sla.timeoutMs` を優先する。旧データの読み込み・検証互換を維持するため、スキーマ上は `ExternalSystemStep.timeoutMs` も引き続き受け付ける。

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `Sla` 型定義
- `docs/spec/process-flow-external-system.md` — ExternalSystemStep 詳細
- `docs/spec/process-flow-runtime-conventions.md` §3 — タイムアウトと TX / Saga の連鎖
