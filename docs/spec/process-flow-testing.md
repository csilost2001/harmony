# 処理フロー テストシナリオ仕様

**改訂日: 2026-04-28 (v3 反映)**

## 目的

`testScenarios` は、処理フロー定義の中に Given-When-Then 形式のテストケースを同居させるための領域である。
業務設計者が期待する振る舞いを、仕様書、実装指示、テスト観点として 1 つの `ProcessFlow` にまとめる。
AI 実装者はこの配列を読み、単体テスト、結合テスト、E2E テストの下書きを自動生成できる。
テストケースを別ファイルに分離しないことで、Action、outcome、DB 操作、外部システム参照とのずれを減らす。
UI 表示は本仕様の対象外であり、まず JSON Schema と型定義で機械可読な形を固定する。

## 配置 (v3)

v3 では `testScenarios` は `ProcessFlow.authoring.testScenarios` に配置する (`ProcessFlow` 直下ではなく `authoring` ラッパ配下)。

```json
{
  "$schema": "../../../schemas/v3/process-flow.v3.schema.json",
  "meta": {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "注文処理"
  },
  "context": { "catalogs": {} },
  "actions": [],
  "authoring": {
    "testScenarios": [],
    "glossary": {},
    "decisions": []
  }
}
```

既存の処理フローは `testScenarios` を持たなくても valid でなければならない。
新規または成熟度の高い処理フローでは、最低限のシナリオを記述することを推奨する。

## TestScenario

各シナリオは 1 つの業務上の期待結果を表す。
`id` はファイル内で一意な安定 ID とする。
`name` は設計者と実装者が読む表示名とする。
`description` は条件や狙いが名前だけで伝わらない場合に記述する。
`given` は前提条件の配列である。
`when` は起動する Action と入力値である。
`then` は期待結果の配列である。
`tags` は `happy`、`error`、`db`、`edge` など任意の分類に使う。

## Given

`given` にはテスト実行前に準備すべき状態を列挙する。
複数の前提は配列順に読めるが、実行基盤は必要に応じて依存順に並べ替えてよい。
前提条件は `kind` で種類を判別する。

### dbState

`dbState` はテスト DB に投入するテーブル行を表す。
`tableId` は対象テーブルの UUID (v3 では物理テーブル名でなく UUID 参照)。
`rows` は投入する行オブジェクトの配列である。
既存データを暗黙に期待せず、テストに必要な最小行を明示する。
論理削除や有効期間など、分岐に影響する列も省略しない。

v3 形式の dbState 例:

```json
{
  "kind": "dbState",
  "tableId": "11111111-1111-4111-8111-111111111111",
  "rows": [
    { "id": 1, "status": "active", "expires_at": "2099-12-31T23:59:59Z" }
  ]
}
```

### sessionContext

`sessionContext` はログインユーザー、権限、リクエスト ID などの実行コンテキストを表す。
`context` にはミドルウェアやフレームワークが通常注入する値を置く。
`context.ambientVariables` と対応する値は、ここに記述すると実装テストが作りやすい。
認可や監査に関わる値は、業務上の前提として明示する。

### externalStub

`externalStub` は外部 API や外部サービスのモック応答を表す。
`externalRef` は `context.catalogs.externalSystems` のキーを参照する (Identifier camelCase)。
`responseMock` には HTTP ステータス、レスポンス body、例外相当の情報などを入れる。
成功系だけでなく、タイムアウトや異常応答を表現する場合にも使う。

### clock

`clock` は実行時刻を固定するための前提である。
`now` は ISO 8601 形式の文字列とする。
締め日、期限日、採番、監査ログ時刻など、現在時刻で結果が変わる処理で使う。
時刻を固定しないと再現性が落ちるシナリオでは必ず指定する。

## When

