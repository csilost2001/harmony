---
description: "Criterion (ExternalSystemStep の successCriteria、Arazzo 1.0 互換、$ Runtime Expression 推奨)"
status: current
category: process-flow
---

# Criterion — 成功判定条件仕様 (#427 P3-2)

**改訂日: 2026-04-28 (v3 反映)**

`Criterion` は ExternalSystemStep の `successCriteria` フィールドで使う条件式型です。Arazzo 1.0 仕様の `successCriteria` に対応し、外部 API 呼び出しの成否をプログラム的に判定します。

v3 schema での定義位置: `schemas/v3/process-flow.v3.schema.json` — `StructuredCriterion` / `Criterion`

## 型定義

```ts
type CriterionType = "simple" | "regex" | "jsonpath" | "xpath";

interface StructuredCriterion {
  type: CriterionType;
  expression: string;    // 評価式
  context?: string;      // 評価対象 (jsonpath / xpath で必須)
}

type Criterion = string | StructuredCriterion;
```

後方互換性のため、既存の `string` 形式も引き続き valid です。

## Arazzo Runtime Expression ($記法) — 推奨記法 (#431 P3-1)

Arazzo 1.0 仕様では Runtime Expressions に `$` プレフィックスを使います。本プロジェクトは `$` 記法を推奨とし、旧 `@` 記法は後方互換として引き続き有効です。

| Arazzo Runtime Expression | 意味 |
|---------------------------|------|
| `$statusCode`             | HTTP ステータスコード (数値) |
| `$response.body`          | レスポンス body 全体 (JSON オブジェクト) |
| `$response.body#/path`    | JSON Pointer でレスポンス body の特定フィールドを参照 |
| `$response.header.X-Foo`  | レスポンスヘッダー値 |
| `$request.body`           | リクエスト body |
| `$inputs.<name>`          | ワークフロー入力変数 |

**移行例:**

| 旧 @記法 | 推奨 $記法 |
|----------|-----------|
| `@statusCode` | `$statusCode` |
| `@responseBody` | `$response.body` |
| `@responseBody.id` | `$response.body#/id` |

## CriterionType 一覧

| type       | expression 例                        | context 例 ($ 記法推奨)      | 説明 |
|------------|--------------------------------------|------------------------------|------|
| `simple`   | `$statusCode == 200`                 | (省略可)                     | 単純比較式。ランタイムが変数を展開して評価 |
| `regex`    | `^pi_`                               | `$response.body#/id`         | 正規表現マッチ。context に評価対象文字列を指定 |
| `jsonpath` | `$.status`                           | `$response.body`             | JSONPath 評価。context に JSON オブジェクトを指定 |
| `xpath`    | `//result/status/text() = 'success'` | `$response.body`             | XPath 評価。context に XML 文字列を指定 |

## 利用場所

`ExternalSystemStep.successCriteria?: Criterion[]`

すべての条件が true の場合に「成功」と見なします (AND 結合)。

v3 形式の利用例:

```json
{
  "kind": "externalSystem",
  "id": "step-call-api",
  "description": "外部 API を呼び出す",
  "systemRef": "stripe",
  "successCriteria": [
    { "type": "simple",   "expression": "$statusCode == 200" },
    { "type": "jsonpath", "expression": "$.status",           "context": "$response.body" },
    { "type": "regex",    "expression": "^pi_",               "context": "$response.body#/id" }
  ]
}
```

## Arazzo Export との連携

`designer__export_arazzo` MCP ツールは `successCriteria` を Arazzo 1.0 ワークフローの同名フィールドにそのままマッピングします。`successCriteria` が未設定の場合はそのステップの `successCriteria` フィールドを省略します。

## 設計判断

- `string` 形式との union にすることで既存フロー定義を破壊せず移行可能 (旧データは再検証不要)
- `context` を optional にすることで `simple` 型が `context` を省略できる (短縮記法)
- AND 結合のみサポート — OR は複数 Branch による表現を推奨

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `Criterion` / `StructuredCriterion`
- `docs/spec/process-flow-external-system.md` — ExternalSystemStep 詳細
