# サンプルが示す工程のパターン

> **自動生成**: この文書は手で直さない。`node scripts/docs/generated.mjs --write` で作り直す (ずれていると `npm run check:docs` が止める)。

新しい処理フローを作るときは、近い工程の例を読む。形の正本は `schemas/v3/process-flow.v3.schema.json`。種類の一覧は `docs/spec/process-flow-step-kinds.md`。

## 工程の種類ごと

| kind | 日本語名 | 例 (サンプルの場所と工程の id) |
|---|---|---|
| `validation` | 入力チェック | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-01)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-00)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-01) |
| `dbAccess` | DBアクセス | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-02)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-01)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-02) |
| `externalSystem` | 外部システム | (サンプルにない) |
| `commonProcess` | 共通処理 | (サンプルにない) |
| `componentCall` | コンポーネント呼出 | `examples/retail/harmony/process-flows/order-confirm.json` (step-01a) |
| `screenTransition` | 画面遷移 | (サンプルにない) |
| `displayUpdate` | 表示更新 | (サンプルにない) |
| `branch` | 分岐 | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-03)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-02)<br>`examples/diary/harmony/process-flows/login.json` (step-03) |
| `loop` | ループ | `examples/diary/harmony/process-flows/post-create.json` (step-03-02)<br>`examples/diary/harmony/process-flows/post-update.json` (step-06-03)<br>`examples/retail/harmony/process-flows/order-confirm.json` (step-06-01) |
| `loopBreak` | ループ終了 | (サンプルにない) |
| `loopContinue` | 次の繰り返し | (サンプルにない) |
| `jump` | ジャンプ | (サンプルにない) |
| `compute` | 計算/代入 | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-04)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-03)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-04) |
| `return` | レスポンス返却 | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-01-ng-01)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-00-ng-01)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-01-ng-01) |
| `log` | ログ | `examples/english-learning/harmony/process-flows/streak-reset.json` (step-02)<br>`examples/english-learning-tailwind/harmony/process-flows/streak-reset.json` (step-02)<br>`examples/retail/harmony/process-flows/order-confirm.json` (step-06-rb-01) |
| `audit` | 監査 | `examples/diary/harmony/process-flows/logout.json` (step-01)<br>`examples/retail/harmony/process-flows/shipment-dispatch.json` (step-04) |
| `setGlobal` | グローバル設定 | (サンプルにない) |
| `workflow` | ワークフロー | (サンプルにない) |
| `transactionScope` | トランザクション | `examples/diary/harmony/process-flows/post-create.json` (step-03)<br>`examples/diary/harmony/process-flows/post-delete.json` (step-04)<br>`examples/diary/harmony/process-flows/post-update.json` (step-06) |
| `eventPublish` | イベント発行 | `examples/english-learning/harmony/process-flows/conversation-turn-progress.json` (step-06)<br>`examples/english-learning/harmony/process-flows/pronunciation-grade.json` (step-07)<br>`examples/english-learning/harmony/process-flows/streak-reset.json` (step-03) |
| `eventSubscribe` | イベント購読 | (サンプルにない) |
| `closing` | 締め処理 | (サンプルにない) |
| `cdc` | CDC | (サンプルにない) |
| `aiCall` | AI 呼出 | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-05)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-04)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-03) |
| `aiAgent` | AI エージェント | (サンプルにない) |
| `namespace:StepName` |  | `examples/english-learning/harmony/process-flows/conversation-turn-progress.json` (step-04a)<br>`examples/english-learning/harmony/process-flows/pronunciation-grade.json` (step-05)<br>`examples/english-learning-tailwind/harmony/process-flows/conversation-turn-progress.json` (step-04a) |

## 書き方のパターン

| パターン | 例 |
|---|---|
| 実行条件つきの工程 (`runIf`) | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-02)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-01)<br>`examples/diary/harmony/process-flows/post-create.json` (step-03-03-01) |
| 入れ子の工程 (`subSteps`) | (サンプルにない) |
| 検証の OK / NG 側の工程 (`inlineBranch`) | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-01)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-00)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-01) |
| 3 つ以上の道を持つ分岐 | `examples/retail/harmony/process-flows/order-confirm.json` (step-07) |
| 道が 1 本だけの分岐 (ガード) | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-03)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-02)<br>`examples/diary/harmony/process-flows/login.json` (step-03) |
| コミット後 / ロールバック時の工程つきのトランザクション | `examples/retail/harmony/process-flows/order-confirm.json` (step-06) |
| 失敗系の結果ごとの副作用 (`errorHandling.outcomes`) | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-05)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-04)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-03) |
| 再試行 (`errorHandling.retryPolicy`) | (サンプルにない) |
| 結果の束縛 (`outputBinding`) | `examples/diary/harmony/process-flows/ai-image-alt-generate.json` (step-02)<br>`examples/diary/harmony/process-flows/ai-summary-generate.json` (step-01)<br>`examples/diary/harmony/process-flows/ai-tag-suggest.json` (step-02) |
