# 処理フロー 実行時規約 (ランタイム挙動)

**改訂日: 2026-04-28 (v3 反映)**

Issue: #261 v1.5
策定日: 2026-04-20
ステータス: **初版**

本ドキュメントは、処理フロー JSON Schema 上に現れるが「**スキーマ制約としては表現しない / できないが、実装者が従うべき規約**」を集約する。再ドッグフード 4.85/5 で「schema だけでは決定できない」と指摘された項目が対象。

本ドキュメントは v3 スキーマ (`schemas/v3/process-flow.v3.schema.json`) に準拠する。v3 では step の `type` フィールドは `kind` に改称、カタログ類は `context.catalogs.*` 配下に統合、`ambientVariables` は `context.ambientVariables` に移動した。

関連仕様:
- [process-flow-extensions.md](process-flow-extensions.md) — 構造化フィールド定義
- [process-flow-expression-language.md](process-flow-expression-language.md) — 式言語 BNF
- [process-flow-variables.md](process-flow-variables.md) — 変数・outputBinding
- [process-flow-maturity.md](process-flow-maturity.md) — 成熟度・モード

## 1. SQL 内の式補間 (`DbAccessStep.sql`)

### 1.1 原則: prepared statement ベース

`sql` 内に現れる `@expression` は**静的文字列置換ではなく、prepared statement のパラメータバインディング**に変換する。

### 1.2 変換規則

1. `@identifier` および `@identifier.path` (プロパティアクセス) は順に `$1, $2, ...` (PostgreSQL) / `?, ?, ...` (MySQL) に置換
2. 展開時の値は **js-subset 式評価結果** (§process-flow-expression-language.md)
3. `?.` オプショナルチェイン結果が undefined の場合は `NULL` バインド
4. 関数呼出・算術演算子を含む式 (`@a + @b`, `Math.floor(@x)` 等) は **SQL 側で実行せず、JS で事前評価してから**バインド

例:

```sql
-- ソース
INSERT INTO orders (customer_id, total, payment_id)
VALUES (@customerId, @subtotal + @taxAmount, @paymentAuth?.id)

-- PostgreSQL prepared statement
INSERT INTO orders (customer_id, total, payment_id) VALUES ($1, $2, $3)
-- パラメータ: [customerId, (subtotal + taxAmount), paymentAuth?.id ?? null]
```

### 1.3 SQL キーワード vs 式

`CURRENT_TIMESTAMP` / `COALESCE(...)` / `NULL` / 列名 (`orders.status`) は **SQL 字句としてそのまま使用**。`@` プレフィックスがないものは全て SQL 字句。

### 1.4 SELECT 句の列 alias 規約 (#775)

SELECT 結果が ViewDefinition `columns[].name` (camelCase) へ直接バインドされる場合は、**SQL 内で `AS "<camelCase>"` alias を明示する**。

```sql
-- NG: snake_case 物理名のまま返す (VD column 'unitPrice' と不一致)
SELECT p.unit_price, p.product_code FROM products p

-- OK: AS alias で VD column 名と一致させる
SELECT p.unit_price AS "unitPrice", p.product_code AS "productCode" FROM products p
```

