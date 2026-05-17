# JSON Schema v3 — Opus 設計版

| 項目 | 値 |
|---|---|
| ステータス | 起草中 (#521) |
| 起草 | 設計者 (Opus) — Sonnet/Codex 委譲なし、全 schema を Opus 自身が一から書いた。Codex / Opus サブエージェント独立レビュー指摘を反映済み |
| 起草日 | 2026-04-27 |
| 設計記録 | [`../../docs/spec/schema-v3-design.md`](../../docs/spec/schema-v3-design.md) |

v1 (機械変換前) / v2 (機械変換版) を base にせず、業務概念から一から再設計した版。

## ファイル構成 (24 ファイル)

合計 24 ファイル: top-level **17 ファイル** + `generic-definitions/` サブディレクトリ **7 ファイル** (#1142 で再棚卸し)。

### 共通基盤

| ファイル | 役割 |
|---|---|
| `common.v3.schema.json` | 全 schema が `$ref` で参照する共通 `$defs`。Uuid / UuidLoose / LocalId / Identifier / PhysicalName / EnvVarKey / ErrorCode / EventTopic / Timestamp / SemVer / SemVerRange / Description / DisplayName / Maturity / Mode / ExpressionString / Namespace / EntityMeta / Authoring / Marker / MarkerShape / DecisionRecord / GlossaryEntry / Note / FieldType / StructuredField / 複合参照型 (ScreenItemRef / TableColumnRef / ViewColumnRef / ActionRef / StepRef / ResponseRef) / ExtensionApplied / ExtensionRoot / TestScenario / TestPrecondition / TestInvocation / TestAssertion を集約。Pattern A (top-level entity 単独参照) は素 Uuid を直接 `$ref` する方針のため named Ref 型 (旧 ScreenRef / TableRef 等) は設けない |

### Workspace marker / entity 定義 (top-level)

| ファイル | 役割 |
|---|---|
| `harmony.v3.schema.json` | ワークスペース marker ファイル (`harmony.json`)。schemaVersion / meta / **dataDir** (必須、設計データ格納先の相対パス) / extensionsApplied (ExtensionApplied[]) / entities / authoring。**配置: ワークスペース root 直下** |
| `external-catalogs.v3.schema.json` | プロジェクト全体で共有する外部システム / AI モデル / シークレット / 環境変数 / イベント / 関数の project-level catalog 定義 (#940 / #1142)。flow level (`context.catalogs.*`) で override 可能。配置: `<dataDir>/catalogs/external.json` |
| `screen.v3.schema.json` | Screen entity。EntityMeta + 業務情報のみ (kind / path / items / auth / permissions / design 参照)、UI 座標は分離。hasDesign は harmony.v3 の ScreenEntry 側で一覧表示用に保持 (Screen 本体には不在)。配置: `<dataDir>/screens/<id>.json` |
| `screen-flow-positions.v3.schema.json` | 画面フロー UI 座標 (Designer 専用、業務実装には不要)。配置: `<dataDir>/screen-flow-positions.json` |
| `page-layout.v3.schema.json` | PageLayout (共通レイアウト entity、RFC #1021)。regions + assignments + design + optional processFlowId。配置: `<dataDir>/page-layouts/<id>.json` |
| `screen-item.v3.schema.json` | ScreenItem (画面項目)。id は Identifier (camelCase 強制)、ValueSource discriminated union (組み込み 4 種 + 拡張) |
| `table.v3.schema.json` | Table (DB テーブル)。EntityMeta + physicalName + columns + indexes + constraints (discriminated union: unique/check/foreignKey、FK は ConstraintDefinition に集約) + defaults + triggers。配置: `<dataDir>/tables/<id>.json` |
| `er-layout.v3.schema.json` | ER 図 UI 座標 + 論理リレーション。配置: `<dataDir>/er-layout.json` |
| `sequence.v3.schema.json` | Sequence (DB シーケンス)。usedBy は common.v3#/$defs/TableColumnRef に統一。配置: `<dataDir>/sequences/<id>.json` |
| `view.v3.schema.json` | View (DB ビュー)。配置: `<dataDir>/views/<id>.json` |
| `view-definition.v3.schema.json` | ViewDefinition (画面 一覧 UI viewer)。kind (list / detail / kanban / calendar 等) + sourceTableId + columns。配置: `<dataDir>/view-definitions/<id>.json` |
| `custom-block.v3.schema.json` | カスタムブロック集合 (id は Uuid 強制、v1 timestamp 形式廃止)。**注意: CustomBlock は EntityMeta を持たない例外** (label ベースの独自構造、業務 entity ではないため) |
| `process-flow.v3.schema.json` | ProcessFlow (処理フロー)。**root を meta / context / actions / authoring の 4 並列に再編** (旧 v2 の root 並列肥大化を解消、ただし `body` セクションを設けず actions を root 直接持ちにすることで認知負荷を最小化)。catalogs を context.catalogs.<kind> に階層化 (modelEndpoints 含む)、22 種 Step variant (組み込み 21 + ExtensionStep)。配置: `<dataDir>/process-flows/<id>.json` |
| `conventions.v3.schema.json` | 横断規約 catalog (i18n / msg / regex / limit / scope / currency / tax / auth / role / permission / db / numbering / tx / externalOutcomeDefaults + extensionCategories) |
| `extensions.v3.schema.json` | **統合拡張定義** — 1 namespace = 1 ファイルで全種類 (fieldTypes / dataTypes / screenKinds / processFlowKinds / actionTriggers / dbOperations / stepKinds / responseTypes / valueSourceKinds / columnTemplates / constraintPatterns / conventionCategories) を集約。配置: `<dataDir>/extensions/<namespace>.v3.json` または `<dataDir>/extensions/<namespace>/*.v3.json` |
| `generic-definition.v3.schema.json` | Generic Definition Catalog の親 schema (#1069)。catalog ファイル 1 件 = 1 GenericDefinition (kind 別)。実 catalog エントリ schema は `generic-definitions/<kind>.v3.schema.json` に分割 |

### `generic-definitions/` サブディレクトリ (Generic Definition Catalog の kind 別 schema、#1063 / #1064 / #1066 / #1067)

| ファイル | 役割 |
|---|---|
| `generic-definitions/application-rule.v3.schema.json` | ApplicationRule (業務ルール catalog エントリ、#1067) |
| `generic-definitions/data-contract.v3.schema.json` | DataContract (データ契約 catalog エントリ、#1064) |
| `generic-definitions/domain-type.v3.schema.json` | DomainType (ドメイン型 catalog エントリ、#1064) |
| `generic-definitions/exception-type.v3.schema.json` | ExceptionType (業務例外型 catalog エントリ、#1066) |
| `generic-definitions/runtime-policy.v3.schema.json` | RuntimePolicy (runtime 動作ポリシー catalog エントリ、#1067) |
| `generic-definitions/ui-behavior.v3.schema.json` | UiBehavior (UI 振る舞い catalog エントリ、#1067) |
| `generic-definitions/ui-fragment.v3.schema.json` | UiFragment (UI 断片 catalog エントリ、#1067) |

注: `component-definition` は親 schema (`generic-definition.v3.schema.json`) 単独で検証する (固有 schema ファイルなし)。

## v3 で導入した主要設計

### 1. 共通 entity meta mix-in

`common.v3#/$defs/EntityMeta` を**業務 top-level entity** が `allOf` でマージ:

```jsonc
"id": Uuid, "name": DisplayName, "description"?: Description,
"version"?: SemVer, "maturity"?: Maturity,
"createdAt": Timestamp, "updatedAt": Timestamp
```

各 entity 側 `$defs` では variant 固有プロパティのみ宣言する (`id: true` 等の上書きは禁止)。`unevaluatedProperties: false` が allOf 全体を見て評価するため、EntityMeta の Uuid 制約等が効く。

**例外**: `CustomBlock` は `label` ベースの GrapesJS 用構造で業務 entity ではないため EntityMeta を持たない。

### 2. 参照規範を 4 パターンに統一

- **Pattern A**: `<entity>Id: Uuid` — top-level entity 単独参照。`common.v3#/$defs/Uuid` を直接 `$ref` する (named alias は schema レベルでは型区別ができないため設けない、実装言語側で **branded type** を定義することを推奨)
- **Pattern B**: `<entity>Ref: { ... }` — 複合参照 (ScreenItemRef / TableColumnRef / ViewColumnRef / ActionRef / StepRef / ResponseRef)
- **Pattern C**: catalog key `string` — 同 entity 内 catalog のキー (各 catalog に `propertyNames` 制約で命名規範を schema 上強制)
- **Pattern D**: 式言語 `@conv.* @secret.* @env.* @fn.* @<var> $...`

### 実装言語側の branded type 推奨例 (TypeScript)

```ts
type Brand<K, T> = K & { readonly __brand: T };
type ScreenId = Brand<string, 'ScreenId'>;
type TableId = Brand<string, 'TableId'>;
type ProcessFlowId = Brand<string, 'ProcessFlowId'>;
```

これにより `tableId: ScreenId` のような誤代入をコンパイル時に検出できる。schema レベルの Uuid では型区別できないため、本対応は実装言語側の責務とする。

**廃止 anti-pattern**: 物理名で entity 指定 (`referencedTable: "users"` 等) / id+name 重複併記 (`tableId + tableName` 等) / `eventRef + topic` の二重持ち

### 3. FieldType を common.v3 に集約

ProcessFlow / ScreenItem / DomainCatalog で同一の FieldType を `$ref` 参照。プリミティブ 7 種 + 構造体 (array/object) + 参照型 (tableRow/tableList/screenInput/domain) + file + 拡張 (`kind: "extension"` + `extensionRef: "namespace:typeName"`)。

### 4. ProcessFlow root を 4 並列セクションに再編

```
meta:      identity + 運用設定 (id / name / kind / sla / mode / 等)
context:   実行に必要な参照 (catalogs.<kind> / ambientVariables / ambientOverrides / health / readiness / resources)
actions:   実行ロジック本体 (ActionDefinition[])
authoring: 設計用 (markers / testScenarios / decisions / glossary / notes、実行不要)
```

旧 v2 の root 30+ 並列を 4 並列に整理。`actions` は root 直接持ち (`body` ラッパーは廃止、認知負荷低減)。

### 5. catalog 階層化 + propertyNames 制約

旧 root 並列 catalog を `context.catalogs.{errors / externalSystems / secrets / envVars / domains / functions / events}` に階層化。各 catalog は `propertyNames` で命名規範を schema 上強制 (errors→ErrorCode / externalSystems→Identifier / domains→PascalCase 等)。

### 6. Marker / DecisionRecord / GlossaryEntry / Note / TestScenario を共通化

`common.v3#/$defs/Marker / DecisionRecord / GlossaryEntry / Note / TestScenario / TestPrecondition / TestInvocation / TestAssertion` を全領域 (Screen / Table / ScreenItem / ProcessFlow / Harmony workspace) の authoring セクションで使用可。`Authoring` $defs にまとめて参照する形式。

`Marker.kind` には `validator` を追加 (validator 由来の警告 marker と人間 marker を kind で区別、validator marker は `validatorCode` / `validatorPath` を必須化)。

### 7. 拡張機構を 1 ファイル統合 + 分割運用許容

旧 v2 では 10 個の extensions schema → v3 では `extensions.v3.schema.json` 1 ファイル。

**運用は 2 通り両対応**:
- `<dataDir>/extensions/<namespace>.v3.json` 1 ファイル (シンプル運用)
- `<dataDir>/extensions/<namespace>/*.v3.json` 複数ファイル分割 (大規模 namespace 用)

loader が glob で読み込み、同 namespace の複数ファイルをマージする。

### 8. discriminator を `kind` で全領域統一

Step.kind / FieldType.kind / Constraint.kind / BranchCondition.kind / ValueSource.kind / TestPrecondition.kind / TestAssertion.kind / Marker.kind / CdcDestination.kind 全部 `kind`。

### 9. unevaluatedProperties: false

全 step variant + 主要 entity に適用。base + variant 合成型のドリフトを構造的に防止。EntityMeta の Uuid / Timestamp 等の制約が allOf 経由で効く。

### 10. enum 命名規範を文書化

| ドメイン | 命名 | 例 |
|---|---|---|
| SQL keyword | UPPER | DataType / DbOperation / TriggerEvent / TriggerTiming |
| HTTP | UPPER | HttpMethod |
| TX/EE | UPPER_SNAKE | TransactionIsolationLevel / TransactionPropagation |
| ベンダ慣習 (DB ツール) | lowercase | SqlDialect / IndexMethod |
| Workflow / BPM 業界 | kebab-case | WorkflowPattern |
| ER モデリング | kebab-case | ErCardinality |
| **その他 (新規 enum / discriminator / valueSource.kind 等)** | **lowerCamelCase** | StepKind / Constraint.kind / WorkflowQuorum.type / ValidationRule.severity |

### 11. 業務識別子規範 (3 種)

- **Identifier** (camelCase): 業務識別子 — ScreenItem.id, StructuredField.name, 拡張 kind, ProcessFlow 変数名
- **PhysicalName** (snake_case): DB 物理名 — TableDefinition.physicalName, TableColumn.physicalName, Sequence.physicalName, View.physicalName
- **DisplayName** (自由 string、文字種制限なし): 表示名 — Screen.name, Table.name, ScreenItem.label

`name = 表示名 / physicalName = システム識別子` を全領域で一貫。

### 12. 拡張バージョニング

`common.v3#/$defs/ExtensionRoot` で `version` (SemVer) / `requiresCoreSchema` (SemVerRange) を必須化。`harmony.v3#/extensionsApplied` は `ExtensionApplied[]` (`{ namespace, version? }`) で version 制約付き宣言。

## v3 で廃止したもの (v1/v2 から)

| 旧 | v3 |
|---|---|
| string union (ActionFields / BodySchemaRef / Criterion / OutputBinding / BranchCondition / ValidationInlineBranch.ok/ng) | structured 必須 (string 短縮形廃止) |
| 旧 `note: string` | `notes: Note[]` のみ |
| `FieldType.custom` (deprecated) | 削除 |
| `ExternalSystemStep.protocol` (deprecated) | 削除 (httpCall + operationRef のみ) |
| `TableColumn.foreignKey` (inline FK) | ConstraintDefinition に集約 |
| `ConstraintDefinition.referencedTable` (物理名) | `referencedTableId: Uuid` |
| `tableId + tableName` 併記 / `targetScreenId + targetScreenName` 併記 | id のみ |
| `EventPublishStep.eventRef + topic` 二重持ち | topic のみ (二重持ち anti-pattern 解消) |
| ProcessFlow root 30+ 並列プロパティ | meta / context / actions / authoring の 4 並列 |
| 10 個の extensions schema | extensions.v3.schema.json 1 ファイル統合 |
| ScreenNode の position / size / thumbnail (UI 座標) | screen-flow-positions.v3.schema.json に分離 |
| `FkAction` の `NO ACTION` (スペース含み) | `noAction` (lowerCamelCase) |
| `ValidationRuleKind` (`Error` / `Msg` 等 PascalCase) | `ValidationRule.severity` (`error` / `msg` 等 lowerCamelCase、`kind` 多義性回避のためフィールド名も rename) |
| `WorkflowQuorum.type` の `n-of-m` | `nOfM` |
| `CustomBlock.id` の timestamp 形式 | Uuid 強制 |
| `StepBaseProps` の二重列挙 | `unevaluatedProperties: false` で構造的解消 |
| `StepBaseProps.transactional: boolean` 簡易 TX マーク | 削除 (txBoundary に統一、v3 の「短縮形廃止」方針) |
| catalog key の命名規範が description のみ | `propertyNames` で schema 上強制 (errors → ErrorCode / externalSystems → Identifier / etc.) |
| `DataLineage.reads / writes: Uuid[]` | `LineageEntry[]` (`{ tableId, purpose? }`) |
| `CdcStep.destination.target: string` | discriminated union (auditLog / eventStream / table) |
| `ExtensionStep` の任意 top-level 属性 | `config: object` に閉じる + `unevaluatedProperties: false` |
| 拡張 1 ファイル限定 | 単一/複数ファイル両対応 (loader が glob で merge) |
| ProcessFlow 専用 testScenarios | `common.v3#/$defs/TestScenario` で全 entity 共通化 |

## v1/v2 → v3 移行マッピング表

dogfood (#523) で v1 → v3 への機械変換は不能と判明。**人手で確認すべき rename / 構造変更** を一覧化:

### EventTopic 命名規範 (camelCase → snake_case)

v3 EventTopic regex は `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` (lowercase + underscore のみ)。v1 sample で camelCase 部分を含む topic は **必ず rename**:

| v1 | v3 |
|---|---|
| `inventory.notFound` | `inventory.not_found` |
| `cart.itemAdded` | `cart.item_added` |
| `order.userCancelled` | `order.user_cancelled` |
| `payment.preAuthorized` | `payment.pre_authorized` |
| `cart.item_added` (snake_case 部分) | そのまま (v3 規範に合致、rename 不要) |

### ProcessFlow 構造変更 (root 30+ → 4 セクション)

| v1 | v3 |
|---|---|
| `type: "screen"` | `meta.kind: "screen"` |
| `screenId`, `apiVersion`, `mode`, `maturity`, `description`, `version`, `createdAt`, `updatedAt` | `meta.{...}` (EntityMeta + ProcessFlow 固有) |
| `errorCatalog: { CODE: { responseRef } }` | `context.catalogs.errors: { CODE: { responseId } }` |
| `eventsCatalog` | `context.catalogs.events` (EventTopic 規範遵守) |
| `externalSystemCatalog` | `context.catalogs.externalSystems` |
| `secretsCatalog` | `context.catalogs.secrets` |
| `domainsCatalog` | `context.catalogs.domains` |
| `functionsCatalog` | `context.catalogs.functions` |
| `ambientVariables: [{name, type, required, description}]` | `context.ambientVariables: StructuredField[]` (構造同じ、type は FieldType に拡張) |
| `glossary` | `authoring.glossary` |
| `decisions` | `authoring.decisions` |
| `testScenarios` | `authoring.testScenarios` |
| `actions: [...]` | `actions: [...]` (root 直接、`body` ラッパなし) |

### Step 構造変更

| v1 | v3 |
|---|---|
| `step.type: "validation"` | `step.kind: "validation"` |
| `outputBinding: "var"` (string 短縮形) | `outputBinding: { name: "var" }` (構造化、v3 短縮形廃止) |
| `tableName: "products"` | `tableId: "<Uuid>"` (物理名直書き廃止) |
| `lineage.reads: ["products"]` | `lineage.reads: [{ tableId: "<Uuid>", purpose?: "..." }]` |
| `eventPublish.eventRef + topic` 二重持ち | `eventPublish.topic` のみ |
| `validation.inlineBranch.ngEventPublish.eventRef + topic` | `topic` のみ |
| `return.responseRef` | `return.responseId` |
| `branch.branches[].condition: "@x == 1"` (string) | `condition: { kind: "expression", expression: "@x == 1" }` |
| `externalSystem.systemName + systemRef` 併記 | `systemRef` のみ (catalog キー = systemId) |
| `validation.rules[].kind: "Error"` (PascalCase) | `validation.rules[].severity: "error"` (lowerCamelCase + フィールド名 rename) |
| `dbAccess.lineage` のみ持てた | **任意の step に `lineage` を持てる** (#525 F-2、StepBaseProps 移植) |

### ValidationInlineBranch

| v1 | v3 |
|---|---|
| `inlineBranch.ok: "次のステップへ"` (string) | `inlineBranch.ok: []` または `[Step, ...]` (Step[] 必須) |
| `inlineBranch.ng: "..." + ngResponseRef + ngBodyExpression` | `inlineBranch.ng: []` + `ngResponseId` + `ngBodyExpression` (短縮構造維持可) |

### Table 構造変更

| v1 | v3 |
|---|---|
| `table.logicalName: "商品マスタ"` (display) | `table.name: "商品マスタ"` (DisplayName) + `table.physicalName: "products"` (PhysicalName) |
| `column.name: "products"` (混在) | `column.name: "商品名"` (display) + `column.physicalName: "products"` (snake_case) |
| `column.foreignKey: { tableName, columnName }` (inline) | `table.constraints[]: { kind: "foreignKey", referencedTableId: Uuid, referencedColumnIds: LocalId[] }` |
| `referencedTable: "users"` (物理名) | `referencedTableId: "<Uuid>"` |
| FK action: `"NO ACTION"` (空白含み) | `"noAction"` (lowerCamelCase) |
| FK action: `"SET NULL"` | `"setNull"` |

### Screen / ScreenItem 構造変更

| v1 | v3 |
|---|---|
| `screenItems[].name: "user_id"` (混在) | `screenItem.id: "userId"` (Identifier / camelCase 強制) + `screenItem.label: "ユーザーID"` |
| Screen に `position` / `size` / `thumbnail` (UI 座標) | `screen-flow-positions.v3.schema.json` に分離 (`<dataDir>/screen-flow-positions.json`) |
| `valueFrom: "@var"` (string) | `valueFrom: { kind: "flowVariable", variableName: "var" }` (構造化) |

### TestScenario 構造変更

| v1 | v3 |
|---|---|
| `given.dbState.table: "products"` (物理名) | `given.dbState.tableId: "<Uuid>"` |
| `given.externalStub.externalRef: "..."` | `externalRef: Identifier (camelCase)` (catalog キー、catalogs.externalSystems と整合) |

### Uuid 強化

| v1 | v3 |
|---|---|
| `id: "gggggggg-0001-4000-8000-gggggggggggg"` (UuidLoose、a-z 含む) | `id: "<RFC 4122 v4 strict UUID>"` (`UuidLoose` は deprecated、test/sample のみ受容) |
| `CustomBlock.id: "custom-block-1776079074303"` (timestamp 形式) | `id: "<Uuid>"` (RFC 4122 v4 strict) |

### Catalog キー命名強制 (v3 で新規)

各 catalog のキーは `propertyNames` で schema 上強制される:

| Catalog | キー命名 | 例 |
|---|---|---|
| `errors` | UPPER_SNAKE (ErrorCode) | `STOCK_SHORTAGE`, `INSUFFICIENT_INVENTORY` |
| `externalSystems` | camelCase (Identifier) | `inventoryAnalyticsService` |
| `secrets` | camelCase (Identifier) | `analyticsApiKey` |
| `envVars` | UPPER_SNAKE (EnvVarKey) | `STRIPE_API_BASE` |
| `domains` | PascalCase | `EmailAddress`, `Quantity` |
| `functions` | camelCase (Identifier) | `formatCurrency` |
| `events` | dot.lowercase + underscore (EventTopic) | `order.confirmed` |

## バリデータ実装ヒント (AJV)

JSON Schema 2020-12 を使うため、AJV では `Ajv2020` を使用:

```ts
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import commonV3 from "./schemas/v3/common.v3.schema.json" assert { type: "json" };
import processFlowV3 from "./schemas/v3/process-flow.v3.schema.json" assert { type: "json" };

const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
addFormats(ajv);
ajv.addSchema(commonV3);  // 他 schema が common を $ref 解決できるよう先に登録
const validate = ajv.compile(processFlowV3);
```

ポイント:
- `discriminator: true` を有効化すると、`discriminator` keyword を持つ oneOf (BranchCondition / CdcDestination / Constraint / TestPrecondition / TestAssertion) で kind 単位の focused エラー報告 (1 branch のみ) になる (#525 F-4)
- **Step.oneOf / NonReturnStep.oneOf には discriminator keyword なし**: ExtensionStep の `kind` がパターン (`namespace:StepName`) で AJV strict const 要件を満たさないため。Step 系は従来通り 22 branch 全評価で fall back する (限界、上位 UI 側でフィルタ推奨)
- `addSchema(commonV3)` を先に呼んで cross-file `$ref` を解決可能にする
- 他 schema (extensions / table / screen 等) も同様に addSchema で登録

## $schema 属性 (instance JSON 側)

各 entity instance の root に `"$schema": "<相対パス or URL>"` を書ける (#525 F-1 で許容)。IDE (VS Code 等) で schema 関連付けされ、自動補完・型チェックが効く。

```jsonc
{
  "$schema": "../../../schemas/v3/table.v3.schema.json",
  "id": "<Uuid>",
  "name": "...",
  ...
}
```

対応 entity: harmony / external-catalogs / page-layout / table / screen / screen-flow-positions / process-flow / sequence / view / view-definition / er-layout / extensions / conventions / generic-definition。**custom-block は array root のため対象外**、common は $defs ライブラリのため不要。

## ガバナンス

設計者 (ユーザー) 明示指示による §7 例外規定で進行。AI による勝手拡張ではない。

## Namespace 空文字の運用

`Namespace` ($defs) が空文字を許容するのは「グローバル拡張」(loader が `extensionsApplied` の指定なしでも自動的に読み込む共通拡張) を表現するため。実プロジェクトで使う業界別拡張は `retail` / `finance` 等の文字列を必ず指定する。

## 関連

- 設計記録: [`../../docs/spec/schema-v3-design.md`](../../docs/spec/schema-v3-design.md)
- バージョン管理ポリシー: [`../README.md`](../README.md)
- 設計原則: [`../../docs/spec/schema-design-principles.md`](../../docs/spec/schema-design-principles.md) (PR #518)
- ガバナンス: [`../../docs/spec/schema-governance.md`](../../docs/spec/schema-governance.md) §7 例外規定 (設計者明示指示) で進行

注: v1 (`../v1/`) / v2 (`../v2/`) ディレクトリは PR #774〜#779 (2026-05-03、`project_canonical_sample_layout_2026_05_03.md`) のサンプル canonical 化対応で削除済。本 README からも broken link を除去 (#1142)。
