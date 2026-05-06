# 環境変数カタログ (context.catalogs.envVars) 仕様

**改訂日: 2026-04-28 (v3 反映)**

| 項目 | 値 |
|---|---|
| 関連 ISSUE | #414 (P1-2 環境別 values 構造) / 親 #396 |
| 由来 | Power Platform Environment Variables (ALM 対応) |
| 対応スキーマ | `schemas/v3/process-flow.v3.schema.json` の `EnvVarEntry` / `context.catalogs.envVars` |
| 対応型 | `frontend/src/types/action.ts` の `EnvVarEntry` / `ProcessFlow.context.catalogs.envVars` |
| 関連規約 | [`docs/conventions/expressions.md`](../conventions/expressions.md) (`@env.*` / `@secret.*` 参照規約) |

## 1. 何のためのカタログか

業務システムは複数環境 (dev / staging / prod) で動作させることが前提。Power Platform の Environment Variables は「**環境別 override / 型 / 既定値**」を一級概念として持ち、ALM (Application Lifecycle Management) を可能にしている。

本プロジェクトの ProcessFlow には:

- 通常の (非機密) 設定値を**型付き**で扱う構造
- **環境別の値切替**
- **既定値**

を備えた `context.catalogs.envVars` を導入する。秘匿値は別途 [`context.catalogs.secrets`](process-flow-secrets.md) で扱う。

## 2. JSON 形 (v3)

v3 では `ProcessFlow.context.catalogs.envVars` に配置する:

```json
{
  "context": {
    "catalogs": {
      "envVars": {
        "STRIPE_API_BASE": {
          "type": "string",
          "description": "Stripe API のベース URL",
          "values": {
            "dev": "https://api.stripe.com/v1",
            "staging": "https://api.stripe.com/v1",
            "prod": "https://api.stripe.com/v1"
          },
          "default": "https://api.stripe.com/v1"
        },
        "MAX_RETRY_ATTEMPTS": {
          "type": "number",
          "values": { "dev": 1, "staging": 3, "prod": 5 },
          "default": 3
        },
        "FEATURE_FLAG_NEW_PRICING": {
          "type": "boolean",
          "values": { "dev": true, "staging": true, "prod": false },
          "default": false
        }
      }
    }
  }
}
```

**EnvVarKey 規範**: キーは `SCREAMING_SNAKE_CASE` (大文字アンダースコア区切り)。例: `STRIPE_API_BASE`, `MAX_RETRY_ATTEMPTS`, `FEATURE_FLAG_NEW_PRICING`。

### 2.1 `EnvVarEntry` フィールド

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"string" \| "number" \| "boolean"` | ◯ | 値の型。実装側はこの型に従って parse する。`"string"` は表現力が高すぎるため、URL 文字列 / 識別子なども一旦 string 扱い |
| `description` | string | — | 人間向け説明。AI 実装時の意味解釈の手がかり |
| `values` | `Record<string, primitive>` | — | 環境別の値。キーは任意 (推奨: `dev` / `staging` / `prod`)。値は `type` と整合した primitive (string / number / boolean) または式文字列 |
| `default` | primitive | — | `values` で当該環境キーが未指定時に使う既定値。`type` と整合した primitive |

### 2.2 環境キー命名規約

`values` のキーは**任意の文字列**。プロジェクト規約として以下を推奨:

| 環境 | 推奨キー | 用途 |
|---|---|---|
| 開発 | `dev` | 開発者ローカル / dev サーバ |
| 検証 | `staging` | UAT / pre-prod / QA |
| 本番 | `prod` | 本番 |

複数 region や AB テストで分けたい場合は `prod-jp` / `prod-us` 等の追加キーを許容する。

## 3. 環境別 override の解決順序

実装ランタイムが `@env.<KEY>` を解決する際の優先順位:

```
1. process.env.NODE_ENV (or APP_ENV) で現在環境キーを決定
2. context.catalogs.envVars[KEY].values[現在環境キー] が存在 → これを使う
3. context.catalogs.envVars[KEY].default が存在 → これを使う
4. いずれも無い → 未定義として実装はエラー (起動時 fast-fail 推奨)
```

実装フレームワーク (Express/NestJS/Spring Boot 等) の起動時に envVars カタログ全件を resolve して `Map<key, resolved>` を構築し、以後は `@env.KEY` 参照を O(1) で解決するのが推奨パターン。

## 4. 式言語からの参照 (`@env.*`)

ProcessFlow 内の以下フィールドで `@env.<KEY>` 参照を使える:

- `runIf` (例: `"@env.FEATURE_FLAG_NEW_PRICING"`)
- `expression` (ComputeStep)
- `bodyExpression` (ReturnStep)
- `httpCall.path` / `httpCall.body` / `httpCall.query` の値 (式補間)
- `idempotencyKey`
- `headers` の値
- `argumentMapping` の値

参照規約の正規仕様: [`docs/conventions/expressions.md`](../conventions/expressions.md)

例:
```json
{
  "kind": "externalSystem",
  "id": "step-stripe",
  "description": "Stripe API を呼び出す",
  "systemRef": "stripe",
  "httpCall": {
    "method": "POST",
    "path": "@env.STRIPE_API_BASE/payment_intents"
  },
  "retryPolicy": { "maxAttempts": "@env.MAX_RETRY_ATTEMPTS" }
}
```

```json
{
  "kind": "branch",
  "id": "step-feature-branch",
  "description": "新価格フラグで分岐",
  "branches": [
    {
      "id": "br-new-pricing",
      "code": "A",
      "condition": "@env.FEATURE_FLAG_NEW_PRICING",
      "steps": []
    }
  ]
}
```

## 5. `context.catalogs.secrets` との使い分け

| 観点 | `context.catalogs.envVars` | `context.catalogs.secrets` |
|---|---|---|
| 対象値 | 公開設定値 (URL / 件数 / フラグ) | 秘匿値 (API key / 鍵 / パスワード) |
| 値の保存 | values に**実値**を入れる | values には**参照式**のみ。実値は外部 secret store |
| 参照 | `@env.<KEY>` | `@secret.<key>` |
| ALM 配布 | リポジトリ内 JSON で管理 | 参照式のみ。値は環境固有の secret store |

秘匿値を `context.catalogs.envVars` に入れない (リポジトリに値が乗ってしまう)。

## 6. UI

ProcessFlow 編集ヘッダの `ActionMetaTabBar` に `envVars` タブを追加。`EnvVarsCatalogPanel.tsx` でエントリ単位に key / type / description / values / default を編集する。

## 7. 後方互換

- `context.catalogs.envVars` 自体が optional のため、未設定の旧データは引き続き有効。
- 新規データは新フォーマットで保存。
- 旧 ProcessFlow に `context.catalogs.secrets` のみがあるケースも有効 (`envVars` 無しで動く)。

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `EnvVarEntry` / `ProcessFlow.context.catalogs.envVars`
- `docs/spec/process-flow-secrets.md` — 秘匿値カタログ
- `docs/conventions/expressions.md` — `@env.*` 参照規約
