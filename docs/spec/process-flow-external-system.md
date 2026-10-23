---
description: "ExternalSystemStep の OpenAPI operation 参照 (openApiSpec / operationRef)"
status: current
category: process-flow
---

# ProcessFlow ExternalSystemStep OpenAPI 参照 (#413)

**改訂日: 2026-04-28 (v3 反映)**

## 目的

`ExternalSystemStep` は外部 API 呼び出しを表す。AI 実装者が `systemRef` や `httpCall.path` から API 仕様を推測しなくて済むよう、`context.catalogs.externalSystems` から OpenAPI 仕様書へリンクし、各 step から OpenAPI operation を直接参照する。

## context.catalogs.externalSystems.openApiSpec

`context.catalogs.externalSystems.<systemRef>.openApiSpec` は、その外部システムの OpenAPI 仕様書を指す任意フィールド。

- 型: `string`
- 値: URL またはリポジトリ内の相対 path
- 例: `https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json`

AI 実装時は `systemRef` でカタログ entry を引き、`baseUrl` / `auth` / `headers` と合わせて `openApiSpec` を読む。Stripe や SendGrid のように公開 OpenAPI があるサービスでは、operation、request body、response schema を仕様書から確定できる。

**systemRef キーは Identifier (camelCase)** で統一する。`externalSystemCatalog` の key と `ExternalSystemStep.systemRef` の値が一致することで、カタログ参照が成立する。旧来の `systemName` (表示名) と `systemRef` の二重持ちは廃止し、`systemRef` のみを参照キーとして使用する。

## operationRef と operationId

`ExternalSystemStep` には OpenAPI operation を特定するための任意フィールドを置ける。

- `operationRef`: OpenAPI `$ref` 風の参照。例: `/v1/payment_intents POST`、または full URI fragment
- `operationId`: OpenAPI `operationId`
- `requestBodyRef`: request body schema への JSON Pointer / `$ref`
- `responseId`: response schema への JSON Pointer / `$ref` (v3 では `responseRef` から改称)

選択ロジック:

1. `operationRef` があれば最優先で使う。
2. `operationRef` がなく `operationId` があれば、OpenAPI 仕様内の `operationId` で検索する。
3. どちらもなければ従来どおり `httpCall.method` / `httpCall.path` から呼び出し先を解釈する。

`operationRef` と `operationId` は併記できる。併記時は `operationRef` を正とし、`operationId` は人間向け・検索補助の別名として扱う。両者が OpenAPI 仕様上で別 operation を指す場合、実装者またはバリデータは警告を出す。

## httpCall との優先順位

`httpCall` は後方互換のため引き続き有効。`operationRef` と `httpCall` は同じ呼び出し先を表し得るため、両方ある場合は `operationRef` を優先する。

推奨:

- 新規データは `operationRef` または `operationId` を追加する。
- 既存の `httpCall` は当面残し、実装環境が OpenAPI 参照を解決できない場合の fallback とする。
- `operationRef` と `httpCall.method/path` が矛盾する場合は警告する。

## 例

Stripe Payment Intent 作成 (v3 形式):

```json
{
  "kind": "externalSystem",
  "id": "step-stripe-create",
  "description": "Stripe Payment Intent を作成する",
  "systemRef": "stripe",
  "operationRef": "/v1/payment_intents POST",
  "operationId": "PostPaymentIntents",
  "requestBodyRef": "#/components/schemas/PaymentIntentCreateParams",
  "responseId": "#/components/schemas/payment_intent",
  "httpCall": {
    "method": "POST",
    "path": "/v1/payment_intents"
  }
}
```

SendGrid mail send (v3 形式):

```json
{
  "kind": "externalSystem",
  "id": "step-sendgrid-send",
  "description": "SendGrid でメールを送信する",
  "systemRef": "sendgrid",
  "operationRef": "/v3/mail/send POST",
  "operationId": "mail.send",
  "httpCall": {
    "method": "POST",
    "path": "/v3/mail/send"
  }
}
```

カタログ側 (`context.catalogs.externalSystems`) の対応定義:

```json
{
  "context": {
    "catalogs": {
      "externalSystems": {
        "stripe": {
          "name": "Stripe Japan",
          "baseUrl": "https://api.stripe.com",
          "auth": {
            "kind": "apiKey",
            "tokenRef": "@secret.stripeApiKey",
            "headerName": "Authorization"
          },
          "openApiSpec": "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json"
        },
        "sendgrid": {
          "name": "SendGrid",
          "baseUrl": "https://api.sendgrid.com",
          "auth": {
            "kind": "apiKey",
            "tokenRef": "@secret.sendgridApiKey",
            "headerName": "Authorization"
          }
        }
      }
    }
  }
}
```

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `ExternalSystemStep` 定義
- `docs/spec/process-flow-runtime-conventions.md` §2 — HTTP body 直列化規約
- `docs/spec/process-flow-criterion.md` — ExternalSystemStep.successCriteria
