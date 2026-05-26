# ProcessFlow 参照 prefix 24 種 + 階層参照 (`@<key>` 統一記法)

Issue: [RFC #1254](https://github.com/csilost2001/harmony/issues/1254) 件 3.7 / [#1263](https://github.com/csilost2001/harmony/issues/1263) Phase X2
策定日: 2026-05-23
ステータス: **v3 確定** — schema は `schemas/v3/` を一次成果物とし、本仕様で参照プロトコルを補足する

`ProcessFlow` schema 全体で使用する **`@<prefix>.<key>` 統一参照記法** の正規仕様。RFC #1254 件 3.7 の hybrid 11 file 構成と 1:1 対応する。

## 1. 24 prefix 一覧 (canonical 単層命名)

| prefix | 参照先 | inline 可否 (`${...}` 内) | catalog source |
|---|---|---|---|
| `@flow` | ProcessFlow entity (EntityId) | ❌ inline 禁止 (副作用 invocation) | `process-flows/<id>.json` |
| `@screen` | Screen entity / 画面項目 | ✅ pure ref のみ (例: `@screen.<id>.item.<id>.label`) | `screens/<id>.json` |
| `@table` | Table entity / カラム | ✅ pure ref のみ (例: `@table.<id>.field.<id>.physicalName`) | `tables/<id>.json` |
| `@view` | View entity (DB) | ✅ pure ref のみ | `views/<id>.json` |
| `@viewer` | ViewDefinition entity (viewer UI) | ✅ pure ref のみ | `view-definitions/<id>.json` |
| `@seq` | Sequence entity | ✅ pure ref のみ | `sequences/<id>.json` |
| `@layout` | PageLayout entity | ✅ pure ref のみ | `page-layouts/<id>.json` |
| `@system` | ExternalSystem catalog | ✅ pure ref のみ | `context.catalogs.externalSystems` |
| `@conv` | Conventions catalog (規約) | ✅ pure ref | `conventions/*.json` |
| `@ext` | Extension namespace | ✅ pure ref | `extensions/<ns>/*.json` |
| `@var` | ProcessFlow 変数 (scope chain) | ✅ pure ref ([process-flow-variables.md §3.6](process-flow-variables.md#36-スコープ-enum-6-値と-varscopename-1264-verdict--1263-phase-x2) scope chain / [§3.7](process-flow-variables.md#37-tx-transactionscope-境界での変数挙動-1264-verdict-観点-4--1267-round-7-option-c) TX expose 参照) | runtime scope |
| `@contract` | data-contract (DTO / Form / Result / ViewModel) | ✅ pure ref | `generic-definitions/data-contract/*.json` |
| `@type` | domain-type (Entity / Model) | ✅ pure ref | `generic-definitions/domain-type/*.json` |
| `@exception` | exception-type (例外階層) | ✅ pure ref | `generic-definitions/exception-type/*.json` |
| `@rule` | application-rule (横断ルール) | ❌ inline 不可 (purity 不明、別 RFC) | `generic-definitions/application-rule/*.json` |
| `@validation` | validation-rule (業務検証) | ✅ inline 可 (**boolean return のみ**) | `generic-definitions/validation-rule/*.json` |
| `@behavior` | ui-behavior | ✅ pure ref | `generic-definitions/ui-behavior/*.json` |
| `@policy` | runtime-policy (retry / timeout / cache) | ✅ pure ref | `generic-definitions/runtime-policy/*.json` |
| `@component` | component-definition | ❌ inline 禁止 (副作用 invocation) | `generic-definitions/component-definition/*.json` |
| `@fragment` | ui-fragment | ✅ pure ref | `generic-definitions/ui-fragment/*.json` |
| `@const` | constants catalog | ✅ pure ref (JS keyword 衝突回避で `@const` 採用) | `generic-definitions/constants/*.json` |
| `@msg` | message catalog (i18n) | ✅ pure ref + label override | `generic-definitions/message/*.json` |
| `@event` | domain-event | ✅ pure ref | `generic-definitions/domain-event/*.json` |
| `@logEvent` | log-event (構造化ログ) | ✅ pure ref | `generic-definitions/log-event/*.json` |
| `@logConfig` | log-config (log level / sink) | ✅ pure ref | `generic-definitions/log-config/*.json` |

(計 25 — `@var` は runtime scope 専用なので catalog 24 + runtime 1)。designer-time alias (`@this` / `@self`) は別表で §11 参照、含めると計 27。

## 2. 副作用 inline 禁止 (validator dispatch rule)

`${...}` (TemplateString 補間) / `runIf` / `BranchCondition.expression` 内では **pure 参照のみ許可**。以下は inline 禁止:

- ❌ `@flow.<id>(...)` (他 ProcessFlow 呼び出し → `commonProcess` step を使う)
- ❌ `@action.<id>(...)` (action 呼び出し → 不可、ProcessFlow 構造的に閉じている)
- ❌ `@step.<id>(...)` (step を関数として呼び出すのは不可、step は宣言的順序実行)
- ❌ `@component.<name>.<op>(...)` (component-definition 呼び出し → `componentCall` step を使う)

理由: `${...}` は **pure expression** であり、副作用 invocation を含むと「式評価が副作用を起こす」状態になり、AI 生成精度 / 認知 ROI / silent bug の根本対策に反する (RFC #1254 件 3.7 P3 で構造的事実として堅持)。

## 3. 階層参照 (`@screen.<id>.item.<id>` / `@table.<id>.field.<id>`)

画面項目 / テーブル列の参照は **`<entity>.<id>.<containerKey>.<childId>`** の階層形式 (#1254 件 3.7 user 確定、画面→項目 / テーブル→列の人間直感に整合):

```text
@screen.userLoginScreen.item.passwordInput.maxLength
@table.orders.field.order_number.physicalName
@view.activeUsers.field.user_email.type
@viewer.orderList.column.totalAmount.format
```

## 4. label override 構文 (`@<key>(args)[label]`)

参照 + 位置引数 + label 上書きを 1 行で表現:

```text
${@msg.orderConfirmed(orderNumber=@var.action.newOrderNumber)[注文確定]}
${@const.taxRate[消費税率]}
${@validation.isPositive(@var.flowParameter.quantity)[数量 > 0]}
```

- `(args)` 位置引数 / 名前付き引数の全 namespace で許容 (撤廃された制限 S-5、user 原則)
- `[label]` は UI 表示用の label 上書き (TemplateString 補間時に prefer)
- ネスト `${...}` および `@<key>` フル許容 (撤廃された制限 S-4、user 原則)

## 5. depth warning 撤廃 (dogfood driven)

参照 chain の深さ (`@var.foo.bar.baz.qux.quux`) に warning を出すか否かの depth 閾値は **本フェーズで撤廃** (撤廃された制限 S-6、user 原則「制限自体がコスト」)。dogfood で実害判明したら復活トリガー (#1265 S-6 ストック)。

## 6. inline ban の validator 実装

validator は AST レベルで以下を判定する dispatch rule を持つ:

```pseudo
walk(${...} 内 AST):
  IF node.type == 'MemberAccess' AND node.path[0] in BAN_LIST:
    BAN_LIST = ['flow', 'action', 'step', 'component', 'rule']
    emit error: "{path} は副作用 invocation のため `${...}` 内 inline 不可。{step kind} step を使うこと"
```

`@validation.<name>` は boolean return のみ許可 (`severity` / `errorCode` field 参照は副作用なしの pure call として扱う)。

## 7. Field annotation システム (`x-*` 拡張、#1254 件 3 / 件 7 verdict)

JSON Schema 標準の vocabulary を拡張する `x-*` annotation で、TemplateString 系 field の装飾 / 検証 / 型ヒントを per-field 制御する。validator / UI renderer が読み取り、schema の core validation には影響しない (annotation only)。

### 3 annotation

| annotation | 値域 | 意味 |
|---|---|---|
| `x-render` | `"markdown" / "plain" / "single-line"` | UI renderer の表示モード。`markdown` (default for Description / TemplateString) / `plain` (装飾無効、`${...}` 補間のみ) / `single-line` (改行禁止 + truncate、button label / 一覧 column header 等) |
| `x-expression-type` | `"boolean" / "number" / "string" / "object" / "array"` | `${...}` 評価結果の期待型。validator が compile-time に式の最外殻型を推定して mismatch を warning |
| `x-validator-key` | `"@validation.<name>"` 形式 string | 該当 field の追加検証を generic-definition/validation-rule にて宣言する。`@validation.<name>` で参照される validation-rule の boolean expression を「真であるべき条件」として適用 |

### 適用例 (per-field、schema 利用側)

```jsonc
{
  "properties": {
    "emailField": {
      "$ref": "common.v3.schema.json#/$defs/TemplateString",
      "x-render": "single-line",
      "x-expression-type": "string",
      "x-validator-key": "@validation.emailFormat"
    },
    "descriptionField": {
      "$ref": "common.v3.schema.json#/$defs/Description",
      "x-render": "markdown"
    },
    "isEnabledField": {
      "$ref": "common.v3.schema.json#/$defs/TemplateString",
      "x-expression-type": "boolean",
      "x-validator-key": "@validation.notNull"
    }
  }
}
```

### `x-validator-key` と `@validation` prefix の関係

`x-validator-key: "@validation.<name>"` で参照される validation-rule (generic-definitions/validation-rule/<Name>.json) は `boolean` を返す式である必要がある。validator は field 値を arg として渡し、false / undefined を返した場合は schema-level error として扱う。

`inline 許可 namespace` (§1 表) として `@validation.<name>(args)` は `${...}` 内でも直接呼出し可能、`x-validator-key` annotation は per-field の「常時適用」宣言。

### AJV strict mode との互換

JSON Schema 2020-12 では `x-*` keyword は未定義扱い (warning が出る環境あり)。AJV strict mode の場合は `addKeyword({ keyword: "x-render", ... })` 等で事前登録するか `strict: false` で読み飛ばす。validator / UI renderer 側でのみ semantic を持つ運用。

## 8. 関連仕様

- 親 RFC: [#1254](https://github.com/csilost2001/harmony/issues/1254) 件 3.7
- 実装: [#1263](https://github.com/csilost2001/harmony/issues/1263) Phase X2
- 変数モデル: [process-flow-variables.md](process-flow-variables.md)
- 式言語文法: [process-flow-expression-language.md](process-flow-expression-language.md)
- 撤廃制限ストック: [#1265](https://github.com/csilost2001/harmony/issues/1265)
- Generic Definition Catalog: [generic-definition-layer.md](generic-definition-layer.md)

## 9. 24 prefix broken-ref 検証 (#1269 提案 C)

`processFlowAntipatternValidator` Check 31 BROKEN_REFERENCE_MATURITY_AWARE は project catalog index (`frontend/src/schemas/projectCatalogIndex.ts`) を渡すことで本仕様 §1 の 24 prefix 全件を検証する。validator 実装範囲は以下の通り:

| prefix 群 | 検証ロジック | catalog source |
|---|---|---|
| `@var` / `@event` | flow context のみで検証 (project index 不要) | runtime scope / `context.catalogs.events` |
| `@screen` / `@table` / `@view` / `@viewer` | 2 段 ref で id 検証、4 段以上 (`<id>.<container>.<child>`) で child id 検証 | `screens/` / `tables/` / `views/` / `view-definitions/` |
| `@layout` / `@seq` / `@flow` / `@system` | head id 単純 lookup | `page-layouts/` / `sequences/` / `process-flows/` / `external.json#/externalSystems` |
| `@contract` / `@type` / `@exception` / `@rule` / `@validation` / `@behavior` / `@policy` / `@component` / `@fragment` | name lookup | `generic-definitions/<kind>/<Name>.json` |
| `@const` / `@msg` / `@logEvent` / `@logConfig` | catalog instance 名 + 全 catalog の fields[].name の union | 同上 (kind 別) |
| `@conv` | conventions top-level key + `extensionCategories.<name>` | `conventions/catalog.json` |
| `@ext` | extension namespace lookup | `extensions/<ns>.v3.json#/namespace` |

severity は maturity 連動 (`committed`=error / `draft`/`provisional`=warning)。projectCatalogIndex 未渡し時は @var / @event のみ検証 (silent pass on the rest、Phase X2 互換)。

`@this` / `@self` (designer-time alias、§11) は **#1322 Phase B-3a で validator-side context 注入完了**。`@this.action.<id>` を flow.actions[].id で検証、`@this.meta.<field>` を EntityMeta + ProcessFlow Meta 固有 field で検証、`@self.<field>` を step 共通 5 field (id / description / runIf / outputBinding / compensatesFor) で検証する。runtime / codegen 側の static ref への pre-resolve は §11.3 参照 (Phase B-3b で実装予定)。

## 10. 変更履歴

- 2026-05-23: 初版作成 (#1263 Phase X2 — RFC #1254 件 3.7 verdict 反映)
- 2026-05-23: §9 24 prefix broken-ref 検証 追加 (#1269 提案 C — Phase X2 follow-up)
- 2026-05-24: §11 designer-time alias (@this / @self) 追加 (#1301)
- 2026-05-24: §11 Phase B (#1308) — resolver layer を全 kind に拡張 + ProcessFlow editor へ bind。validator / runtime / codegen 側 (Phase B-3) は #1322 へ deferred
- 2026-05-24: §11.3 Phase B-3a (#1322) — validator context 注入完了。Phase B-3b (runtime/codegen pre-resolve) / B-3c (`/generate-code` skill 統合) は同 ISSUE 内の後続 commit で対応

## 11. designer-time alias (`@this` / `@self`、#1301 / #1308)

`@this` / `@self` は **designer (editor) の context** に依存する alias prefix。runtime では具体 `@screen.<id>.item.<id>` / `@flow.<id>` 等の static ref に展開される。

### 11.1 `@this` — root 設計書 alias

現在編集中の root 設計書を指す。editor 種別から自動展開:

| editor 種別 | `@this` が指すもの | example | resolver / 補完 bind 状態 |
|---|---|---|---|
| Screen 編集 (`/screen/items/:id` / `/screen/design/:id`) | `@screen.<currentScreenId>` | `@this.item.<otherItemId>.value` → `@screen.<curScrId>.item.<otherItemId>.value` | resolver: ✅、bind: ✅ (ScreenItemsView、Phase A) |
| ProcessFlow 編集 (`/process-flow/edit/:id`) | `@flow.<currentFlowId>` (※ inline 禁止規則は不変、designer alias としては許容) | `@this.action.<actionId>.outputBinding` / `@this.meta.flowType` (id / name / flowType は meta nested) | resolver: ✅、bind: ✅ (DbAccess.sql / EventPublish.payload / EventSubscribe.filter、Phase B) |
| Table 編集 (`/table/edit/:id`) | `@table.<currentTableId>` | `@this.field.<fieldId>.physicalName` | resolver: ✅、bind: ⏳ (式入力 UI 未導入、別 ISSUE 待ち) |
| View 編集 (`/view/edit/:id`) | `@view.<currentViewId>` | `@this.outputColumn.<name>` | resolver: ✅、bind: ⏳ (同上) |
| ViewDefinition 編集 | `@viewer.<currentViewDefId>` | `@this.column.<name>` | resolver: ✅、bind: ⏳ (同上) |
| Sequence 編集 | `@seq.<currentSequenceId>` | `@this.startValue` / `@this.physicalName` (collection 無し、flat 構造) | resolver: ✅、bind: ⏳ (同上) |
| PageLayout 編集 | `@layout.<currentPageLayoutId>` | `@this.region.<name>` (schema field `regions`) | resolver: ✅、bind: ⏳ (同上) |

実装範囲 (#1308 完了時点):

- **resolver 層**: 全 7 kind に対応 (Phase B で `thisResolver.ts` の `screen only` guard 解除、kind 別 top-level fields table + ProcessFlow `@this.action.<id>` 補完を追加)
- **editor bind 層**: Screen editor (Phase A、3 箇所) + ProcessFlow editor (Phase B、3 expression field) で完全動作。Table / View / ViewDefinition / Sequence / PageLayout の各 editor は現状 `ReferenceCompletionInput` / `ReferenceCompletionTextarea` を使う式入力 UI が未導入のため bind 対象なし。式入力 UI 自体の導入は別 feature ISSUE で別途検討
- **collection 補完** (`@this.<col>.<id>`): context に collection list が供給される場合のみ動作。screen.item は `ctx.currentScreenItems` (Phase A)、processFlow.action は `ctx.flow?.actions` (Phase B) を参照。他 collection (table.field / view.outputColumn 等) は context list 未供給で補完候補は空 (resolver は active を返すが candidates が 0 件)

### 11.2 `@self` — 現在編集中の要素 alias

現在 designer が編集している具体的な要素を指す。

| editor 種別 / context | `@self` が指すもの | example | resolver / 補完 bind 状態 |
|---|---|---|---|
| ScreenItemsView の items table 行編集 / events panel / effects 編集 / argumentMapping | 当該 ScreenItem | `@self.value` / `@self.id` / `@self.label` | resolver: ✅、bind: ✅ (Phase A) |
| ProcessFlowEditor の step 編集 (DbAccess / EventPublish / EventSubscribe body) | 当該 step | `@self.id` / `@self.outputBinding` / `@self.runIf` | resolver: ✅、bind: ✅ (Phase B、3 expression field) |
| TableEditor の column 編集 | 当該 column | `@self.physicalName` / `@self.dataType` / `@self.defaultValue` | resolver: ✅、bind: ⏳ (式入力 UI 未導入) |
| ViewEditor / ViewDefinitionEditor の column 編集 | 当該 column | 同上 | resolver: ✅、bind: ⏳ |
| PageLayoutEditor の region 編集 | 当該 region | `@self.name` / `@self.description` | resolver: ✅、bind: ⏳ |

実装範囲 (#1308 完了時点):

- **resolver 層**: kind = `screenItem` / `step` / `column` / `region` の 4 kind に対応 (Phase B で `selfResolver.ts` の `screenItem only` guard 解除、kind 別 default fields table を追加)
- **editor bind 層**: ScreenItem context (Phase A) + step context (Phase B、ProcessFlow editor 3 expression field) で完全動作。column / region context は bind 先 UI 未導入

### 11.3 designer-time alias の特性 + runtime / codegen pre-resolve 設計

`@this` / `@self` は **designer 補完・validator alias** として機能。runtime 評価時は static ref に **pre-resolve** される設計 (or codegen で展開)。

#### 段階別実装状況 (#1322 Phase B-3 系列)

| Phase | 領域 | ステータス | 説明 |
|---|---|---|---|
| A (#1301) | resolver (screen) + ScreenItem bind | ✅ 完了 | Screen editor の Phase A 限定 resolver、screenItem context |
| B (#1308) | resolver (全 7 kind) + ProcessFlow editor bind | ✅ 完了 | thisResolver/selfResolver の `screen only` guard 解除、全 kind 補完、ProcessFlow expression UI bind |
| B-3a (#1322) | validator context 注入 | ✅ 完了 | `processFlowAntipatternValidator` Check 31 で `@this/@self` を context-aware に検証 (本節 "validator 側の動作" 参照) |
| B-3b (#1322) | runtime / codegen 静的 pre-resolve | ✅ 完了 | `frontend/src/utils/reference-completer/designerAliasResolve.ts` を新設、`findDesignerAliases` / `resolveDesignerAlias` で `DesignerAliasResolution` discriminated union (8 kind + unresolved) を返す (本節 "runtime / codegen 静的 pre-resolve" 参照) |
| B-3c (#1322) | `/generate-code` skill 統合 | ✅ 完了 | `ai-skills/generate-code/SKILL.md` の Step 3-A / Step 3-B 冒頭に `@this/@self` 事前展開ガイダンスを追記、各 target 言語 (Java Spring Boot / TypeScript NestJS / Thymeleaf / React) の render 例を記載 |

#### validator 側の動作 (Phase B-3a 完了時点)

ProcessFlow を走査中、`processFlowAntipatternValidator` は **flow 自体を `@this` context、現在 walk 中の step を `@self` context** に常に bind し、Check 31 で以下を検証する:

| ref form | 検証ロジック |
|---|---|
| `@this.action.<actionId>.<...>` | `<actionId>` を `flow.actions[].id` で照合、不在は broken |
| `@this.meta.<field>.<...>` | `<field>` を EntityMeta (id/name/description/version/maturity/createdAt/updatedAt) + ProcessFlow Meta 固有 (flowType/screenId/apiVersion/mode/sla/primaryInvoker) で照合 |
| `@this.context.<...>` / `@this.expressionLanguage` | top-level field のみ照合、深い nested は loose pass (Phase B-3b の runtime evaluator 担当) |
| `@this.<unknown>` | unknown top-level → broken |
| `@self.<field>.<...>` | `<field>` を step 共通 5 field (id/description/runIf/outputBinding/compensatesFor) で照合、unknown は broken。step kind 固有 field (例: dbAccess.sql) は step body に直書きする規約なので `@self` 経由でアクセスしない設計 |

severity は他の broken-ref と同じく maturity 連動 (`committed`=error / `draft`/`provisional`=warning)。

#### runtime / codegen 静的 pre-resolve (Phase B-3b 実装、#1322 PR #1324)

`frontend/src/utils/reference-completer/designerAliasResolve.ts` を新設し、純粋関数 `findDesignerAliases(template, ctx)` / `resolveDesignerAlias(alias, segments, ctx)` で designer-time alias を **target 言語非依存** な構造化 `DesignerAliasResolution` (discriminated union、8 kind + unresolved) に展開する設計:

| `DesignerAliasResolution.kind` | 元 ref | 主な consumer |
|---|---|---|
| `flowAction` | `@this.action.<id>.<...>` (ProcessFlow editor) | `/generate-code` skill Step 3-A — Java `flow.findAction("...").path` / TS `flow.actions.find(...).path` |
| `flowMeta` | `@this.meta.<field>.<...>` | Meta 定数化 (`@MetaService.get("...")` / `FLOW_META.<field>`) |
| `flowContext` | `@this.context.<...>` | catalogs / variables / ambientVariables 直接アクセス |
| `flowExpressionLanguage` | `@this.expressionLanguage` | leaf、codegen 時 constant |
| `stepSelf` | `@self.<field>.<...>` (step context) | Java `this.field.<...>` (step メソッド内) / TS `step.<field>.<...>` |
| `screenItem` | `@this.item.<id>.<...>` (Screen editor) | React `formState.<id>.<path>` / Thymeleaf `${form.<id>.<path>}` |
| `screenTopLevel` | `@this.<field>` (Screen editor: id / name / purpose) | screen-level constant |
| `screenItemSelf` | `@self.<field>.<...>` (screenItem context) | React `this.<field>` / Thymeleaf `${this.<field>}` |
| `unresolved` | 解決失敗 (segments 空 / context 不在 / unknown field) | Phase B-3a validator で事前検出済の前提、生成 skip + warning |

設計方針:

- **pre-resolve タイミング**: コード生成時 (永続化 JSON はそのまま `@this/@self` を保持、`/generate-code` skill が展開) — runtime evaluator は alias を直接認識しない設計
- **責務分担**: 本 util は **alias 検出 + structured resolution** (target 言語非依存)、codegen target が `resolution.kind` を switch して target 言語の構文に render
- **例外処理**: 展開先 ref が存在しないケース (`flowAction` の actionId 不在 / `stepSelf` の unknown field 等) は Phase B-3a の validator で error として検出済 (= 設計者修正待ち)、`/generate-code` skill 側は fail-fast にレポートして生成中止
- **string-level 置換**: `DesignerAliasMatch.{offset, length, original}` で元 template の絶対位置を返すため、target 言語側の string templating engine と組み合わせやすい

詳細実装: [/generate-code skill SKILL.md の "designer-time alias の事前展開" 節](../../ai-skills/generate-code/SKILL.md) を参照。

### 11.4 prefix 一覧との関係 (§1 補足)

§1 の 24 prefix 表は **runtime catalog (24) + runtime scope `@var` (1) = 計 25** の canonical 一覧で、designer-time alias である `@this` / `@self` は性質が異なる (context 依存・editor 内のみで有効) ため §1 表には含めず、本 §11 で別表として扱う。両者を含めた総数は **計 27**。
