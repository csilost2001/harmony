# Secrets カタログ (context.catalogs.secrets) 仕様

**改訂日: 2026-04-28 (v3 反映)**

| 項目 | 値 |
|---|---|
| 関連 ISSUE | #261 (v1.6 初出) / #414 (環境別 values 拡張) / 親 #396 |
| 由来 | Power Platform Environment Variables (Secret Type) / 12-factor App Config |
| 対応スキーマ | `schemas/v3/process-flow.v3.schema.json` の `SecretRef` / `context.catalogs.secrets` |
| 対応型 | `frontend/src/types/action.ts` の `SecretRef` / `ProcessFlow.context.catalogs.secrets` |
| 関連規約 | [`docs/conventions/expressions.md`](../conventions/expressions.md) (`@secret.*` 参照規約) / [`process-flow-env-vars.md`](process-flow-env-vars.md) (非機密 env と対比) |

## 1. 何のためのカタログか

API キー・DB パスワード・署名鍵等の**秘匿値のメタデータ**を ProcessFlow で宣言する場所。値そのものは JSON に保存せず、`source` で実際の取得先 (環境変数 / vault / file) を指す。

ExternalAuth.tokenRef や DB 接続文字列などから `@secret.<key>` 記法で参照される。

**キー規範**: `context.catalogs.secrets` のキーは **Identifier (camelCase)** で統一する。例: `stripeApiKey`, `sendgridApiKey`, `analyticsApiKey`。

## 2. JSON 形 (v3)

### 2.1 旧フォーマット (#261 v1.6、values 無し) — **後方互換で引き続き valid**

```json
{
  "context": {
    "catalogs": {
      "secrets": {
        "stripeApiKey": {
          "source": "env",
          "name": "STRIPE_SECRET_KEY",
          "description": "Stripe Payment Intents API 認証",
          "rotationDays": 90
        }
      }
    }
  }
}
```

### 2.2 新フォーマット (#414、環境別 values 入り)

```json
{
  "context": {
    "catalogs": {
      "secrets": {
        "stripeApiKey": {
          "source": "env",
          "name": "STRIPE_SECRET_KEY",
          "description": "Stripe Payment Intents API 認証",
          "rotationDays": 90,
          "values": {
            "dev": "vault://stripe/dev/secret_key",
            "staging": "vault://stripe/staging/secret_key",
            "prod": "vault://stripe/prod/secret_key"
          }
        }
      }
    }
  }
}
```

`values` は実値を入れず**参照式 (vault://, env://, k8s-secret://) のみ**を入れる規約。これによりリポジトリに値が乗ることを防ぎつつ、ALM (環境間配布) で参照経路だけ宣言できる。

### 2.3 `SecretRef` フィールド

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `source` | `"env" \| "vault" \| "file"` | ◯ | 既定の取得元 (values 未設定時の fallback / 旧フォーマット) |
| `name` | string | ◯ | source 毎の名前 (env → 環境変数名 / vault → パス / file → ファイルパス) |
| `description` | string | — | 人間向け説明 |
| `rotationDays` | integer ≥ 1 | — | ローテーション周期 (日)。未指定は運用規約依存 |
| `lastRotatedAt` | ISO date-time | — | 最終ローテーション時刻 |
| `values` | `Record<string, string>` (#414) | — | 環境別の参照式。dev / staging / prod 等の任意キー。実値ではなく `vault://` / `env://` / `k8s-secret://` 形式の文字列のみ |

### 2.4 環境キー命名規約

`context.catalogs.envVars` と同じ。推奨は `dev` / `staging` / `prod`。詳細は [`process-flow-env-vars.md`](process-flow-env-vars.md) §2.2。

## 3. 参照式のスキーム規約

`values` の値文字列は以下のスキームのいずれかで書く:

| スキーム | 形式 | 用途 |
|---|---|---|
| `vault://` | `vault://<path>` | HashiCorp Vault / AWS Secrets Manager / GCP Secret Manager 等 |
| `env://` | `env://<ENV_NAME>` | 環境変数 (12-factor) |
| `k8s-secret://` | `k8s-secret://<secret-name>[/<key>]` | Kubernetes Secret |
| `file://` | `file://<path>` | ローカルファイル (開発時のみ) |

実装側は `values[現在環境]` の文字列を解析し、対応する実装で実値を取得する。

## 4. 環境別 override の解決順序

`@secret.<key>` 参照の解決順序:

```
1. process.env.NODE_ENV (or APP_ENV) で現在環境キーを決定
2. context.catalogs.secrets[key].values[現在環境キー] が存在 → 参照式を解析して実値取得
3. (旧フォーマット fallback) context.catalogs.secrets[key].source + name で実値取得
   - source="env" → process.env[name]
   - source="vault" → vault API
   - source="file" → ファイル読込
4. いずれも無い → 未定義として実装はエラー (起動時 fast-fail 推奨)
```

## 5. 式言語からの参照 (`@secret.*`)

ProcessFlow 内で `@secret.<key>` 参照が使える代表的な箇所:

- `ExternalAuth.tokenRef` (例: `"@secret.stripeApiKey"`)
- `httpCall.headers` の値 (例: `"X-API-Key": "@secret.thirdPartyKey"`)
- DB 接続定義 (将来)

参照規約の正規仕様: [`docs/conventions/expressions.md`](../conventions/expressions.md)

`@secret.*` の参照対象が `context.catalogs.secrets` に未登録の場合、参照整合性バリデータが警告を出す (#261 の振る舞い踏襲)。

v3 形式の参照例:

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
          }
        }
      },
      "secrets": {
        "stripeApiKey": {
          "source": "env",
          "name": "STRIPE_SECRET_KEY",
          "description": "Stripe API 認証",
          "rotationDays": 90
        }
      }
    }
  }
}
```

## 6. `context.catalogs.envVars` との使い分け

[`process-flow-env-vars.md`](process-flow-env-vars.md) §5 に対比表を記載。

要点:
- 値そのものを JSON に書ける = `context.catalogs.envVars`
- 値は外部 secret store に置きたい (リポジトリに乗せたくない) = `context.catalogs.secrets`

## 7. UI

ProcessFlow 編集ヘッダの `ActionMetaTabBar` に `secrets` タブが既存。`SecretsCatalogPanel.tsx` でエントリ単位に key / source / name / rotationDays / description / **values (環境別参照式)** を編集する。

## 8. 後方互換

- `values` が未設定のエントリも引き続き valid (旧フォーマット)。
- `values` が設定されたエントリは、現在環境キーが見つからない場合 `source` + `name` の旧経路に fallback する。
- 新規データは新フォーマット (`values` 入り) を推奨。

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — `SecretRef` / `context.catalogs.secrets`
- `docs/spec/process-flow-env-vars.md` — 非機密環境変数カタログ
- `docs/conventions/expressions.md` — `@secret.*` 参照規約