**理由**: runtime での暗黙変換 (snake_case → camelCase) は validator 検出不能。alias で構文上の binding を確定させる (#775)。

詳細: [`docs/spec/view-definition.md` § (D-5)](view-definition.md)

### 1.5 in-clause の展開

`WHERE id IN (@ids)` のような配列展開は、`@ids` の要素数に応じて `$N, $N+1, ...` を展開:

```sql
-- ソース
WHERE id IN (@ids)  -- @ids = [10, 20, 30]

-- 展開後
WHERE id IN ($1, $2, $3)
-- パラメータ: [10, 20, 30]
```

## 2. HTTP body の直列化 (`ExternalSystemStep.httpCall.body`)

### 2.1 既定: `application/json`

`httpCall.body` は js-subset の object literal 式。既定で **JSON 直列化**される。Content-Type ヘッダは `context.catalogs.externalSystems[systemRef].headers` / step.headers で上書き可。

```json
// 既定
"httpCall": { "method": "POST", "path": "/v1/foo", "body": "{ name: @user.name, age: @user.age }" }
// → application/json として送信: {"name": "...", "age": 25}
```

### 2.2 `application/x-www-form-urlencoded` (Stripe 等)

外部 API が form-urlencoded を要求する場合 (Stripe、レガシー OAuth 等)、**`context.catalogs.externalSystems` または step.headers で明示**:

```json
{
  "context": {
    "catalogs": {
      "externalSystems": {
        "stripe": {
          "name": "Stripe Japan",
          "headers": {
            "Stripe-Version": "2024-06-20",
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      }
    }
  }
}
```

このとき body object literal は form-encoded 規則で serialize (ネスト object は `parent[child]` 記法、配列は `parent[]`):

```
body: { amount: 100, metadata: { customer_id: 42 }, items: [1, 2] }
→ amount=100&metadata[customer_id]=42&items[]=1&items[]=2
```

### 2.3 undefined / null の扱い

値が undefined (例: `@optionalField` が未設定) のフィールドは **body から除外**。null は **明示的に null/空文字として送信** (API 仕様に従う)。

### 2.4 query の serialize

`httpCall.query` は常に URL クエリ文字列。値は js-subset 式として評価、`URLSearchParams` 相当で encode。

## 3. トランザクション × 例外 × Saga 補償の連鎖

### 3.1 `transactionScope.steps[]` の範囲

`transactionScope` step の `steps[]` 配列に含まれる step 群が **1 つの DB トランザクション**。v3 では旧 `txBoundary` (平坦モデル) は廃止、TX 範囲は構造で表現する (詳細: [`process-flow-transaction.md`](process-flow-transaction.md))。

### 3.2 throw → ROLLBACK の自動発火

TX 範囲内 (`transactionScope.steps[]` 配下) で以下が起きた場合、**TX は自動 ROLLBACK**:

- `DbAccessStep.affectedRowsCheck.onViolation: "throw"` が発火
- `ExternalSystemStep.outcomes.failure.action: "abort"` (compensate は個別補償なので ROLLBACK とは独立)
- いずれかの step で JavaScript エラー (ValidationError 等) が throw される

`rollbackOn` 指定がある場合は、列挙された `errorCode` の throw のみ rollback を引き起こす (詳細: [`process-flow-transaction.md`](process-flow-transaction.md) §2.4)。

### 3.3 ROLLBACK 後の `tryCatch` 捕捉

自動 ROLLBACK された throw は、`transactionScope` step より **後ろにある** `BranchStep` の `branches[].condition: { kind: "tryCatch", errorCode: "..." }` で捕捉される。または `transactionScope.outputBinding` で TX 結果を expose し、後続 branch の `condition.kind: "expression"` で `@txResult.error.code` 等を参照する (推奨パターン、[`process-flow-transaction.md`](process-flow-transaction.md) §8.5)。

`errorCode` のマッチング:
- `affectedRowsCheck.errorCode` の値と `BranchConditionVariant.errorCode` が等しければマッチ
- 通常 Error の場合は `context.catalogs.errors` のキーにマッチさせる規約 (implicit)

### 3.4 捕捉後の補償 (Saga compensate)

tryCatch ブランチ内に置いた `compensatesFor: "step-xxx"` 付きの ExternalSystemStep が、**既に成功していた外部呼出の取消**を実行する。

## 4. `fireAndForget: true` の意味論

### 4.1 同期レスポンス待たない

`fireAndForget: true` の ExternalSystemStep は、**HTTP レスポンスを待たずに次の step へ進む**。typical 実装:

```js
// 擬似コード
const promise = httpClient.post(path, body);
// await しない
promise.catch((err) => { /* outcomes.failure の sideEffects を実行 */ });
```

### 4.2 outcomes の評価

`outcomes.success` は評価しない (そもそも成功を待たないため)。`outcomes.failure` / `outcomes.timeout` は **バックグラウンドで発生した場合のみ** sideEffects を実行 (例: Sentry に記録)。

### 4.3 タイムアウト

`timeoutMs` は fireAndForget でも有効。**バックグラウンドの Promise がこの時間を超えたら reject 扱い**して failure sideEffects を走らせる。

## 5. `externalChain.phase` の順序規約

`phase: "authorize" → "capture" → "cancel"` の順序は **スキーマでは強制しない**。以下は **規約として守る**:

1. 同一 `chainId` の step のうち、`authorize` が時系列上最初
2. `capture` は `authorize` の成功後のみ実行可能 (runIf で `@paymentAuth != null` 等で守る)
3. `cancel` は `authorize` の実施後 (capture 前でも後でも可)
4. `authorize` 未実施の状態で `capture` / `cancel` を実行してはならない

実装側は `externalChain` を**ログ相関 (observability)** + **Saga 補償のリソース突合**に使う。動作保証は step の配置と runIf で書き手が担保する。

## 6. `sideEffects` 内 DB アクセスの TX 境界

`ExternalCallOutcomeSpec.sideEffects` 内に置かれた `DbAccessStep` は、**sideEffects 発火時点で外側の TX は既に commit / rollback 済**という前提。

- **autocommit モード**で個別に実行 (新しい TX を開かない)
- 失敗しても外側のメインフローには影響しない (sideEffects は best-effort)
- retry は想定しない (retry したい場合は普通の step として配置)

例 (0005 の capture 失敗時):

```
step-or2-011 (capture) が失敗
→ outcomes.failure.sideEffects で
  - "UPDATE orders SET status='payment_failed'" (autocommit)
  - Sentry 記録
  - Slack 通知
```

この UPDATE は外側 TX (tx-order-main) とは別に実行される。

## 7. `HttpResponseSpec.when` の意味

`when: "@paymentAuth.status == 'failed'"` は **documentation 兼評価式**:

- **primary**: 人間と AI 向けの「どういう条件でこのレスポンスが返るか」の説明
- **secondary**: 参照整合性バリデータが `when` 内の `@identifier` が定義済みかを検査可能 (将来拡張)
- **実行時は使わない**: 実際の分岐は step-level の ReturnStep / inlineBranch で行う

## 8. `action.httpRoute.auth` の認証スキーム

`auth: "required" | "optional" | "none"` は **認証の有無**を示すフラグ。具体的な認証スキーム (Bearer / Session cookie / Basic / API key 等) は:

### 8.1 推奨: ProcessFlow.context.ambientVariables で明示 (v3)

```json
{
  "context": {
    "ambientVariables": [
      { "name": "userId", "type": "number", "required": true,
        "description": "Bearer token から middleware が解決して注入" }
    ]
  }
}
```

### 8.2 context.catalogs.externalSystems とは別扱い

`context.catalogs.externalSystems` は **outbound** (自アプリ → 外部 API) の認証。`httpRoute.auth` は **inbound** (クライアント → 自アプリ)。混同しないこと。

### 8.3 スキーム固有の仕様は product-scope へ

プロジェクト全体で採用している認証方式 (Bearer JWT / Session / OAuth2 等) は `docs/conventions/product-scope.md` に宣言。処理フロー個別のスキーマではなく**プロダクト横断規約**として管理。

### 8.5 context.catalogs.secrets と tokenRef の連携 (#261 v1.6)

ExternalAuth.tokenRef は以下 3 形式を受け付ける:

1. **`@secret.<key>`** (推奨): ProcessFlow.context.catalogs.secrets 参照。参照整合性バリデータが未登録エラーを検出
2. **`ENV:<envName>`** (後方互換): 環境変数名直書き
3. **`SECRET:<path>`** (後方互換): 外部 secret store パス直書き

新規データは `@secret.*` を使い、catalog 側で source (env/vault/file) と name を管理する。catalog は値そのものを持たず、**メタデータのみ**。

```json
{
  "context": {
    "catalogs": {
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

実装時は source 毎に:
- `env` → `process.env[secretRef.name]`
- `vault` → HashiCorp Vault / AWS Secrets Manager / GCP Secret Manager の API
- `file` → ファイルから読込 (開発時のみ)

### 8.4 inbound auth 具体スキーム決定フロー

実装者が `httpRoute.auth: "required"` を見たとき、以下の順で具体スキームを決定する:

```
httpRoute.auth == "required" ?
  ├─ yes → context.ambientVariables に "userId" / "accountId" 等の identity 変数があるか?
  │   ├─ yes → scheme は Bearer JWT (token から middleware が userId を解決して @userId に注入)
  │   └─ no → docs/conventions/product-scope.md §6 の既定 scheme (例: Session cookie) を採用
  └─ no → スキーム解決不要 (auth: "none" / "optional")
```

0005 の例: `httpRoute.auth: "required"` + `context.ambientVariables` に `sessionId` があるが `userId` なし → product-scope §6 の規定 (Session cookie + httpOnly) を採用。

## 9. Ambient Context — 規約カタログ defaults と ambientOverrides (#369)

### 9.1 Ambient Context の定義

**Ambient Context** とは、ProcessFlow が明示的に inputs で受け取るのではなく、「プロジェクト全体に共通する前提」として暗黙に利用する環境情報のこと。v3 では `context.ambientVariables` に宣言する。代表例:

| Ambient 項目 | 参照パス | 既定値 (プロジェクト既定) |
|---|---|---|
| タイムゾーン | `@conv.scope.timezone` | `Asia/Tokyo` (JST) |
| 通貨 | `@conv.currency.jpy` | JPY (subunit=0, roundingMode=floor) |
| 消費税方式 | `@conv.tax.standard` | 外税 10%, 切り捨て |
| 認証スキーム | `@conv.auth.default` | session-cookie + httpOnly |
| DB 規約 | `@conv.db.default` | PostgreSQL 14+, snake_case |

### 9.2 規約カタログが project-wide defaults を担う

`data/conventions/catalog.json` の各エントリに `"default": true` を付与したものが、**全 ProcessFlow の共通 ambient default** となる。

- `"default": true` が付いていないエントリは「オプション定義」(比較対象・将来用) として存在可
- 1 カテゴリ内に複数 `"default": true` がある場合の動作は未定義 (バリデータが将来検出予定)
- AI 実装者は `data/conventions/catalog.json` を「実装の前提条件」として最初に読む
- **対象カテゴリ**: `scope` / `currency` / `tax` / `auth` / `db` の 5 カテゴリのみ。`msg` / `regex` / `limit` / `numbering` / `tx` / `externalOutcomeDefaults` はルックアップテーブルまたは複数方針の共存で「単一 default」の概念が適用されないため対象外
- **注意 — キー名と `default` プロパティ名の重複**: `auth.default`・`db.default` 等、エントリのキー名が `"default"` の場合、新プロパティ `"default": true` を追加すると同名が 2 か所現れる。これは **JSON 構造上は問題ない** (キー名 `"default"` は object のキー、`"default": true` は そのオブジェクト内のプロパティ) が、視覚的に分かりにくい。既存キー名は互換性のため変更せず、コメントが必要な場合は `description` フィールドで補足する

```json
// data/conventions/catalog.json の例
{
  "currency": {
    "jpy": { "code": "JPY", "subunit": 0, "roundingMode": "floor", "default": true },
    "usd": { "code": "USD", "subunit": 2, "roundingMode": "round" }
  }
}
```

### 9.3 ProcessFlow.context.ambientOverrides — フロー単位の例外指定 (v3)

大多数のフローは規約カタログの defaults をそのまま使う。**特定フローだけ例外** (外貨精算・UTC バッチ等) の場合にのみ、`context.ambientOverrides` フィールドで上書きする。

```json
// data/process-flows/xxx.json (override が必要な場合のみ記述)
{
  "meta": { "id": "11111111-1111-4111-8111-111111111111", "name": "外貨精算" },
  "context": {
    "ambientOverrides": {
      "currency": "@conv.currency.usd",
      "scope.timezone": "UTC"
    },
    "catalogs": {}
  },
  "actions": []
}
```

**ルール:**

1. `ambientOverrides` が無い ProcessFlow は、規約カタログの `default: true` エントリを全項目で継承
2. `ambientOverrides` で指定したキー (例: `"currency"`) だけ override、残りは defaults 継続
3. 値は `@conv.*` 形式の参照文字列 (カタログ内のキーパスを指す) または直接値 (例: `"UTC"`)
4. `@conv.*` 参照の場合、AI 実装者は参照先カタログエントリの全フィールドを引いて利用する
5. 稀用途: 通常は `ambientOverrides` なしで設計し、必要が生じた時点で追加する

### 9.4 AI 実装者が設計書を読む順序

処理フロー実装時は以下の順で読む:

```
1. data/conventions/catalog.json          — project-wide defaults (通貨・TZ・税率・認証・DB 規約等)
2. 対象 ProcessFlow の ambientOverrides    — 当該フローの特例 (無い場合は 1. の defaults をそのまま適用)
3. 処理フロー本体 (actions / steps)        — 具体ロジック
4. テーブル定義 (DDL)                       — 採番ロジック等のインフラ層
5. 画面項目定義                             — 入出力の UI 制約
```

### 9.5 context.ambientOverrides と context.ambientVariables の違い (v3)

| フィールド | 目的 | 例 (v3 パス) |
|---|---|---|
| `context.ambientVariables` | ミドルウェア由来の **変数宣言** (`@requestId` 等が存在することを明示) | `[{ "name": "userId", "type": "number" }]` |
| `context.ambientOverrides` | 規約カタログ defaults への **例外指定** (フロー単位で通貨・TZ 等を変える) | `{ "currency": "@conv.currency.usd" }` |

両者は別物。`context.ambientVariables` はリクエストスコープの変数、`context.ambientOverrides` はプロジェクト規約に対するフロー固有の例外。

## 10. `compensatesFor` の配置規約

### 10.1 通常は tryCatch ブランチ配下

`StepBase.compensatesFor: string` (補償対象の step ID) を持つ step は、**通常 `BranchStep.branches[].condition: { kind: "tryCatch" }` の steps 配下**に置く。メインフロー側 (成功経路) に置かない理由: 成功経路では補償する必要がない。

### 10.2 runIf で補償対象の成功を確認

補償が意味を持つのは「対象 step が成功した後にエラーが起きた」場合のみ。対象 step の outputBinding を `runIf` で確認する:

```json
{
  "id": "step-stripe-cancel",
  "type": "externalSystem",
  "runIf": "@paymentAuth != null",
  "compensatesFor": "step-stripe-authorize",
  ...
}
```

`@paymentAuth` は authorize 成功時のみ set される → `null` 判定で「既に authorize 済なら cancel」を守る。

### 10.3 参照整合性 (現状の検査範囲)

- `compensatesFor` の値は action 内の既存 step ID であるべき (将来の参照整合性バリデータで検査予定、#261 残)
- 現状は書き手規約

## 11. ログ / 監査ステップの規約

### 11.1 `LogStep` は運用観測用

`type: "log"` はデバッグ・運用観測のためのアプリケーションログを表す。`message` と `structuredData` の値は式として評価してよい。実装は `level` をロガーの重要度に対応させ、`category` が指定されている場合はログルーティング・logger 名・タグ等に利用する。

`LogStep` は業務監査の証跡ではない。誰が何を実行したかをコンプライアンス目的で残す場合は `AuditStep` を使う。

### 11.2 `AuditStep` は actor / timestamp を自動付与

`type: "audit"` は「誰が・いつ・何に対して・何をして・結果どうなったか」の監査証跡を表す。フロー定義には `actor` と `timestamp` を書かない。実装はセッションコンテキストまたは認証ミドルウェアから現在ユーザーを取得し、`@conv.auth.currentUser` 相当の ambient context として自動注入する。時刻は監査ログを書き込むサーバ側で生成し、クライアント入力値を信用しない。

`result` が未指定の場合、実装はステップ実行結果から自動判定する。例外が発生した場合は `failure`、正常完了した場合は `success` として記録する。明示指定がある場合はその値を優先する。

### 11.3 sensitive マスキング

`AuditStep.sensitive: true` の場合、実装は対象値の本体を監査ログに保存しない。`resource.type` / `resource.id` / `action` / `reason` の参照キーやフィールド名は残してよいが、パスワード・トークン・個人番号・秘密値などの値本体は `***` などの固定マスクに置換する。

マスキングは監査ログ出力直前の最後の防御線として行う。上流の `LogStep.structuredData` や例外メッセージにも機微値が混入しないよう、実装は同じマスキングルールを共有することが望ましい。

## RBAC (役割・権限)

`role` と `permission` は横断規約カタログの第一級カテゴリとして扱う。参照は `@conv.role.<key>` / `@conv.permission.<key>` の形式で書く。権限キーは `order.approve` のようにドメインと操作を dot でつないだ名前を推奨する。

Runtime は Action 起動前に actor が持つ role から permission を展開し、`ActionDefinition.requiredPermissions` の全要素を actor の permission 集合が包含するか検証する。欠けている permission があれば処理本体へ入らず、403 相当の outcome を返す。

role の `inherits` は depth-first で展開する。親 role の `inherits` を先にたどり、得られた permission は重複を除去して集合として扱う。循環参照は conventions validator のエラーであり、runtime は循環した catalog を前提にしない。

Step-level の `requiredPermissions` は Action-level と AND 条件で評価する。つまり Action 起動時に Action-level 権限を満たしたうえで、該当 step の実行直前に Step-level 権限もすべて満たしている必要がある。Step-level 権限が欠ける場合も 403 相当の outcome とし、当該 step 以降の副作用を実行しない。

## 国際化 (i18n)

`i18n` は規約カタログの第一級カテゴリとして扱い、処理フロー実行時の locale と表示フォーマットを宣言する。利用可能な locale は `i18n.supportedLocales` に列挙し、ランタイムはこの集合に含まれる locale だけをメッセージ解決とフォーマット適用の対象にする。

`@conv.i18n.locale` は現在のセッション locale を表す runtime 値である。カタログに保存される固定値ではなく、ログインユーザー設定、リクエストヘッダー、テナント設定などから実行環境が決定する。

`@conv.i18n.defaultLocale` は `i18n.defaultLocale` を参照する fallback locale である。`defaultLocale` は必ず `supportedLocales` に含める。含まれない catalog は conventions validator のエラーとする。

`@conv.msg.<key>` で `MessageTemplate` を参照する場合、ランタイムは次の順序でテンプレート文字列を解決する。

1. `MessageTemplate.locales[currentLocale]`
2. `MessageTemplate.locales[defaultLocale]`
3. `MessageTemplate.text`

現行 schema では互換性のため `MessageTemplate.template` を正本の本文フィールドとして扱う。実装時に `text` という名前で内部表現へ写像する場合も、解決順の最後は catalog 上の `template` と同じ値を指す。

フォーマットヘルパーは runtime が提供する関数参照として扱う。代表例は `@conv.i18n.format.date(value, locale?)`、`@conv.i18n.format.time(value, locale?)`、`@conv.i18n.format.currency(value, currency, locale?)`、`@conv.i18n.format.number(value, locale?)` である。

カタログの `dateFormat` / `timeFormat` / `currencyDisplay` / `numberGrouping` は locale ごとの表示規約を宣言する。実際のフォーマット処理、Intl API への変換、未定義 locale の fallback は runtime の責務であり、処理フロー JSON はこれらのヘルパーを参照するだけに留める。

`MessageTemplate.locales` は任意である。未指定の場合、既存 catalog と同じく `template` を default locale の文言として扱うため、既存の `msg` 定義は変更なしで有効である。

## 12. 適用チェックリスト (実装者向け)

処理フロー JSON から Node.js/Express 実装を起こすとき、以下を本仕様に沿って決定する:

- [ ] `sql` 内 `@x` → prepared statement `$N` 変換 (§1)
- [ ] `httpCall.body` → JSON or form-urlencoded を Content-Type で判定 (§2)
- [ ] `transactionScope.steps[]` を Knex/pg の `tx.run()` / `BEGIN`/`COMMIT` に対応 (§3)
- [ ] throw された errorCode を BranchConditionVariant.tryCatch で捕捉、Saga 補償の compensatesFor を走らせる (§3.4)
- [ ] `fireAndForget: true` なら await せず、エラーは background で outcomes.failure.sideEffects (§4)
- [ ] externalChain.phase は observability のみ (§5)
- [ ] sideEffects 内の dbAccess は autocommit (§6)
- [ ] `responses[].when` は documentation (§7)
- [ ] `httpRoute.auth` のスキーム具体化は ambient 変数 + product-scope (§8)
- [ ] ambient 前提 (TZ / 通貨 / 税率) は `data/conventions/catalog.json` の `default: true` エントリから取得 (§9.2)
- [ ] フロー固有の ambient 例外は `context.ambientOverrides` を確認し、未記載なら catalog defaults をそのまま適用 (§9.3)

## 13. 実装ガイドライン (ドッグフード由来)

シナリオ #2-#6 (PR #468-#472) のレビューで繰り返し検出された実装ミスを以下にまとめる。チェックリスト §12 の補足として読むこと。

### §13.1 内部スケジューラ起動の auth 表現

グローバル定義スキーマで `action.httpRoute.auth` の enum は `["required", "optional", "none"]` の 3 値のみ。

**内部スケジューラから呼ぶ API** (例: `marketOpen` トリガー、夜間バッチ) の auth は次のいずれかで表現する:

| 方法 | 状況 | 例 |
|---|---|---|
| `auth: "required"` + `requiredPermissions: ["system"]` | 現行 workaround。内部スケジューラが system パーミッションを持つとして扱う | `"auth": "required", "requiredPermissions": ["system"]` |
| `auth: "none"` | 完全に内部のみ・外部からアクセス不可と明示できる場合 | `"auth": "none"` |

将来的に schema に `auth: "system"` 値を追加することを検討しているが (#474 とは別 ISSUE で起票)、現状は上記 workaround を使う。シナリオ #5 (#465) での実例を参照。

### §13.2 ON CONFLICT DO NOTHING 時の outputBinding 振る舞い

`INSERT ... ON CONFLICT DO NOTHING RETURNING ...` で衝突時 (no-op) の `outputBinding` 変数は **null か空オブジェクト** になる。

**後続参照は null 安全表現を必須とする**:

```json
// 危険: ON CONFLICT DO NOTHING で衝突した場合 null deref
{ "kind": "compute", "expression": "@submissionRecord.submittedCount" }

// 安全: null 安全アクセスまたは null 合体演算子を使う
{ "kind": "compute", "expression": "@submissionRecord?.submittedCount ?? @reportableTrades.length" }
```

シナリオ #5 での対策例: `@submissionRecord?.submittedCount ?? @reportableTrades.length` の形で null 安全表現を適用して解決。

### §13.3 loop 0 件時の accumulate 初期化

`outputBinding: { name: "total", operation: "accumulate", initialValue: 0 }` で loop が 0 件の場合、`@total` の値は**実装依存**になる。

**安全な書き方**: loop の前に明示的初期化 step を置く。

```json
{ "id": "init-total", "kind": "compute", "expression": "0", "outputBinding": { "name": "total" } },
{ "id": "the-loop", "kind": "loop", "items": "@list", "steps": [
  { "id": "accumulate", "kind": "compute",
    "expression": "@total + @item.amount", "outputBinding": { "name": "total" } }
]}
```

- `initialValue` を指定していても「loop 入口での初期化タイミング」は実装依存
- loop 前の明示的 `compute` step で初期化することで、0 件パスでも `@total` が確実に定義済みになる
- **検出パターン**: `/review-flow` 観点 1 (変数ライフサイクル) で「loop accumulate の 0 件パス」を確認 (シナリオ #4 で実例)

## 関連

- スキーマ: `schemas/v3/process-flow.v3.schema.json` — v3 全体定義
- `docs/spec/process-flow-extensions.md` — 構造化フィールド定義
- `docs/spec/process-flow-expression-language.md` — 式言語 BNF
- `docs/spec/process-flow-variables.md` — 変数・outputBinding
- `docs/spec/process-flow-maturity.md` — 成熟度・モード
- `examples/<project-id>/actions/` または `examples/<project-id>/process-flows/` — v3 形式の実サンプル (canonical 置き場: `examples/retail/`, `examples/realestate/`)
