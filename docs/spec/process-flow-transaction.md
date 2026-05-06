# Process Flow — Transaction Scope (`TransactionScopeStep`)

ISSUE: #415 / 親 #396 (Power Platform Changeset / EF Core TransactionScope 由来)
**改訂日: 2026-04-28 (#539 で v3 反映)**

複数 DB 操作を atomic な TX 単位でラップする meta-step。「注文登録 + 在庫減算」のように、一連の DB 書き込みを「全部成功するか、何も無かったかにする」のを宣言的に表現する。一次成果物は `schemas/v3/process-flow.v3.schema.json` の `TransactionScopeStep` ($defs)。

## §1 動機

業務システムでは「複数の DB 操作を 1 TX でまとめる」が頻出。例:

- 注文登録: `orders` INSERT + `order_items` INSERT + `inventory` UPDATE
- 残高振替: `accounts` UPDATE × 2 (引落+入金)
- ユーザー削除: 関連テーブル群の cascade UPDATE

既存 `StepBaseProps.txBoundary` は `{role: "begin"|"member"|"end", txId}` の平坦モデルで、同一 `txId` を持つ step 群が単一 TX を構成する。これは下位互換のため残すが、**範囲が構造ではなく ID 一致で表現される**ため、以下の問題がある:

- step を移動・複製した時に `txId` の整合性が崩れやすい
- `begin` から `end` までの範囲が一目で読みづらい
- ネストが表現できない

`TransactionScopeStep` は **TX の範囲を構造的にネストして表現**する。範囲は `steps[]` 配列で明示。AI / 実装側はこれを 1 まとまりで TX として扱う。

## §2 スキーマ

```jsonc
{
  "id": "tx-001",
  "kind": "transactionScope",                          // v3: type → kind
  "description": "注文登録 + 在庫減算",
  "isolationLevel": "READ_COMMITTED",                  // optional・既定 "READ_COMMITTED"
  "propagation": "REQUIRED",                           // optional・既定 "REQUIRED"
  "timeoutMs": 5000,                                   // optional
  "rollbackOn": ["VALIDATION", "STOCK_SHORTAGE"],      // optional・context.catalogs.errors のキー参照
  "steps": [ /* TX 内で実行する step 列 */ ],
  "onCommit": [ /* commit 後の追加処理、optional */ ],
  "onRollback": [ /* rollback 後の補償処理、optional */ ]
}
```

`steps[]` 内には任意の Step を再帰的に置ける (LoopStep / BranchStep / 別の TransactionScopeStep もネスト可)。

### §2.1 `isolationLevel`

| 値 | 意味 |
|---|---|
| `READ_COMMITTED` (既定) | commit 済データのみ可視。phantom read / non-repeatable read を許容 |
| `REPEATABLE_READ` | 同一 TX 内で同じ行を再読すると常に同じ結果 (phantom は許容) |
| `SERIALIZABLE` | 直列実行と等価。phantom read も防止 (実装で blocking / abort のいずれか) |

選定指針: 業務系 DB 書込は通常 `READ_COMMITTED` で十分。在庫引当・残高振替など **「同じ行を読んで条件付き書込」** をする TX は `REPEATABLE_READ` 以上 (または `affectedRowsCheck` による楽観ロックで補完) を推奨。

### §2.2 `propagation`

Spring `@Transactional` / EF Core `TransactionScopeOption` 由来。既存 TX が呼び出し側にある場合の挙動を制御:

| 値 | 既存 TX が無い場合 | 既存 TX がある場合 |
|---|---|---|
| `REQUIRED` (既定) | 新規 TX 開始 | 既存 TX に参加 (内側の rollback は外側にも波及) |
| `REQUIRES_NEW` | 新規 TX 開始 | 既存 TX を一時停止し、新規 TX を独立に開始/commit (内側の結果は外側に影響しない) |
| `NESTED` | 新規 TX 開始 | 既存 TX 内で savepoint を作る (内側だけ部分 rollback 可能) |

選定指針: 大半は `REQUIRED`。**監査ログ・通知記録など「呼び元 TX とは独立に必ず残したい」処理**は `REQUIRES_NEW`。**try-catch で部分 rollback したい**場合は `NESTED`。

### §2.3 `timeoutMs`

TX 全体のタイムアウト (ms)。経過後はランタイムが TX を rollback する。未指定はランタイム既定 (DB / フレームワークが決める)。

### §2.4 `rollbackOn`

rollback を引き起こす `errorCode` の配列。`ProcessFlow.context.catalogs.errors` のキー参照 (v3 で catalog 階層化、v1/v2 の `errorCatalog` から移動)。

- 列挙されたコードが TX 内で throw された場合のみ rollback
- 未指定時は **「すべての例外で rollback」** がランタイム既定 (Spring の `RuntimeException` 既定挙動と同じ)
- `affectedRowsCheck.errorCode` (例: `STOCK_SHORTAGE`) を含めると、影響行数違反でも rollback できる

例:

```jsonc
"rollbackOn": ["STOCK_SHORTAGE"]
```

→ `affectedRowsCheck.onViolation: "throw"` で `errorCode: "STOCK_SHORTAGE"` が投げられた時に TX 全体が rollback。それ以外の例外は実装側の例外伝播ルールに委ねる。

### §2.5 `steps[]`

TX 内で実行する step 列。順序通りに実行され、TX が始まってから commit / rollback の判定までを含む。

- 任意の Step type を置ける (DbAccessStep / LoopStep / BranchStep / TransactionScopeStep ネスト可)
- `ExternalSystemStep` を入れた場合の意味論は **実装依存** (DB TX に外部 HTTP は本質的に巻き込めない)。Saga 的に補償をかけるか、TX 外に出すのが基本

### §2.6 `onCommit[]`

TX が commit 成功した**後**に実行する step 列。任意。例:

- 通知メール送信 (`ExternalSystemStep` with `fireAndForget: true`)
- キャッシュ無効化
- 監査ログ (`AuditStep`)

`onCommit` の step は **TX の外** で実行されるため、ここでの失敗は元の TX を巻き戻さない (best-effort)。

### §2.7 `onRollback[]`

TX が rollback された**後**に実行する step 列。任意・補償処理 (Saga compensation) として使う:

- Stripe `authorize` の `cancel` (DB rollback で予約取消したので決済も取消)
- 運用通知 (Slack 等)
- ログ記録 (`LogStep`)

`onRollback` の step は **TX の外** で実行されるため、ここでの失敗は元の rollback を撤回しない。

#### `@error` ambient

`onRollback[]` 内の step では、rollback の原因を表す暗黙変数 `@error` を参照できる。`@error` は `onRollback[]` 専用 ambient であり、`transactionScope.steps[]`、`onCommit[]`、transactionScope 外の root steps から参照した場合は `UNKNOWN_IDENTIFIER` として扱う。

`@error` の型と具体的なフィールドは処理フローエンジン側で定義する。本バリデータは識別子 `error` がそのスコープで参照可能かだけを検証し、型検証は行わない。

## §3 既存 `StepBaseProps.txBoundary` との関係

両者は **共存** する。役割は明確に分かれる:

| | `StepBaseProps.txBoundary` | `TransactionScopeStep` |
|---|---|---|
| モデル | 平坦 (`{role, txId}` で同一 `txId` の step 群が 1 TX) | 構造的 (`steps[]` 配列で範囲を表現) |
| 表現 | 単独ステップが TX 境界の一部であることを宣言 | 複数ステップを 1 TX としてくくる meta-step |
| ネスト | 不可 (txId 重複を禁止しない実装依存) | 可 (ネストは `propagation` で制御) |
| `onCommit`/`onRollback` | 持たない | 持つ |
| 移動・複製耐性 | 弱 (txId の同期が手動) | 強 (構造ごと移動) |
| v3 sample 実機検証 | 未使用 (Round 5 fixture でのみ検証) | `examples/retail/process-flows/efa7ac6e-...json` (在庫操作 TX) / `examples/retail/process-flows/f81dd9e0-...json` (注文確定 TX) で実機使用。旧サンプルは削除済 — `git log` でのみ参照可 |

### §3.1 移行ガイダンス

新規データは **`TransactionScopeStep` を優先** する。既存の平坦 `txBoundary` は当面残し、リファクタリング時に置き換える運用とする。

平坦 → 構造化の機械変換は 1:1 でないことに注意:

- 平坦の `begin/member/end` は range が連続でない (途中に TX 外 step が挟まる) ことを許容
- `TransactionScopeStep.steps[]` は連続範囲のみ。挟まる TX 外処理は前後に出す必要あり

### §3.2 同一 step 内での併用は禁止

`TransactionScopeStep` 自身に `txBoundary` を付けたデータ (例: `transactionScope` の親 step が begin で、子の step が member) は **意味曖昧** のため使ってはいけない。`TransactionScopeStep` を使うなら、その内部 step には `txBoundary` を付けない (実装側は付いていても無視する)。

## §4 ランタイム規約

[`process-flow-runtime-conventions.md`](process-flow-runtime-conventions.md) を補足する形で、TX スコープに関するランタイム挙動:

1. **commit タイミング**: `steps[]` の最後の step が成功で抜けた時点で commit。途中の throw は (rollbackOn にマッチすれば) rollback
2. **`onCommit` / `onRollback` の独立性**: これらは TX の外で実行され、自身の失敗は元の TX 結果を覆さない
3. **ネスト時の `REQUIRES_NEW`**: 親 TX が動いている時に `REQUIRES_NEW` の TransactionScopeStep に入ると、親 TX が一時停止して内側 TX が独立 commit/rollback する。内側 commit 後に親 TX が rollback しても、内側の commit は取り消されない
4. **ネスト時の `NESTED`**: savepoint を使う。内側 rollback は親 TX の savepoint 復元、親 rollback は savepoint も含めて全 rollback
5. **`outputBinding` による TX 結果の expose**: `transactionScope` step に `outputBinding: { "name": "txResult" }` を指定すると、TX 外の後続 step が `@txResult.committed` (boolean) と `@txResult.error` (失敗時のみ) を参照できる。これにより TX 失敗エラーコードを後続 branch の `condition.kind: "expression"` で参照できる (§8.5 参照)
6. **`tryCatch` Branch との組合せ**: `outputBinding` なし / `tryCatch` branch による捕捉は以前から可能 (下位互換)。新規フローでは §8.5 の `outputBinding` + `expression` パターンを推奨する

## §5 サンプル (v3)

実機検証済の TransactionScopeStep 典型パターン:

- **SERIALIZABLE TX + affectedRowsCheck + onRollback パターン**: 複数 `dbAccess` ステップを `TransactionScopeStep.steps[]` でくくり、`isolationLevel: "SERIALIZABLE"` を指定。各 `dbAccess` に `affectedRowsCheck` で行数検証 (例: 残高不足で 0 行 UPDATE → rollback)。`onRollback` ブランチで監査ログ記録 + エラーレスポンス分岐 (422/500) を配置する。
- 現行 canonical サンプルは `examples/retail/process-flows/efa7ac6e-...json` (在庫操作 TX) / `examples/retail/process-flows/f81dd9e0-...json` (注文確定 TX) / `examples/realestate/process-flows/d4b5c6e7-...json` (物件登録 TX) を参照。
- 旧サンプル (finance / manufacturing 業界) は削除済み — `git log` で参照可。

## §6 UI

`frontend/src/components/process-flow/TransactionScopeStepPanel.tsx` で編集 (TS 同期完了後の v3 化を予定):

- `isolationLevel` / `propagation` / `timeoutMs`: dropdown / number input
- `rollbackOn`: `context.catalogs.errors` のキーを multi-select (チェックボックス)
- `steps[]`: 子 StepCard の InlineStepList で再帰編集
- `onCommit[]` / `onRollback[]`: 折りたたみで InlineStepList

## §7 関連参照

- 親 ISSUE: #396 (処理フロー仕様拡張計画メタ)
- 関連: `affectedRowsCheck` (`schemas/v3/process-flow.v3.schema.json` `DbAccessStep`)
- 関連: `BranchCondition.kind = "tryCatch"` (TX rollback エラー捕捉、v3 で discriminated union 化 + #525 F-4 で discriminator keyword 追加)
- 関連: `StepBaseProps.compensatesFor` (Saga 補償の手動マーキング)
- 業界フレームワーク: Power Platform Dataverse "Changeset", EF Core `TransactionScope`, Spring `@Transactional`

## §8 実装ガイドライン (ドッグフード由来)

シナリオ #2-#6 (PR #468-#472) の実装レビューで繰り返し検出された誤りパターンを以下にまとめる。新規フロー実装前に必読。

### §8.1 TransactionScope 内外の変数アクセスパス

`TransactionScopeStep` の inner step で `outputBinding` した変数を、TX 外の後続 step が参照する際のセマンティクス。

- **TX 全体に `outputBinding: "txName"` を付けた場合**: 推奨は **inner 変数を直接参照** (`@innerVar`) する形。`@txName.innerVar` のネスト参照は spec で保証しない (シナリオ #3 で問題化)
- **後続参照は TX commit が前提**: TX rollback 後は inner outputBinding 変数は未定義になりうる。後続 step に `runIf` ガード必須

```json
{ "id": "step-tx", "kind": "transactionScope", "outputBinding": { "name": "txResult" }, "steps": [
  { "id": "step-tx-insert", "kind": "dbAccess", "operation": "INSERT", "outputBinding": { "name": "newRow" } }
]},
{ "id": "step-after", "kind": "eventPublish", "runIf": "@txResult.committed == true", "payload": "{ id: @newRow.id }" }
```

上の例では、TX commit 後の後続 step は `@newRow.id` (inner 変数直接参照) を使う。`@txResult.newRow.id` のようなネスト形式は避けること。

### §8.2 外部呼び出しと TX の位置関係 (anti-pattern と例外)

- **原則**: `externalSystem` step は `TransactionScopeStep` の inner に入れない (DB 接続長時間占有 / 外部障害で TX タイムアウト)
- **例外ケース**: 補償処理が困難な場合 (例: 取引所への約定送信) でも、外部呼び出しは TX 外で行い `outcomes.failure: "compensate"` で逆操作を補償処理として記述する
- **検出パターン**: TX inner step で `@外部呼び出しResult` を前方参照する誤りは `/review-flow` 観点 1 で検出 (シナリオ #1 で実例あり)

推奨パターン:

```json
{ "id": "step-tx", "kind": "transactionScope", "steps": [
  { "id": "step-db-insert", "kind": "dbAccess", "operation": "INSERT", "outputBinding": { "name": "newRow" } }
]},
{ "id": "step-external", "kind": "externalSystem", "runIf": "@txResult.committed == true",
  "outcomes": { "failure": { "action": "compensate" } } }
```

### §8.3 TX rollback 時の制御フロー

**TX rollback 発生後の後続 step** (TX の外側) は**明示的 `runIf` ガードが必要**。エンジン仕様で「自動 skip」は保証されない。

推奨パターン:

- TX に `outputBinding: "txResult"` を付与する
- TX commit 経路の後続 step: `runIf: "@txResult.committed == true"`
- TX rollback 経路のエラー返却 step: `runIf: "@txResult.committed == false"`

```json
{ "id": "step-tx", "kind": "transactionScope", "outputBinding": { "name": "txResult" }, "steps": [ ... ] },
{ "id": "step-success", "kind": "return", "runIf": "@txResult.committed == true",
  "responseId": "201-success" },
{ "id": "step-rollback-error", "kind": "return", "runIf": "@txResult.committed == false",
  "responseId": "409-conflict" }
```

参考: シナリオ #6 (#473 で修正) では `runIf: "@creditTxResult.committed == false"` で 409 INVALID_STATE_TRANSITION を返す step を追加して解決。

### §8.4 rollbackOn の発火可能性チェック

**rollbackOn には TX inner step から実際に発生しうるエラーコードのみ列挙する。**

- TX 外 step が返すエラーコード (例: `EXCHANGE_REJECTED` が `externalSystem` step 由来) を `rollbackOn` に書くと**死コード**になる
- inner step の `affectedRowsCheck.errorCode` / `ValidationStep` が throw するコードのみが rollback トリガーになりえる
- **検出パターン**: `/review-flow` 観点 8 で「rollbackOn の発火可能性」を体系チェック (シナリオ #1/#2/#3/#6 で実例)

```jsonc
// NG: externalSystem step の結果コードを rollbackOn に列挙 (TX 内に externalSystem がない場合)
"rollbackOn": ["EXCHANGE_REJECTED", "STOCK_SHORTAGE"]

// OK: TX inner の dbAccess が throw するコードのみ列挙
"rollbackOn": ["STOCK_SHORTAGE"]
```

### §8.5 `outputBinding` による TX 結果の expose と expression branch パターン (#782)

`transactionScope` step の `outputBinding` は `StepBaseProps` を通じて他の step と同様に使用できる。TX の場合は特別な semantics が追加される:

| 状態 | `@<name>.committed` | `@<name>.error` |
|---|---|---|
| TX commit 成功 | `true` | `undefined` (参照時は null 扱い) |
| TX rollback (rollbackOn のエラー) | `false` | `{ code: "<エラーコード>", message: "<例外メッセージ>" }` |
| TX rollback (rollbackOn 外の汎用エラー) | `false` | `{ code: "UNHANDLED", message: "<例外メッセージ>" }` |

この semantics により、TX 外の `branch` step の `condition.kind: "expression"` で具体的なエラーコードを参照できる:

```json
{
  "id": "step-tx",
  "kind": "transactionScope",
  "outputBinding": { "name": "txResult" },
  "rollbackOn": ["STOCK_SHORTAGE", "ORDER_NUMBER_CONFLICT"],
  "steps": [ ... ]
},
{
  "id": "step-error-branch",
  "kind": "branch",
  "description": "TX 失敗時のエラー分岐",
  "branches": [
    {
      "id": "br-stock-shortage",
      "code": "A",
      "label": "在庫不足エラー",
      "condition": {
        "kind": "expression",
        "expression": "@txResult.error.code === 'STOCK_SHORTAGE'"
      },
      "steps": [
        { "id": "step-return-422", "kind": "return", "responseId": "422-stock-shortage" }
      ]
    },
    {
      "id": "br-conflict",
      "code": "B",
      "label": "番号競合エラー",
      "condition": {
        "kind": "expression",
        "expression": "@txResult.error.code === 'ORDER_NUMBER_CONFLICT'"
      },
      "steps": [
        { "id": "step-return-422b", "kind": "return", "responseId": "422-conflict" }
      ]
    },
    {
      "id": "br-unhandled",
      "code": "C",
      "label": "予期しない TX エラー (catch-all)",
      "condition": {
        "kind": "expression",
        "expression": "@txResult.error.code === 'UNHANDLED'"
      },
      "steps": [
        { "id": "step-return-500", "kind": "return", "responseId": "500-internal" }
      ]
    }
  ],
  "elseBranch": {
    "id": "br-tx-success",
    "code": "D",
    "label": "TX 成功 — 後続処理へ",
    "steps": []
  }
},
{
  "id": "step-after-tx",
  "kind": "return",
  "runIf": "@txResult.committed == true",
  "responseId": "200-ok"
}
```

**`tryCatch` branch との役割分離**:

| 方式 | 用途 | 推奨度 |
|---|---|---|
| `condition.kind: "tryCatch"` | step 単位の throw catch (TX 外でも使用可、TX 内の catch は `NESTED` + `tryCatch` の組合せ) | 下位互換として継続利用可 |
| `outputBinding` + `expression: "@<name>.error.code === ..."` | TX 全体の失敗後に TX 外 branch でエラーコード別分岐 | **新規フローで推奨** |

**重要**: 両方を同じ TX に対して使用しないこと。`outputBinding` + `expression` パターンを採用したら、同一 TX の `tryCatch` branch は削除する。
