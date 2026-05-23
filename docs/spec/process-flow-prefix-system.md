# ProcessFlow 参照 prefix 24 種 + 階層参照 (`@<key>` 統一記法)

Issue: [RFC #1254](https://github.com/csilost2001/harmony/issues/1254) 件 3.7 / [#1263](https://github.com/csilost2001/harmony/issues/1263) Phase X2
策定日: 2026-05-23
ステータス: **v3 確定** — schema は `schemas/v3/` を一次成果物とし、本仕様で参照プロトコルを補足する

`ProcessFlow` schema 全体で使用する **`@<prefix>.<key>` 統一参照記法** の正規仕様。RFC #1254 件 3.7 の hybrid 11 file 構成と 1:1 対応する。

## 1. 24 prefix 一覧 (canonical 単層命名)

| prefix | 参照先 | inline 可否 (`${...}` 内) | catalog source |
|---|---|---|---|
| `@flow` | ProcessFlow entity (Uuid) | ❌ inline 禁止 (副作用 invocation) | `process-flows/<id>.json` |
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

(計 25 — `@var` は runtime scope 専用なので catalog 24 + runtime 1)

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

## 9. 変更履歴

- 2026-05-23: 初版作成 (#1263 Phase X2 — RFC #1254 件 3.7 verdict 反映)
