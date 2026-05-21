# Schema 設計原則 — Harnize Harmony ProcessFlow / Conventions / Extensions

| 項目 | 値 |
|---|---|
| 関連 ISSUE | #517 (本ドキュメント) / 親 #511 (schema ガバナンス) |
| 起草 | 設計者 (Opus) — Codex (GPT-5.5) セカンドオピニオンを参照材料として使用 (#517 で議論、proposal md は廃止済) |
| 起草日 | 2026-04-27 |
| 対象 schema | `schemas/process-flow.schema.json` (2036 行) / `schemas/conventions.schema.json` (291 行) / `schemas/extensions-*.schema.json` (5 ファイル) |
| ステータス | **初版** — `schema-current-state-2026-04-27` を兼ねる (調査結果と規範を併記) |

本ドキュメントは、本フレームワークの **JSON Schema 設計原則** を集約する。schema を **どう書くか** の規範であり、**何を書くか** (個別フィールド仕様) は各 `process-flow-*.md` を参照。

`schema-governance.md` (#511) が「**誰が変えてよいか**」を規定するのに対し、本ドキュメントは「**設計者が schema を変えるとき / 業務開発者が拡張・規約を書くとき、どういう原則で書くか**」を規定する。

---

## 1. 設計思想の前提

### 1.1 JSON Schema が一次成果物

本プロジェクトの**主用途は AI が ProcessFlow JSON を読んで実装すること**。したがって設計層の優先順位は固定:

| 順位 | 層 | 役割 |
|---|---|---|
| **1 (一次)** | JSON Schema (`schemas/*.json`) | 機械可読な正規仕様。外部 AI / CI / 外部エディタからも参照可能 |
| 2 (派生) | TypeScript 型 (`frontend/src/types/action.ts`) | designer 内部で利用される派生物 |
| 3 (表示層) | UI (`frontend/src/components/process-flow/`) | エディタとしての視覚化 |

根拠: `schemas/README.md:5-13` / `AGENTS.md:147-156`

**帰結**: 矛盾が起きたら schema を正、TS 型と UI を schema に合わせる。schema 変更は #511 ガバナンスで設計者専権。

### 1.2 JSON Schema draft 2020-12 を採用

全 schema が draft 2020-12 (`$schema: "https://json-schema.org/draft/2020-12/schema"`)。根拠:

- `schemas/process-flow.schema.json:2`
- `schemas/conventions.schema.json:2`
- `schemas/extensions-steps.schema.json:2` (同様に 5 ファイル全部)
- `schemas/README.md:27`

draft 2020-12 で利用可能な以下を**積極的に活用**してよい:

- `$defs` (旧 `definitions` ではなく)
- `unevaluatedProperties` (allOf 合成時の未評価プロパティ拒否、§3.4 参照)
- `prefixItems` (タプル型) — 現状未使用
- `dependentRequired` / `dependentSchemas` — 現状未使用、`if/then` で代用

`additionalProperties` は draft 7 から使えるが、`unevaluatedProperties` は draft 2019-09 以降のため**移行余地が大きい** (§3.4)。

### 1.3 後方互換性は絶対

102 コミット監査 (`docs/spec/schema-audit-2026-04-27.md:138-145`) で破壊的変更ゼロが確認されている。本原則は維持:

- フィールド追加は **必ず optional** で行う
- enum 値追加は **additive のみ** (削除・置換不可)
- 旧形式 → 新形式の移行は **union 型** で path を残す (例: `ActionFields = string | StructuredField[]` at `schemas/process-flow.schema.json:835-843`)
- 既存 sample / 業務データを破壊する変更は禁止

migration 戦略: `migrateProcessFlow` (frontend/src/utils/actionMigration.ts) が読み込み時に旧形式を新形式に正規化する。schema 側では旧形式も valid を維持。

### 1.4 ガバナンス (#511) の遵守

| 領域 | 変更権限 |
|---|---|
| グローバル schema (`schemas/*.json`) | **フレームワーク製作者 (設計者) の専権** |
| 拡張定義 (`docs/sample-project/extensions/<ns>/`、`data/extensions/<ns>/`) | 業務開発者 (AI 含む) |
| 業務規約 catalog (`conventions/conventions-catalog.json`) | 業務開発者 |
| 業務データ JSON (`process-flows/*.json` 等) | 業務開発者 |

詳細: `docs/spec/schema-governance.md`

本ドキュメントが対象とするのは**設計者がグローバル schema を書くときの原則**。業務開発者向けの執筆規約は §6 (拡張判断ガイドライン) で扱う。

### 1.5 Convention over configuration

schema で表現できないが業務上重要な規約は、**spec 文書 (`docs/spec/process-flow-*.md`) で convention として明文化**する。schema には載せない。

代表例 (`docs/spec/process-flow-runtime-conventions.md` 全章):
- SQL 内 `@expression` の prepared statement 変換規約 (§1)
- HTTP body の form-urlencoded vs JSON 自動判定 (§2)
- TX × throw × tryCatch の連鎖規約 (§3)
- `fireAndForget: true` の意味論 (§4)
- `compensatesFor` の配置規約 (§10)
- Ambient context 解決順序 (§9.4)

判断基準: schema で表現できるもの (型・必須・enum・参照整合) は schema に。**実行時の動作・解決順序・テンプレート展開**は spec で convention として規定する。

`docs/spec/process-flow-expression-language.md:13-20` も同様の判断 (`expression: { lang, src }` ラッパー化を YAGNI で不採用、convention で 1 言語固定)。

---

## 2. 命名規約

JSON Schema 上の識別子は **5 種類のレベル** を持つ。それぞれ命名規約が異なる。

### 2.1 ProcessFlow root プロパティ (camelCase 主体)

`schemas/process-flow.schema.json:9-95` で root に並ぶ 28 プロパティの実態:

| 種別 | 命名 | 例 |
|---|---|---|
| 識別子 (1 語) | `lowercase` | `id`, `name`, `type`, `description`, `screenId`, `apiVersion` |
| 運用設定 | `lowerCamelCase` | `maturity`, `mode`, `createdAt`, `updatedAt` |
| Catalog 系 (Record/object) | **`xxxCatalog`** 接尾辞 | `errorCatalog`, `externalSystemCatalog`, `secretsCatalog`, `envVarsCatalog`, `domainsCatalog`, `functionsCatalog`, `eventsCatalog` |
| 配列系 | **複数形** | `actions`, `markers`, `decisions`, `testScenarios`, `ambientVariables` |
| 単数 noun (集合体) | 用途名 | `glossary` (用語集), `sla`, `health`, `readiness`, `resources`, `httpRoute`, `responses` |
| Override map | **`xxxOverrides`** 接尾辞 | `ambientOverrides` |

#### 規範

- **新規 catalog は `xxxCatalog` 接尾辞 + Record/object 構造**で root に並列配置する
- **新規配列は複数形** (`actions`, `markers` 等と整合)
- **新規 override map は `xxxOverrides` 接尾辞**
- 1 語の単数 noun (`sla`, `health` 等) は意味が一意な場合のみ使う。複数候補があるなら必ず suffix を付ける

#### 採用しない代替案 (検討した上で棄却)

- 「root 直下を `catalogs: { error, externalSystem, ... }` に階層化する」案: 既存 4 sample が root 並列を採用しており、移行コスト > メリット。階層化はデータ深さが 1 段増える分、JSON 編集の認知負荷が増える。Codex セカンドオピニオン (§4-A) でも短期不採用と判断
- 「すべて Catalog 接尾辞に揃える」案: `markers` / `decisions` / `glossary` / `ambientVariables` を `markersCatalog` 等に rename する破壊的変更となるため不採用

### 2.2 enum 値 (対象ドメインの慣習に従う)

enum 値の命名は**対象ドメインの慣習** に従う。schema 全体で 1 つの命名規則に統一しない (現状の混在は意図的)。

| ドメイン | 命名規則 | schema 上の例 |
|---|---|---|
| **SQL keyword** | `UPPER` | `DbOperation` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `LOCK`) at `schemas/process-flow.schema.json:1074-1077` |
| **DB TX 設定** | `UPPER_SNAKE` | `TransactionIsolationLevel` (`READ_COMMITTED`, `REPEATABLE_READ`, `SERIALIZABLE`) at `schemas/process-flow.schema.json:1949-1955`<br>`TransactionPropagation` (`REQUIRED`, `REQUIRES_NEW`, `NESTED`) at `schemas/process-flow.schema.json:1953-1956` |
| **HTTP method** | `UPPER` | `HttpMethod` (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) at `schemas/process-flow.schema.json:537-539` |
| **Step type / 値オブジェクト discriminator** | `lowerCamelCase` | `StepType` (`validation`, `dbAccess`, `externalSystem`, `transactionScope` 等) at `schemas/process-flow.schema.json:297-323` |
| **ProcessFlow type / 列挙的値** | `lowercase` 一語 | `ProcessFlowType` (`screen`, `batch`, `scheduled`, `system`, `common`, `other`) at `schemas/process-flow.schema.json:98-105` |
| **Workflow pattern** | `kebab-case` | `WorkflowPattern` (`approval-sequential`, `approval-parallel`, `branch-merge`, `sign-off`, `ad-hoc`) at `schemas/process-flow.schema.json:521-535` |
| **GeneXus 由来 (互換性のため踏襲)** | `PascalCase` | `ValidationRuleKind` (`Error`, `Msg`, `Noaccept`, `Default`) at `schemas/process-flow.schema.json:973-977` |
| **Log level (syslog 慣習)** | `lowercase` | `LogStep.level` (`trace`, `debug`, `info`, `warn`, `error`) at `schemas/process-flow.schema.json:1692-1695` |
| **OAuth/HTTP auth** | `lowerCamelCase` 1 語 | `ExternalAuthKind` (`bearer`, `basic`, `apiKey`, `oauth2`, `iamRole`, `azureAd`, `none`) at `schemas/v3/process-flow.v3.schema.json:518-527` |
| **記号操作子** | 記号 | `AffectedRowsOperator` (`>`, `>=`, `=`, `<`, `<=`) at `schemas/process-flow.schema.json:1078-1081` |

#### 規範

- 新規 enum 追加時、**まず対象ドメインに既存の慣習があるか確認** する。あればそれに従う
- ドメイン慣習が無い場合は **`lowerCamelCase`** をデフォルトに採用 (Step type / 値オブジェクト discriminator と整合)
- enum を**型として明示**する: `enum: [...]` 直下に値を並べるだけでなく、`$defs/<EnumName>` として name を付ける。理由: TypeScript 型生成時に named type として現れ、IDE 補完が改善される (§5)

#### 採用しない代替案

- 「全 enum を `lowerCamelCase` に統一する」案: SQL keyword / HTTP method を camelCase にすると業界慣習に違反、業務開発者の認知負荷が大きい。GeneXus 由来 (`Error`/`Msg` 等) を rename すると互換性破壊
- 「すべて kebab-case に統一」: SQL / HTTP がさらに違和感

### 2.3 Catalog key (ドメイン慣習)

`Record<string, T>` 形の catalog の **キー命名** はカタログ種別ごとに異なる。

| Catalog | キー命名 | 例 (sample / spec) |
|---|---|---|
| `errorCatalog` | `UPPER_SNAKE` (errorCode 慣習) | `STOCK_SHORTAGE`, `INSUFFICIENT_INVENTORY`, `VALIDATION`, `CART_EMPTY` (`docs/sample-project/process-flows/gggggggg-0003-*.json:170-204`) |
| `externalSystemCatalog` | `lowercase` 1 語 (system 識別子) | `stripe`, `sendgrid` (`docs/spec/process-flow-extensions.md:240-252`) |
| `secretsCatalog` | `lowerCamelCase` (変数名相当) | `stripeApiKey`, `thirdPartyKey` (`docs/spec/process-flow-secrets.md:38-52`) |
| `envVarsCatalog` | `UPPER_SNAKE` (環境変数 OS 慣習) | `STRIPE_API_BASE`, `MAX_RETRY_ATTEMPTS`, `FEATURE_FLAG_NEW_PRICING` (`docs/spec/process-flow-env-vars.md:26-49`) |
| `domainsCatalog` | `PascalCase` (型らしい) | `OrderId`, `CustomerId`, `Amount`, `EmailAddress`, `Quantity` (`docs/sample-project/process-flows/gggggggg-0003-*.json:209-232` / `docs/spec/process-flow-extensions.md:710-718`) |
| `functionsCatalog` | `lowerCamelCase` (JS 関数慣習) | `generateUUID`, `calcTax`, `calcSubtotal`, `formatCurrency` (`docs/sample-project/process-flows/gggggggg-0003-*.json:234-258`) |
| `eventsCatalog` | `dot.separated.lowercase` (メッセージング topic 慣習) | `order.confirmed`, `order.confirm_failed`, `invoice.issued`, `retail.order_tax_calculated` (`docs/sample-project/process-flows/gggggggg-0003-*.json:11-73`) |
| `glossary` | 自然言語 (日本語可) | `注文確定`, `在庫引当`, `消費税計算` (`docs/sample-project/process-flows/gggggggg-0003-*.json:76-115`) |
| `decisions` | `ADR-NNN` (id 規約) | `ADR-001`, `ADR-002` (`docs/spec/process-flow-extensions.md:1027-1038`) |
| `conventions/msg` | `lowerCamelCase` | `required`, `maxLength`, `invalidFormat`, `mustBePositive`, `cartExpired` (`docs/sample-project/conventions/conventions-catalog.json:15-46`) |
| `conventions/regex` | `kebab-case` | `email-simple`, `phone-jp`, `postal-jp`, `product-code` (`docs/sample-project/conventions/conventions-catalog.json:49-73`) |
| `conventions/limit` | `lowerCamelCase` | `nameMax`, `quantityMax`, `cartItemMax`, `lowStockThreshold` (`docs/sample-project/conventions/conventions-catalog.json:76-87`) |
| `conventions/numbering` | `lowerCamelCase` | `customerCode`, `orderNumber`, `cartCode`, `shipmentId` (`docs/sample-project/conventions/conventions-catalog.json:184-204`) |
| `conventions/role` | `lowerCamelCase` | `customer`, `operationsSystem` (`docs/sample-project/conventions/conventions-catalog.json:160-170`) |
| `conventions/permission` | `dot.separated.lowercase` | `order.create`, `order.read`, `inventory.read`, `shipment.create` (`docs/sample-project/conventions/conventions-catalog.json:133-156`) |

#### 規範

- 新規 catalog のキー命名は**参照側 (式言語 / spec) の慣習に合わせる**
  - `@conv.<key>` で参照されるなら, `@conv.<key>` 自体の慣習に合わせる (例: `@conv.regex.phone-jp` なら kebab-case)
  - HTTP / OS 慣習なら `UPPER_SNAKE`
  - JS 識別子として参照されるなら camelCase
- キー命名は **schema 上で `pattern` を強制しない** (現状すべて `additionalProperties` で受け入れ)。convention として spec で規定し、参照整合性バリデータ (`frontend/src/schemas/conventionsValidator.ts`) で警告を出す
- 例外: 拡張 namespace は `pattern: "^[a-z0-9_-]*$"` で強制している (`schemas/extensions-steps.schema.json:9-12`)

#### 採用しない代替案

- 「全 catalog key を camelCase に統一する」案: HTTP env 変数 / errorCode の業界慣習に違反、参照式 (`@env.STRIPE_API_BASE`) でも違和感
- 「catalog key に `pattern` を必ず付ける」案: 命名違反の早期検出には有効だが、`@conv.role.<key>` のように **JS 識別子的なキー** と `event.<key>` のように **dot 区切り** が混在する事情を schema 単体では表現しにくい。convention + 参照整合性バリデータの 2 段で十分

### 2.4 ID 形式 (kebab-case + 数字 / 階層化)

`schemas/process-flow.schema.json` 上の各 `id: { "type": "string" }` には schema 上の制約 (pattern) はないが、**実態 (sample 全 4 件)** は以下の規範に従う:

| 対象 | 形式 | 例 |
|---|---|---|
| ProcessFlow.id | UUID v4 風 (16 文字 group + ハイフン) | `gggggggg-0003-4000-8000-gggggggggggg` |
| ActionDefinition.id | `act-NNN` または `act-<slug>-NNN` | `act-001`, `act-orderreg-002`, `act-orderreg-003` |
| Step.id | `step-NN` または `step-NN-NN`/`step-NNa-NN-NN` (階層) | `step-01`, `step-13-01`, `step-13b`, `step-13b-a-01` |
| Branch.id | `br-NN-<code>` | `br-03-a`, `br-03-b`, `br-13b-else` |
| ElseBranch.id | `br-NN-else` | `br-03-else`, `br-05-else` |
| Branch.code | 1 文字大文字 (`A` / `B` / `C` ...) | `A`, `B`, `C` |
| StepNote.id | `note-<UUID>` | (任意 stable ID) |
| Marker.id | UUID v4 | (任意 stable ID) |
| TestScenario.id | `kebab-case` 説明的 | `happy-path-order-confirm`, `insufficient-inventory-rollback` |
| ResponseSpec.id | `<status>-<slug>` | `201-created`, `400-validation`, `422-cart-empty` |
| DecisionRecord.id | `ADR-NNN` | `ADR-001` |

#### 規範

- ID は **kebab-case + 階層化 (ハイフン区切り)** が基本
- ProcessFlow.id のみ UUID v4 風 (外部システムから一意に参照されるため)
- 数字部分は ゼロパディング (`001`, `02`) を推奨 (ソート時の自然順を維持)
- Step ID の階層 (`step-13-01` / `step-13b-a-01`) は parent step の ID に suffix を付ける形を推奨
- schema 上は `type: "string"` のままで、**pattern は強制しない** (実装制約・参照整合性バリデータで担保)

#### 採用しない代替案

- 「全 ID を UUID に統一」: 人間可読性が失われ、レビュー時の認知負荷が大きい
- 「step-id に pattern 制約を付ける」: 既存 sample が壊れる可能性、運用 convention で十分

### 2.5 Discriminator フィールド名 (`type` vs `kind`)

union 型の variant を識別する **discriminator フィールド** は 2 つの命名が共存する:

| discriminator | 用途 | schema 上の例 |
|---|---|---|
| `type` | **Step union** の variant (1 種のみ) | `Step.oneOf` の各 variant が `type: { const: "validation" }` 等 (`schemas/process-flow.schema.json:1058`, 2008-2033) |
| `kind` | **値オブジェクト・前提条件・条件式・型** の variant | `FieldType` (`kind: array/object/tableRow/...` at `schemas/process-flow.schema.json:732-797`)<br>`TestPrecondition` (`kind: dbState/sessionContext/externalStub/clock` at `schemas/process-flow.schema.json:159-208`)<br>`TestAssertion` (`kind: outcome/dbRow/output/externalCall/auditLog/errorMessage` at `schemas/process-flow.schema.json:222-291`)<br>`BranchConditionVariant` (`kind: tryCatch/affectedRowsZero/externalOutcome` at `schemas/process-flow.schema.json:1449-1487`) |

#### 規範

- **Step は `type`**, それ以外の値オブジェクト discriminator は **`kind`**
- 理由:
  - `type` は HTTP / API / コードでの慣習 (Step は実行可能エンティティであり、`type: "validation"` は OpenAPI/Arazzo で見慣れた表現)
  - `kind` は値クラス discriminator として一般的 (Rust enum kind / GraphQL `__typename` / TypeScript discriminated union での慣習)
- 新規 union 型を追加するときは: **実行可能エンティティなら `type`、データ・条件・前提なら `kind`** で命名する

#### 採用しない代替案

- 「全部 `type` に統一」: `kind` は値クラス的な含意があり、`type: "tryCatch"` だと「BranchCondition の type」と「Step の type」が文脈で混乱する
- 「全部 `kind` に統一」: Step を `kind: "validation"` に変えると 4 sample すべてが破壊的変更

---

## 3. 構造ルール

### 3.1 `additionalProperties: false` を基本とする

`schemas/process-flow.schema.json` 全体で **167 箇所中 121 箇所 (72.5%) が `additionalProperties: false`** (Codex セカンドオピニオン §1 集計)。

| 採用領域 | 例 |
|---|---|
| ProcessFlow root | `schemas/process-flow.schema.json:8-9` |
| ActionDefinition | `:849` |
| Step variants (全 22) | `:1052`, `:1103`, `:1309`, etc. |
| Catalog entry ($defs) | `ErrorCatalogEntry:634-642`, `ExternalSystemCatalogEntry:1276-1301`, `EnvVarEntry:611-631`, `SecretRef:592-608` |
| value object | `Sla:113`, `HttpRoute:549`, `WorkflowApprover:1742` |

#### 規範

- 新規 object 型は **デフォルトで `additionalProperties: false`** を付ける
- 例外 (open/`true` で残す): JSON Schema payload (validation 対象が任意 JSON) / response schema / structuredData / argumentMapping value
  - `schemas/process-flow.schema.json:218-219` (TestInvocation.input)
  - `:369-372` (EventDef.payload)
  - `:1296-1300` (ExternalSystemCatalogEntry.responseSchema)
- 「テスト時の任意 JSON」「外部 API 仕様の動的形」など、本質的に閉じられない領域のみ open にする

#### 採用しない代替案

- 「`additionalProperties: true` を default」案: 誤字検出機構が機能しなくなる
- 「`additionalProperties: false` を厳格にすべて」案: 本質的に open な領域が表現できなくなる

### 3.2 oneOf による discriminated union

`schemas/process-flow.schema.json` 全体で **15 箇所の oneOf / 計 83 variant** (Codex 集計、§1)。

| union | variant 数 | discriminator |
|---|---|---|
| `Step` (`:2008-2033`) | 22 | `type` |
| `NonReturnStep` (`:1186-1210`) | 21 | `type` (Return 除外) |
| `FieldType` (`:724-799`) | 8 | string enum + `kind` |
| `TestAssertion` (`:222-291`) | 6 | `kind` |
| `TestPrecondition` (`:159-208`) | 4 | `kind` |
| `BranchConditionVariant` (`:1449-1487`) | 3 | `kind` |
| `BodySchemaRef` (`:688-709`) | 3 | structural (string / `typeRef` / `schema`) |
| `OutputBinding` (`:908-913`) | 2 | string / object |
| `ActionFields` (`:835-843`) | 2 | string / array |
| `Criterion` (`:1178-1184`) | 2 | string / structured |
| `BranchCondition` (`:1488-1493`) | 2 | string / structured |
| `ValidationInlineBranch.ok` / `.ng` (`:1018-1029`) | 2 | string / Step[] |

#### 規範

- variant が **複数の `const` / `kind` で識別できる場合は oneOf** を使う (anyOf でなく)
- variant が**構造的に区別できる場合** (片方が string、片方が object 等) も oneOf を使う
- variant の各 schema には `description` を付ける (variant の意味を AI / IDE が読み取れるように)

### 3.3 allOf による base 合成

`schemas/process-flow.schema.json` 全体で **23 箇所の allOf** (Codex 集計、§1)。主用途は **StepBaseProps を全 step variant にマージ** すること:

```jsonc
// 例: ValidationStep (schemas/process-flow.schema.json:1046-1071)
{
  "ValidationStep": {
    "allOf": [
      { "$ref": "#/$defs/StepBaseProps" },
      {
        "type": "object",
        "required": ["id", "type", "description", "conditions"],
        "additionalProperties": false,
        "properties": {
          "id": true, "description": true, "note": true, "notes": true,
          "maturity": true, "runIf": true, "outputBinding": true,
          "compensatesFor": true,
          "externalChain": true, "subSteps": true, "requiredPermissions": true, "sla": true,
          "type": { "const": "validation" },
          "conditions": { "type": "string" },
          // ... validation 固有
        }
      }
    ]
  }
}
```

このパターンは:
- `StepBaseProps` (`:939-967`) で全 step 共通の properties (`id`, `description`, `note`, `notes`, `maturity`, `sla`, `runIf`, `requiredPermissions`, `outputBinding`, `compensatesFor`, `externalChain`, `subSteps`) を宣言 (txBoundary / transactional は #1221 で廃止)
- 各 variant が `additionalProperties: false` を付けて閉じるため、共通 prop も `properties` に **`true` で再列挙** が必要
- これは **ドリフトの温床**: variant ごとに 14 行の同じリストをコピーする必要があり、漏れると schema バグになる (§3.4 で詳述)

#### 規範

- base + variant 合成は `allOf` で表現する (anyOf ではない、両方を満たす必要があるため)
- base の `$ref` を最初に置き、variant 固有を後ろに配置
- 各 variant で `description` (変動部の意味) を付ける

### 3.4 `unevaluatedProperties: false` への移行 (推奨改善)

#### 問題: 現状の二重列挙とドリフト

§3.3 の allOf + `additionalProperties: false` 構造では、各 variant が StepBaseProps の 14 props を `true` で再列挙する必要がある。実際にドリフトが発生している:

| variant | 抜けている共通 prop |
|---|---|
| `WorkflowStep` (`schemas/process-flow.schema.json:1789-1797`) | **`sla` 抜け** (StepBaseProps では許可) |
| `TransactionScopeStep` (`:1963-1970`) | **`sla` 抜け** (同上) |

両者とも `additionalProperties: false` のため、現状の schema では **WorkflowStep / TransactionScopeStep に `sla` を書くと validation error**。これは schema バグ。

#### 解決策: `unevaluatedProperties: false`

draft 2020-12 の `unevaluatedProperties: false` を使うと、`allOf` の**いずれかの schema** で評価されたプロパティは許可、それ以外は拒否される。

```jsonc
// 提案: 改善後の ValidationStep
{
  "ValidationStep": {
    "allOf": [
      { "$ref": "#/$defs/StepBaseProps" },
      {
        "type": "object",
        "required": ["id", "type", "description", "conditions"],
        "properties": {
          // variant 固有のみ列挙
          "type": { "const": "validation" },
          "conditions": { "type": "string" },
          "rules": { /* ... */ },
          "fieldErrorsVar": { "type": "string" },
          "inlineBranch": { "$ref": "#/$defs/ValidationInlineBranch" }
        }
      }
    ],
    "unevaluatedProperties": false
  }
}
```

これにより:
- StepBaseProps の `sla` / `runIf` / 他 12 props は base 側で評価される
- variant 側は variant 固有 props のみ列挙
- 許可されない prop が現れたら拒否される (誤字検出機能は維持)
- variant ごとの 14 行重複が消え、ドリフトが構造的に発生しない

#### 規範 (本ドキュメント承認後)

- 新規 step variant / 新規 allOf 合成型は `unevaluatedProperties: false` で書く
- 既存 22 step variant は **別 PR で漸進的に移行** (本ドキュメントで原則を確定し、実装は #517 マージ後の専用 ISSUE)

#### 採用しない代替案

- 「現状維持」: WorkflowStep / TransactionScopeStep の sla 抜けバグが現存し、設計者が手動でリストを揃える必要が残る
- 「`additionalProperties: false` を variant から外す」: 誤字検出機能を失う (`schemas/process-flow.schema.json:1052` 等の閉じ込めが意図的)

### 3.5 if/then による条件付き必須

`schemas/process-flow.schema.json` 全体で **6 箇所の if-then** (Codex 集計、§1)。すべて「あるフィールドの値に応じて別フィールドを必須化する」用途:

| 場所 | 条件 | 結果 |
|---|---|---|
| `Sla` (`:125-129`) | `onTimeout` が `throw` または `compensate` | `errorCode` 必須 |
| `WorkflowQuorum` (`:1762-1768`) | `type: "n-of-m"` | `n` 必須 |
| `WorkflowStep` (`:1827-1846`) | `pattern: "approval-escalation"` | `escalateAfter`, `escalateTo` 必須 |
| 同 | `pattern: "approval-quorum"` | `quorum` 必須 |
| 同 | `pattern: "ad-hoc"` | `description` 必須 |

#### 規範

- 条件付き必須は **if/then で構造化**する。spec 文書に「○○のとき △△ も書く」と書くだけで終わらせない (検証されないため)
- if/then は allOf 内に並べることで複数条件を表現可能 (`WorkflowStep:1825-1847` の例)
- 条件が複雑になる場合 (3 段以上のネスト等) は spec 側で convention として規定し、実装側 validator で補完する選択肢もある

### 3.6 `$ref` による DRY 化

全 schema で **123 個の $defs** (Codex 集計)。`$ref: "#/$defs/<Name>"` で参照する。

#### 規範

- **2 箇所以上で同じ structure が現れる場合は `$defs` に切り出す**
- `$defs` の name は **PascalCase** (`Sla`, `OutputBinding`, `StepBaseProps`)
- `$defs` 内では `description` を付ける (TypeScript 型生成時の JSDoc 元になる)

`$ref` を使うと、JSON Schema → TypeScript 型生成 (json-schema-to-typescript / quicktype) で **named type** として現れ、IDE 補完が向上する (§5 参照)。

### 3.7 `deprecated: true` annotation

draft 2019-09 から `deprecated: true` がアノテーションとして使えるようになった。本 schema でも採用済み:

| 場所 | 内容 |
|---|---|
| `FieldType.custom` (`schemas/process-flow.schema.json:787-797`) | `kind: "custom"` の label 文字列に型情報を自由記述するパターンを deprecated。新規データは array/object/primitive を優先 |
| `ExternalSystemStep.protocol` (`:1321-1325`) | `httpCall` への移行推奨 |

#### 規範

- 廃止予定の field / variant には **`deprecated: true` を付与し、`description` で代替を案内**する
- 既存 sample / 業務データに影響するため、**deprecated 後すぐに削除しない** (互換 path を残す)
- 削除する場合は別 PR + ISSUE で明示的にユーザー (設計者) 承認を得る

---

## 4. フォーマット規約

### 4.1 ID 形式

§2.4 を参照。schema 上は `type: "string"` で pattern 強制せず、convention で形式を規定。

### 4.2 タイムスタンプ (`format: "date-time"`)

`schemas/process-flow.schema.json` 全体で **`format: "date-time"` 9 箇所** (`:93`, `:94`, `:204` 他)。すべて ISO 8601 形式 (RFC 3339):

```
2026-04-26T00:00:00.000Z
```

#### 規範

- タイムスタンプは **ISO 8601 / RFC 3339 / `Z` (UTC)** で保存する
- schema 上は `format: "date-time"` を必ず付ける (Ajv ajv-formats で実行時検証可)
- ローカル時刻 / `+09:00` 形式は **使用しない** (タイムゾーン解釈の差異を避ける)

### 4.3 参照式 (式言語) の規範

`docs/spec/process-flow-expression-language.md` で BNF 定義済み (`js-subset`)。schema 上は `string` のままで、convention として:

| 接頭辞 | 参照先 | 例 |
|---|---|---|
| `@<identifier>` | 変数 (inputs / outputBinding / ループ変数 / ambientVariables) | `@cart`, `@inventoryUpdate` |
| `@inputs.<field>` | action inputs 全体参照 (推奨) | `@inputs.cartId`, `@inputs.customerId` |
| `@<var>.<path>` / `@<var>?.<path>` | ネストアクセス / Optional chain | `@persistedOrder.id`, `@paymentAuth?.id` |
| `@conv.<category>.<key>` | conventions catalog 参照 | `@conv.tax.standard.rate`, `@conv.regex.phone-jp`, `@conv.limit.quantityMax`, `@conv.msg.required` |
| `@secret.<key>` | secretsCatalog 参照 | `@secret.stripeApiKey` |
| `@env.<KEY>` | envVarsCatalog 参照 | `@env.STRIPE_API_BASE`, `@env.MAX_RETRY_ATTEMPTS` |
| `@fn.<name>(<args>)` | functionsCatalog 関数呼出 | `@fn.calcTax(@subtotal, @conv.tax.standard.rate)`, `@fn.generateUUID()` |
| `$statusCode` / `$response.body` / `$response.body#/path` | Arazzo Runtime Expression (Criterion 内のみ) | `$statusCode == 200` |

#### 規範

- **基本は `@` 記法 (一括統一)**
- `$` 記法は **Criterion (`ExternalSystemStep.successCriteria`) 内のみ** (Arazzo 1.0 互換性のため)
- 旧 `@statusCode` / `@responseBody` も Criterion 内では後方互換で valid (`docs/spec/process-flow-criterion.md:21-23`)
- schema 上は string で受け、参照整合性バリデータ (`frontend/src/schemas/identifierScope.ts` / `conventionsValidator.ts` / `referentialIntegrity.ts`) で警告を出す

#### 採用しない代替案

- 「全部 `$` 記法に統一」: 既存 4 sample 全件に影響 (破壊的変更)、@ 記法は spec 全体で確立
- 「`expression: { lang, src }` ラッパー化」: `docs/spec/process-flow-expression-language.md:13-20` で既に YAGNI 棄却済

### 4.4 SQL 内式補間

`DbAccessStep.sql` (`schemas/process-flow.schema.json:1114`) は文字列。式補間規約は `docs/spec/process-flow-runtime-conventions.md §1`:

- `@expression` は prepared statement の `$N` に変換 (PostgreSQL) / `?` に変換 (MySQL)
- SQL keyword (`CURRENT_TIMESTAMP`, `NULL` 等) と列名は SQL 字句としてそのまま
- `IN (@ids)` 等の配列展開は要素数に応じて `$N, $N+1, ...` を展開

schema 上は強制されないが、SQL 検証バリデータ (`frontend/src/schemas/sqlColumnValidator.ts`) でカラム整合をチェック。

### 4.5 環境別 override の参照式スキーム

`secretsCatalog[key].values` および `envVarsCatalog[key].values` の値文字列は以下のスキームで書く (`docs/spec/process-flow-secrets.md §3`):

| スキーム | 形式 | 用途 |
|---|---|---|
| `vault://` | `vault://<path>` | HashiCorp Vault / AWS/GCP Secret Manager |
| `env://` | `env://<ENV_NAME>` | 環境変数 |
| `k8s-secret://` | `k8s-secret://<secret>[/<key>]` | Kubernetes Secret |
| `file://` | `file://<path>` | ローカルファイル (開発時のみ) |

schema 上は `additionalProperties: { "type": "string" }` で受け、convention でスキーム規約を規定。

---

## 5. 設計画面でのコード補完設計

ProcessFlow / Conventions / Extensions の各 JSON ファイルを編集するとき、IDE (VS Code 等) で IntelliSense を効かせるための設計原則。

### 5.1 ProcessFlow root に `$schema` を許可する (推奨改善)

#### 現状の問題

- `schemas/conventions.schema.json:10-13` は root に `$schema?: string` を**許可** している (実例: `docs/sample-project/conventions/conventions-catalog.json:2`)
- `schemas/process-flow.schema.json:7-9` の root は **`$schema` を properties に持たず**、`additionalProperties: false` のため、ProcessFlow JSON に `$schema` ヘッダを書くと **validation error**
- 結果として、ProcessFlow JSON 編集時に **VS Code の自動 schema association が効かない** (IDE 補完が機能しない)

#### 提案 (additive 改善)

ProcessFlow root に optional `$schema` を許可:

```jsonc
// 提案 (本ドキュメント承認後の別 PR で実装)
{
  "type": "object",
  "required": ["id", "name", ...],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },  // ← 追加
    "id": { "type": "string" },
    // ... 既存
  }
}
```

`docs/sample-project/process-flows/*.json` にも以下を追加できる:

```json
{
  "$schema": "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/process-flow.schema.json",
  "id": "...",
  ...
}
```

これにより VS Code が自動で schema を解決し、ProcessFlow JSON 全体に IntelliSense が効く。

#### 互換性

- 既存 sample / 業務データは `$schema` を持たないので影響なし
- 新規データから optional で追加可能
- additive で後方互換維持

#### 規範

- 全 schema の root は `$schema?: string` を **許可する** (本ドキュメント承認後)
- 既存 conventions schema は既に許可済み、ProcessFlow schema を同じパターンに揃える

### 5.2 enum と const を named type 化する

JSON Schema → TypeScript 型生成 (json-schema-to-typescript / quicktype) は **`$defs` の名前付き型を named TypeScript type として出力**する。inline の anonymous enum は anonymous union 型になり、IDE 補完精度が落ちる。

#### 規範

- enum 値は `$defs/<EnumName>` として name を付ける (例: `StepType`, `WorkflowPattern`, `DbOperation`)
- variant の `type: { const: "..." }` は inline で OK (variant の文脈が明確)
- TypeScript 型は schema から生成可能な状態を維持する

### 5.3 `additionalProperties: false` で誤字検出

§3.1 で確立した規範。誤字を実行時に検出するため。

### 5.4 `description` を全 prop に付ける

`description` は JSON Schema annotation として:
- IDE のホバー hover ドキュメントとして表示される
- TypeScript 型生成時に JSDoc コメントとして出力される
- AI 実装者が prop の意図を読み取る正規情報源

#### 規範

- 新規 prop / 新規 $defs / 新規 enum 値には**必ず `description` を付ける**
- description は **「何のためにあるか」** を書く。型情報の繰り返し (`integer 値`) は不要、**意図と単位**を書く (`タイムアウトまでのミリ秒`)
- 既存 prop に description が無い箇所は別 PR で漸進的に追加

例: `Sla.timeoutMs` (`schemas/process-flow.schema.json:115`) は description 無し → 追加対象。`Sla.warningThresholdMs` (`:118`) も同様。

### 5.5 各設計画面でのコード補完経路

| 画面 | 補完元 | 補完経路 |
|---|---|---|
| ProcessFlowEditor | StepType / WorkflowPattern / DbOperation / FieldType.kind 等の enum + ScreenItem.id (screenItemRef 用) | schema enum + extensions 合成 schema (§6) |
| Designer (画面) | ScreenItem.id / type 候補 | `screens/<id>.json#items[]` (Phase 4-β migration 後は screen entity に embed、#712) + conventions catalog |
| TableEditor / ER 図 | tableId / tableName / カラム型 | tables JSON |
| Extensions panel | namespace / steps / fieldTypes / triggers / dbOperations | extensions/*.schema.json + DynamicFormSchema |
| 拡張 step 編集 | DynamicFormSchema (各拡張定義) | extensions/<ns>/steps.json の `schema` フィールド (`schemas/extensions-steps.schema.json:30-57` の subset) |

### 5.6 動的フォーム生成のスコープ制限

`docs/spec/plugin-system.md:265-281` で確立済みの **DynamicFormSchema 対応キーワード**:

| キーワード | 対応 |
|---|---|
| `type: "string"` / `"number"` / `"integer"` / `"boolean"` | ✅ |
| `enum` | ✅ |
| `type: "object"` + `properties` | ✅ (再帰) |
| `type: "array"` + `items` | ✅ (再帰) |
| `required`, `description`, `default`, `additionalProperties` | ✅ |
| `oneOf` / `anyOf` / `allOf` / `$ref` / `if-then-else` / `dependencies` / `patternProperties` / `format` | ❌ 非対応 |

#### 規範

- 拡張 step の schema 定義者は対応キーワードのみ使う
- 非対応キーワードは `extensions-steps.schema.json` の段階で reject
- core schema 側 (本ドキュメントが対象) はフル JSON Schema 機能を使ってよい (動的フォーム生成の対象ではないため)

---

## 6. 拡張判断ガイドライン (フローチャート + version metadata)

### 6.1 グローバル schema vs 拡張定義 vs 業務 catalog の判断フロー

業務開発者 (AI 含む) が新しい概念を表現したいとき、以下の順で判断する:

```
新しい概念を表現したい
  │
  ├─ Q1: 既存 schema フィールドで表現できる?
  │   YES → 既存 schema を使う (例: type: "other" + outputSchema + description)
  │   NO  ↓
  │
  ├─ Q2: 業務規約 catalog (msg / regex / limit / role / numbering 等) で表現できる?
  │   YES → conventions-catalog.json に追加 (BU 開発者権限)
  │   NO  ↓
  │
  ├─ Q3: 拡張機構 (namespace) で表現できる?
  │   ├─ 新しい step type     → extensions/<ns>/steps.json
  │   ├─ 新しい field type    → extensions/<ns>/field-types.json
  │   ├─ 新しい trigger       → extensions/<ns>/triggers.json
  │   ├─ 新しい db operation  → extensions/<ns>/db-operations.json
  │   ├─ 新しい response type → extensions/<ns>/response-types.json
  │   YES → 拡張定義に追加 (BU 開発者権限)
  │   NO  ↓
  │
  └─ Q4: グローバル schema 変更が本当に必要
      → 作業停止 + ISSUE 起票 (#511)
        - タイトル: improve(schema): <フィールド名> 追加検討 — <経緯>
        - 設計者承認待ち
```

詳細: `docs/spec/schema-governance.md §3`

### 6.2 グローバル化の判断基準

`docs/spec/plugin-system.md:11-18` 由来。**「どの業務プロジェクトでも合理的に必要になるか」** を問う:

| 区分 | 基準 | 例 |
|---|---|---|
| **グローバル** | どの業務プロジェクトでも合理的に必要になる | `"file"` FieldType (#443) / `"auto"` ActionTrigger (#443) / `MERGE`/`LOCK` DbOperation (#443) |
| **プラグイン (namespace)** | 特定プロジェクト・業界・業態に固有 | `retail:OrderConfirmStep` / `productCode` fieldType / `UPSERT_CART_ITEM` dbOperation |

### 6.3 拡張定義のメタデータ (推奨改善)

#### 現状の問題

`schemas/extensions-*.schema.json` 全 5 ファイルは **namespace のみ必須** で、version / 互換性宣言を持たない:

- `schemas/extensions-steps.schema.json:6-16`
- `schemas/extensions-field-types.schema.json:6-12`
- `schemas/extensions-db-operations.schema.json:6-12`
- `schemas/extensions-triggers.schema.json:6-12`
- `schemas/extensions-response-types.schema.json:6-16`

長期運用 / 複数プロジェクト共有時に拡張定義の互換性追跡ができない。

#### 提案 (additive 改善)

各 extensions schema の root に optional 4 フィールドを追加:

```jsonc
{
  "type": "object",
  "required": ["namespace", "<steps|fieldTypes|...>"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },                    // §5.1 と同じ
    "namespace": { "type": "string", "pattern": "^[a-z0-9_-]*$" },
    "version": { "type": "string", "description": "拡張定義の SemVer" },              // ← 追加
    "requiresCoreSchema": { "type": "string", "description": "互換 core schema バージョン (例: '>=2026-04-25')" },  // ← 追加
    "deprecated": { "type": "boolean", "description": "拡張全体を廃止予定とマーク" },  // ← 追加
    "description": { "type": "string" },                // ← 追加
    "<steps|fieldTypes|...>": { /* 既存 */ }
  }
}
```

#### 互換性

- 既存 retail / response-types 拡張は `version` 等を持たないが optional のため有効のまま
- 新規拡張から段階的に `version` を付ける運用

#### 規範 (本ドキュメント承認後)

- 新規 extensions schema および既存 5 ファイルに optional `version` / `requiresCoreSchema` / `deprecated` / `description` を additive 追加 (別 PR で実装)
- 拡張定義執筆時は新規データに `version: "1.0.0"` を付ける推奨

### 6.4 二段検証 (core schema + extension registry の合成 validation)

`docs/spec/plugin-system.md:247-248` で既に方針が示されているが、原則として明文化:

#### 規範

- core schema は **拡張機構の入口だけ受ける** (`OtherStep.type` の pattern: `^[a-z][a-z0-9_-]*:[A-Z][A-Za-z0-9]*$` at `schemas/process-flow.schema.json:1862-1866`)
- 拡張 step の **存在検証 / DynamicFormSchema 整合検証** は **二段検証** で行う:
  - **段 1**: core schema による pattern / 必須 / additionalProperties 検証
  - **段 2**: extensions registry を読んで、core schema + extensions の合成 schema を組み立て、追加検証
- 段 2 の実装: Node 環境では `loadExtensionsFromDir(dir)` (`frontend/src/schemas/loadExtensions.ts:125`) が拡張定義ディレクトリを読み合成 schema を組み立てる。ブラウザ環境では `wsBridge` 経由で取得した bundle に対して `loadExtensionsFromBundle(bundle)` (同上 `:174`) を使う

#### 採用しない代替案

- 「core schema に拡張 step を直接展開 (`Step.oneOf` に追加)」: ガバナンス違反 (拡張は設計者専権の core schema を変えられない)
- 「拡張のみで完結」: core schema が拡張機構を持たないと、拡張無しでも valid であることが保証できない

### 6.5 拡張間の参照は基本的に許可しない (現状)

現在の extensions schema では、拡張 step が拡張 fieldType を参照することは表現できない。

- 拡張 step の `schema` (`schemas/extensions-steps.schema.json:30-57`) は DynamicFormSchema (subset) で、`$ref` 不可
- 拡張 fieldType (`schemas/extensions-field-types.schema.json:13-24`) は kind/label のみ

#### 規範 (現時点)

- 拡張間参照は **将来検討領域** とし、現状は core schema (FieldType / OtherStep) を経由する形を取る
- 必要が顕在化したら別 ISSUE で設計検討

---

## 7. 後方互換性ルール

### 7.1 すべての追加は optional

- 新規フィールドは **常に optional** (required 配列に追加しない)
- enum 値追加は **additive のみ** (削除・置換不可)
- 既存 sample / 業務データが引き続き valid であること

監査根拠: `docs/spec/schema-audit-2026-04-27.md:138-145` (102 コミット精査で破壊的変更ゼロ確認)

### 7.2 旧形式は union 型で path を残す

| 旧 | 新 | union 名 |
|---|---|---|
| `string` (改行区切り) | `StructuredField[]` | `ActionFields` (`:835-843`) |
| `string` (`"ApiError"` 等) | `{typeRef}` / `{schema}` | `BodySchemaRef` (`:688-709`) |
| `string` | `StructuredCriterion` | `Criterion` (`:1178-1184`) |
| `string` | `OutputBindingObject` | `OutputBinding` (`:908-913`) |
| `string` | `BranchConditionVariant` | `BranchCondition` (`:1488-1493`) |
| `string` | `Step[]` | `ValidationInlineBranch.ok/ng` (`:1018-1029`) |

#### 規範

- 旧形式 → 新形式の移行時は **union 型 (oneOf)** で path を残す
- 新規データは structured (新形式) を使う、旧 string 形式は後方互換のみ
- 移行が完了したら `deprecated: true` annotation を付ける検討 (将来 ISSUE)

### 7.3 deprecated annotation の活用

§3.7 を参照。廃止予定の field / variant には `deprecated: true` を付け、`description` で代替を案内する。

### 7.4 migration 関数で読み込み時に正規化

`frontend/src/utils/actionMigration.ts` の `migrateProcessFlow` が以下を読み込み時に変換:

| 旧形式 | 新形式 |
|---|---|
| `note: "想定: ..."` | `notes: [{type: "assumption", body: "想定: ..."}]` |
| `condition: ""` (空文字列) | `condition: undefined` (ElseBranch では condition 自体が optional) |
| `inputs: "userId\npassword"` | (UI が表形式で開いたとき) `inputs: [{name: "userId"}, {name: "password"}]` |
| `outputBinding: "result"` | (operation 必要時のみ) `{name: "result", operation: "assign"}` |
| `maturity` 未指定 | `"draft"` |
| `mode` 未指定 | `"upstream"` |

schema 側は両形式を受け、UI/実装側で migration して扱う。

### 7.5 schema versioning (将来検討)

現状 schema は単一バージョン (`$id: ".../main/schemas/process-flow.schema.json"`)。将来的に破壊的変更が必要になった場合の方針:

- v1 / v2 を別ファイル (`process-flow.v2.schema.json`) で並存
- `$id` を versioned URL (`.../v2/process-flow.schema.json`) にする
- migration 関数を v1 → v2 で提供
- 採用判断は本ドキュメントのスコープ外、別 ISSUE で起票

---

## 8. テスト規約

### 8.1 schema validation テスト

`frontend/src/schemas/samples-v3.schema.test.ts` / `v3-variant-coverage.test.ts` (および周辺) で:
- `examples/<project-id>/process-flows/*.json` 全件を schema validation で検証 (positive)
- 故意に invalid なデータも negative ケースとして検証
- 新規フィールド追加時は **両ケース** を追加する

実行: `cd frontend && npx vitest run`

> 注: v1 凍結テスト (v1 schema 用) は #774 で削除済み。現行は v3 schema を対象とする `samples-v3.schema.test.ts` を参照。

### 8.2 参照整合性テスト

`frontend/src/schemas/referentialIntegrity.ts` / `referentialIntegrity.test.ts` で:
- `ReturnStep.responseRef` / `ValidationStep.inlineBranch.ngResponseRef` が `action.responses[].id` に存在
- `affectedRowsCheck.errorCode` / `BranchConditionVariant.errorCode` が `errorCatalog` のキーに存在
- ネスト構造 (`loop.steps` / `branch.branches[].steps` / `outcomes.*.sideEffects` / `subSteps`) も再帰検査

JSON Schema 単体で検証できない cross-reference を補完する。

### 8.3 拡張ローダーテスト

`frontend/src/schemas/loadExtensions.test.ts` で:
- 各 namespace の拡張定義を読み込み合成 schema を組み立てる
- 重複 enum 値の検出
- DynamicFormSchema の対応キーワード制限の検証

### 8.4 conventions 整合テスト

`frontend/src/schemas/conventionsValidator.ts` / `conventionsValidator.test.ts` で:
- `@conv.msg.*` / `@conv.regex.*` / `@conv.limit.*` 参照を catalog と突合
- 未定義参照の警告

### 8.5 SQL カラム整合テスト

`frontend/src/schemas/sqlColumnValidator.ts` / `sqlColumnValidator.test.ts` で:
- `DbAccessStep.sql` 内の列参照をテーブル定義と突合 (node-sql-parser + PostgreSQL dialect)
- `/create-flow` の Rule 9 (#486 検証で発覚した SELECT カラム整合) を CI で担保

### 8.6 規範

- 新規 schema 拡張は **同 PR 内で positive + negative テストを追加**する
- `docs/sample-project/process-flows/` の sample で**新規拡張を実体使用**する (`docs/spec/process-flow-extensions.md §15.3` の規範)
- テスト pass を理由に schema を勝手に拡張するのは**絶対禁止** (`schema-governance.md §2`)

---

## 9. 文書化ルール (spec カバレッジマップ)

### 9.1 19 spec 文書のカバレッジマップ

| spec 文書 | 規範化対象 | 主要 schema 領域 |
|---|---|---|
| `process-flow-extensions.md` | Phase B 包括リファレンス (HTTP 契約 / TX / outcome / Saga / runIf / ReturnStep / ComputeStep / errorCatalog / domainsCatalog / functionsCatalog / eventsCatalog / glossary / decisions / cache / lineage / apiVersion + 拡張実装ガイドライン) | `ActionDefinition.httpRoute` / `responses` / `ExternalSystemStep.outcomes` / `affectedRowsCheck` / `BranchConditionVariant` / `OutputBinding` / `errorCatalog` / `domainsCatalog` / `functionsCatalog` / `eventsCatalog` / `glossary` / `decisions` |
| `process-flow-variables.md` | 入出力・変数・outputBinding (Phase 1 基盤) | `ActionFields` / `StructuredField` / `OutputBinding` / `argumentMapping` |
| `process-flow-maturity.md` | 成熟度 (`maturity`)・付箋 (`notes[]`)・モード (`mode`) | `Maturity` / `StepNote` / `ProcessFlowMode` |
| `process-flow-runtime-conventions.md` | SQL 補間 / HTTP serialize / TX × throw × tryCatch / fireAndForget / sideEffects 境界 / ambient context | (schema 制約外 = convention) `DbAccessStep.sql` / `ExternalHttpCall.body` / `transactionScope` / `ambientOverrides` |
| `process-flow-expression-language.md` | runIf / expression / bodyExpression / condition の BNF | (schema 制約外 = convention) `runIf` / `expression` / `bodyExpression` / `condition` |
| `process-flow-workflow.md` | WorkflowStep / WorkflowPattern (11 パターン) | `WorkflowStep` / `WorkflowPattern` / `WorkflowApprover` / `WorkflowQuorum` / `WorkflowEscalateTo` |
| `process-flow-transaction.md` | TransactionScopeStep (v3 で TX 表現一本化、旧 txBoundary は #1221 で廃止) | `TransactionScopeStep` |
| `process-flow-sla.md` | SLA / Timeout (3 レベル) | `Sla` (`ProcessFlow` / `ActionDefinition` / `StepBase`) |
| `process-flow-criterion.md` | Criterion (Arazzo successCriteria 互換) | `Criterion` / `StructuredCriterion` / `CriterionType` |
| `process-flow-external-system.md` | ExternalSystemStep の OpenAPI operation 参照 | `ExternalSystemStep.operationRef` / `operationId` / `requestBodyRef` / `responseRef` |
| `process-flow-testing.md` | testScenarios (Given-When-Then) | `TestScenario` / `TestPrecondition` / `TestInvocation` / `TestAssertion` |
| `process-flow-secrets.md` | secretsCatalog (環境別参照式) | `SecretRef` / `secretsCatalog` |
| `process-flow-env-vars.md` | envVarsCatalog (Power Platform Environment Variables 由来) | `EnvVarEntry` / `envVarsCatalog` |
| `process-flow-tier-c.md` | C-1 ExternalSystemStep の circuitBreaker / bulkhead / C-2 ClosingStep / C-3 CdcStep / C-4 health/readiness / C-5 resources | `CircuitBreakerConfig` / `BulkheadConfig` / `ClosingStep` / `CdcStep` / `HealthCheckGroup` / `ReadinessCheckGroup` / `ResourceRequirements` |
| `screen-items.md` | 画面項目定義 + ScreenItem.id ↔ StructuredField.screenItemRef | (別 schema) ScreenItem / `StructuredField.screenItemRef` |
| `list-common.md` | 一覧系 UI 共通仕様 (操作・キーボード・D&D・コピペ・ソート・フィルタ) | (UI 仕様、schema 関連薄い) |
| `plugin-system.md` | プラグインシステム (5 種拡張 + 二段検証) | `extensions-*.schema.json` 全 5 ファイル / `OtherStep.type` の `namespace:Name` pattern |
| **`schema-governance.md`** | **最重要**: グローバル schema 変更ガバナンス | (権限規範、schema そのものではない) |
| **`schema-design-principles.md`** (本書) | **schema を どう書くか の規範** | (本書、schema そのものではない) |
| `schema-audit-2026-04-27.md` | 過去 102 コミット精査レポート (Phase B-1) | (履歴監査) |
| `dogfood-2026-04-26-finance.md` / `dogfood-2026-04-26-manufacturing.md` / `dogfood-2026-04-27-logistics-create-flow-validation.md` / `dogfood-2026-04-27-phase4-retail-validation.md` | ドッグフード評価レポート | (実証ログ、規範ではない) |

### 9.2 重複領域 (整理候補)

以下の 3 文書には類似記述があり、将来整理候補:

- `process-flow-expression-language.md §6` (式が現れるフィールド一覧)
- `process-flow-runtime-conventions.md §1-§4` (SQL 補間 / body serialize / fireAndForget)
- `process-flow-extensions.md §3.0-§3.3` (外部連携 outcome / httpCall)

特に `process-flow-extensions.md` は Phase B 包括リファレンスを兼ねるため記述量が多い (§1-§15、約 1100 行)。新機能追加時の重複を避けるため、**新規仕様は専用文書 (`process-flow-<topic>.md`) に分離**する規範を維持。

### 9.3 spec 文書執筆時の規範

- **意図 (Why)** を冒頭で明記 (issue 番号 + 策定日 + 由来)
- **スキーマ (TS / JSON 型定義)** を具体例として添える
- **JSON 例** を最低 1 件示す
- 既存規範との関係 (§N.x 参照) を相互リンク
- **後方互換性の方針** を明記 (deprecated 扱い / migration 関数の役割)
- **採用しない代替案 (棄却理由)** を残す (本ドキュメントの「採用しない代替案」セクションと同様)

---

## 10. 既知の課題と将来 ISSUE 候補

本ドキュメント起草時点で認識された課題。**本 #517 のスコープ外** で、設計原則確立後に別 ISSUE で対応する。

### 10.1 schema バグ (Must-fix)

#### B-1: WorkflowStep / TransactionScopeStep から `sla` 列挙抜け

- **場所**: `schemas/process-flow.schema.json:1789-1797` (WorkflowStep) / `:1963-1970` (TransactionScopeStep)
- **症状**: StepBaseProps では `sla` を許可するが、WorkflowStep / TransactionScopeStep の variant `properties` で `sla: true` の列挙が抜けている。`additionalProperties: false` のため、両 step に `sla` を書くと validation error
- **解決策**: variant の `properties` に `sla: true` を追加 (1 行ずつ)
- **より根本的な解決**: §3.4 の `unevaluatedProperties: false` 移行
- **対応 ISSUE**: 別途起票 (本ドキュメント承認後)

### 10.2 構造改善 (Should-fix、非破壊)

#### B-2: ProcessFlow root に `$schema` 許可 (§5.1)

- **対応 ISSUE**: 別途起票
- **影響**: ProcessFlow JSON で IDE IntelliSense が機能する

#### B-3: `unevaluatedProperties: false` 移行 (§3.4)

- 22 step variant + WorkflowQuorum / WorkflowEscalateTo / etc の合成型を漸進的に移行
- **対応 ISSUE**: 別途起票 (Phase 分け、最初は ValidationStep / DbAccessStep など主要 step から)

#### B-4: extensions schema の version metadata 追加 (§6.3)

- 5 extensions schema 全部に optional `version` / `requiresCoreSchema` / `deprecated` / `description` を additive 追加
- **対応 ISSUE**: 別途起票

#### B-5: 既存 prop の description 追加 (§5.4)

- description が無い既存 prop (`Sla.timeoutMs` 他) に description を追加
- **対応 ISSUE**: 別途起票 (低優先度)

### 10.3 運用改善 (Nit)

#### B-6: WorkflowQuorum.type の `enum` を named type 化

- 現状 inline `enum: ["all", "any", "majority", "n-of-m"]` (`schemas/process-flow.schema.json:1757`)
- `$defs/WorkflowQuorumType` に切り出して型として named にする
- **対応**: 同上、低優先度

### 10.4 Codex セカンドオピニオンの引き継ぎ

Codex (GPT-5.5) が #517 のセカンドオピニオンで提示した 5 つの提案 (`unevaluatedProperties` / Step 階層化 / 二段検証 / extension version / `$schema` 許可) のうち、本ドキュメントで原則化したのは:

| Codex 提案 | 本ドキュメントでの扱い |
|---|---|
| `unevaluatedProperties: false` 採用 | **§3.4 で原則化、別 PR で実装 (B-3)** |
| Step 階層化 (CoreStep / ExtensionStep / NonReturnCoreStep) | **不採用**: 現状の `Step` / `NonReturnStep` で機能十分、移行コスト > メリット |
| 二段検証の正式化 | **§6.4 で明文化 (既に `plugin-system.md:247-248` にあったものを原則として確立)** |
| extension file の `version` / `requiresCoreSchema` / `deprecated` | **§6.3 で原則化、別 PR で実装 (B-4)** |
| ProcessFlow root に `$schema` optional 追加 | **§5.1 で原則化、別 PR で実装 (B-2)** |

---

## 11. 関連ドキュメント

- `docs/spec/schema-governance.md` (#511) — 変更権限の階層、本ドキュメントと対をなす
- `docs/spec/schema-audit-2026-04-27.md` (#511 Phase B-1) — 過去 102 コミット精査レポート
- `docs/spec/process-flow-*.md` (14 文書) — 個別仕様、本ドキュメントが横断する規範を補完する詳細
- `docs/spec/plugin-system.md` (#442) — プラグインシステム (拡張機構の詳細)
- `schemas/README.md` — JSON Schema 一次成果物の位置づけと使い方
- memory: `feedback_schema_governance_strict.md` (AI 永続記憶: schema 変更の権限)

---

## 12. 変更履歴

- 2026-04-27: 初版起草 (#517)。設計者 (Opus) が schema 全行 / spec 19 文書 / 4 sample / 拡張定義全件を読了の上で起草。Codex (GPT-5.5) セカンドオピニオン (#517 議論、proposal md は廃止済) を比較材料として使用
