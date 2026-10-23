---
description: "処理フローの工程の種類の一覧 (種類・日本語名・スキーマの定義・必須の項目・固有の項目)。スキーマから自動生成"
status: current
category: process-flow
---

# 処理フローの工程の種類

> **自動生成**: この文書は手で直さない。正本を直して `node scripts/docs/generated.mjs --write` で作り直す (ずれていると `npm run check:docs` が止める)。


工程 (Step) は `kind` で種類を表す。組み込みの 25 種類と、拡張の工程 (`namespace:StepName`)。どの工程も `id` / `kind` / `description` は必須で、実行条件 (`runIf`)・備考 (`notes`)・成熟度 (`maturity`)・見出し (`heading`)・入れ子の工程 (`subSteps`)・失敗時の挙動 (`errorHandling`) などの共通の項目を持てる (スキーマの `StepBaseProps`)。

| kind | 日本語名 | スキーマの定義 | 常に必須の項目 | 条件つきで必須 | 固有の項目 |
|---|---|---|---|---|---|
| `validation` | 入力チェック | `ValidationStep` | `fieldErrorsVar` | — | `conditions`, `rules`, `fieldErrorsVar`, `inlineBranch` |
| `dbAccess` | DBアクセス | `DbAccessStep` | `tableId`, `operation` | — | `tableId`, `operation`, `fields`, `sql`, `naturalQuery`, `bulkValues`, `affectedRowsCheck`, `cache` |
| `externalSystem` | 外部システム | `ExternalSystemStep` | `systemRef` | — | `systemRef`, `httpCall`, `operationRef`, `operationId`, `requestBodyRef`, `responseRef`, `timeoutMs`, `circuitBreaker`, `bulkhead`, `fireAndForget` ほか 6 |
| `commonProcess` | 共通処理 | `CommonProcessStep` | `refId` | — | `refId`, `argumentMapping` |
| `componentCall` | コンポーネント呼出 | `ComponentCallStep` | `componentRef` | — | `componentRef`, `operation`, `argumentMapping` |
| `screenTransition` | 画面遷移 | `ScreenTransitionStep` | `targetScreenId` | — | `targetScreenId` |
| `displayUpdate` | 表示更新 | `DisplayUpdateStep` | `target` | — | `target` |
| `branch` | 分岐 | `BranchStep` | `branches` | — | `branches`, `elseBranch`, `tryScope` |
| `loop` | ループ | `LoopStep` | `loopKind`, `steps` | `loopKind=count` のとき `countExpression`<br>`loopKind=condition` のとき `conditionMode`, `conditionExpression`<br>`loopKind=collection` のとき `collectionSource`, `collectionItemName` | `loopKind`, `countExpression`, `conditionMode`, `conditionExpression`, `collectionSource`, `collectionItemName`, `collectionItemLabel`, `collectionIndexName`, `steps` |
| `loopBreak` | ループ終了 | `LoopBreakStep` | — | — | — |
| `loopContinue` | 次の繰り返し | `LoopContinueStep` | — | — | — |
| `jump` | ジャンプ | `JumpStep` | `jumpTo` | — | `jumpTo` |
| `compute` | 計算/代入 | `ComputeStep` | `expression` | — | `expression` |
| `return` | レスポンス返却 | `ReturnStep` | — | — | `responseId`, `bodyExpression` |
| `log` | ログ | `LogStep` | `level`, `message` | — | `level`, `message`, `category`, `structuredData` |
| `audit` | 監査 | `AuditStep` | `action` | — | `action`, `resource`, `result`, `reason`, `sensitive` |
| `setGlobal` | グローバル設定 | `SetGlobalStep` | `globalName`, `value` | — | `globalName`, `field`, `value`, `lifetime` |
| `workflow` | ワークフロー | `WorkflowStep` | `pattern`, `approvers` | `pattern=approval-escalation` のとき `escalateAfter`, `escalateTo`<br>`pattern=approval-quorum` のとき `quorum` | `pattern`, `approvers`, `quorum`, `onApproved`, `onRejected`, `onTimeout`, `deadlineExpression`, `escalateAfter`, `escalateTo` |
| `transactionScope` | トランザクション | `TransactionScopeStep` | `steps` | — | `isolationLevel`, `propagation`, `timeoutMs`, `steps`, `onCommit`, `onRollback` |
| `eventPublish` | イベント発行 | `EventPublishStep` | `topic` | — | `topic`, `payload` |
| `eventSubscribe` | イベント購読 | `EventSubscribeStep` | `topic` | — | `topic`, `filter` |
| `closing` | 締め処理 | `ClosingStep` | `period` | — | `period`, `customCron`, `cutoffAt`, `idempotencyKey`, `rollbackOnFailure` |
| `cdc` | CDC | `CdcStep` | `tableIds`, `captureMode`, `destination` | — | `tableIds`, `captureMode`, `destination`, `includeColumns`, `excludeColumns` |
| `aiCall` | AI 呼出 | `AiCallStep` | `modelRef`, `messages` | — | `modelRef`, `messages`, `tools`, `toolChoice`, `responseFormat`, `parameters` |
| `aiAgent` | AI エージェント | `AiAgentStep` | `modelRef`, `messages`, `tools` | — | `modelRef`, `messages`, `tools`, `toolChoice`, `maxIterations`, `responseFormat`, `parameters` |
| `namespace:StepName` | 拡張 | `ExtensionStep` | — | — | `config` |

- 形の正本: `harmony://schema/process-flow` (`schemas/v3/process-flow.v3.schema.json`)。`$defs` の一覧と要約は [schema-index.json](schema-index.json)
- 意味 (実行時の約束): [process-flow-runtime-conventions.md](process-flow-runtime-conventions.md)。式の書き方: [process-flow-expression-language.md](process-flow-expression-language.md)
- 人が読む言葉での見え方: [process-flow-story-view.md](process-flow-story-view.md)