`when` はテスト対象の起動点を表す。
`actionId` は同じ `ProcessFlow` 内の `actions[].id` を参照する。
`input` は画面入力値、HTTP request body、またはバッチ起動パラメータに相当する。
入力値には正常値だけでなく、未入力、境界値、不正値もそのまま記述する。
AI 実装者は `actionId` からルート、ハンドラ、ユースケースの呼び出し先を特定する。

## Then

`then` には検証すべき期待結果を列挙する。
1 つのシナリオに複数の assertion を置いてよい。
主要 outcome と、副作用の DB 行や外部呼び出しを同時に確認する使い方を想定する。
assertion は `kind` で種類を判別する。

### outcome

`outcome` は Action の結果が期待した outcome または response に一致することを検証する。
`expected` には `responses[].id`、分岐 outcome、または実装側が解釈できる結果 ID を記述する。
正常終了、バリデーションエラー、業務エラーの最初の確認点として使う。

### dbRow

`dbRow` は特定テーブルに期待する行が存在することを検証する。
`tableId` は対象テーブルの UUID (v3 では物理テーブル名でなく UUID 参照)。
`match` は一致条件または期待値の部分集合である。
`count` を指定した場合は一致件数も検証する。
INSERT、UPDATE、論理削除、履歴登録などの副作用確認に使う。

### output

`output` はレスポンス body や returnMapping の一部を検証する。
`path` は JSON path など、実装側が解釈できる出力パスである。
`equals` は完全一致の期待値である。
`matches` は文字列や採番値を正規表現で検証する場合に使う。

### externalCall

`externalCall` は外部システムが期待どおり呼び出されたことを検証する。
`externalRef` は `context.catalogs.externalSystems` のキーを参照する (Identifier camelCase)。
`method` は HTTP メソッドなどの呼び出し種別を表す。
`bodyMatch` は送信 body の部分一致条件である。
fire-and-forget の通知や、外部 API 連携の契約確認に使う。

### auditLog

`auditLog` は監査ログが記録されたことを検証する。
`action` は監査上の操作名である。
`result` は `success` または `failure` を指定できる。
この assertion は #397 で追加された `AuditStep` と対応する。
監査要件がある処理では、成功時だけでなく失敗時の記録も検討する。

### errorMessage

`errorMessage` はバリデーションや業務エラーのメッセージキーを検証する。
`msgKey` は `@conv.msg.*` などの規約カタログ参照を想定する。
文言そのものではなくキーを検証することで、多言語化や文言調整の影響を減らす。
入力エラーのテストでは outcome と組み合わせて使う。

## 最低シナリオ

各 `ProcessFlow` には最低 3 件のシナリオを持たせることを推奨する。
1 件目は happy path とし、主要な正常終了 outcome を確認する。
2 件目は validation error とし、入力不備と `errorMessage` を確認する。
3 件目は DB state dependency とし、`dbState` 前提と `dbRow` assertion を確認する。
外部システム連携や監査要件が重要な場合は、`externalCall` や `auditLog` の追加シナリオを置く。

## AI 実装者の責務

AI 実装者は `testScenarios` を単なる説明文として扱わず、テスト生成の入力として扱う。
`when.actionId` が存在しない場合は、実装前に仕様不整合として報告する。
`given` の `tableId` や `externalRef` が参照先と合わない場合も同様に扱う。
assertion の意味を満たすために必要なテスト基盤は、対象アプリの標準的な方法で用意する。
シナリオが 3 件未満の成熟した処理フローでは、テスト観点不足として追加提案する。

## AJV テスト

v3 サンプルの検証: `cd frontend && npx vitest run src/schemas/v3-samples.test.ts src/schemas/v3-variant-coverage.test.ts`

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `TestScenario` / `GivenVariant` / `ThenVariant`
- `docs/spec/process-flow-maturity.md` — 成熟度と down-stream モード
- `examples/<project-id>/actions/` または `examples/<project-id>/process-flows/` — v3 形式の実サンプル (`authoring.testScenarios` 参照。canonical 置き場: `examples/retail/`, `examples/realestate/`)
