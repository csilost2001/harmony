# Schema v3 横断再設計案 (Opus 設計版)

| 項目 | 値 |
|---|---|
| ISSUE | #521 |
| 関連 | #519 (PR #520 マージ済 — v2 機械変換版) / #517 (PR #518 — 設計原則) |
| 起草 | 設計者 (Opus) — Sonnet/Codex 委譲なし、Opus 自身が全領域横断で再設計 |
| 起草日 | 2026-04-27 |
| ステータス | **方針提示** — ユーザー承認後に Phase 5 (実装) へ |

ユーザー指示 (2026-04-27 セッション 3 回目):

> アホか、いい加減にしろ。何度同じ失敗するんだ。
> 実装はどうでもいいからスキーマを全種類の設計書横断で見直せと言ってる。

これまで v2 (PR #520) は「v1 → v2 機械変換 + Q1-Q6 適用」レベル。各領域 schema は TS 型を JSON Schema 化しただけで、**横断的な構造改善は手付かず**だった。本ドキュメントは Opus 自身が全 21 schema を見渡して、横断的な再設計を提案する。

---

## §0 結論サマリ (5 行)

1. **共通 entity meta mix-in** を導入し、全 top-level entity の id/name/createdAt/updatedAt/version/maturity を 1 箇所で定義
2. **参照規範を 4 パターンに統一** (UUID 単独 / 複合 Ref / catalog key string / 式言語) — 物理名で entity を指す anti-pattern を全廃
3. **FieldType / Marker / DecisionRecord / GlossaryEntry を `common.v2` に集約** し全領域で再利用
4. **ProcessFlow root を `meta / context / body / authoring` の 4 セクションに再編** (現状 30+ 並列を整理)
5. **拡張機構を 10 ファイル → 1 ファイル統合**、namespace 単位で 1 ファイル運用 (`data/extensions/retail.json` 1 つで全種類の retail 拡張を完結)

加えて 6 項目の改善 (§3 参照)。

---

## §1 現状 v2 (PR #520) の構造的問題 — Opus が横断視点で発見

### 1.1 entity メタの揺れ

各領域の **identity (id/name/description) と timestamps (createdAt/updatedAt) と maturity** が領域ごとにバラバラに記述されている:

| entity | id | name | description | createdAt | updatedAt | version | maturity |
|---|---|---|---|---|---|---|---|
| ProcessFlow | Uuid | string | Description | T | T | SemVer | Maturity |
| TableDefinition | Uuid | DbTableName ★物理名 | string | T | T | × | × |
| ScreenNode | Uuid | string | string | T | T | × | × |
| ScreenItemsFile | (screenId) | × | × | × | T | SemVer | × |
| SequenceDefinition | Uuid | × ★name 無し | string? | T | T | × | × |
| ViewDefinition | Uuid | × ★name 無し | string? | T | T | × | × |
| CustomBlock | Uuid | × ★label のみ | × | T | T | × | × |
| Step (各 variant) | LocalId | × | string | × | × | × | Maturity |
| Action | LocalId | string | string | × | × | × | Maturity |

**問題点**:
- ScreenItemsFile に createdAt なし、name なし
- TableDefinition.name が物理名 (snake_case)、表示名は logicalName (日本語) に分離 — 他 entity と整合しない
- SequenceDefinition / ViewDefinition / CustomBlock に name フィールドなし (label と混在)
- maturity は ProcessFlow / Action / Step にあるが、それ以外 (Screen / Table / ScreenItem) には無い → 設計成熟度を Screen 単位で持てない
- version は ProcessFlow と ScreenItemsFile / ConventionsCatalog にあるが、Table / Screen には無い

### 1.2 参照パターンの混乱

参照を 7 種類見つけた:

| # | パターン | 例 |
|---|---|---|
| 1 | UUID 単独 (Pattern A 候補) | screenId, tableId, processFlowId |
| 2 | 複合参照 (Pattern B 候補) | screenItemRef: {screenId, itemId}, tableColumnRef: {tableId, columnId} |
| 3 | catalog key string (Pattern C 候補) | errorCode, domainRef, eventRef |
| 4 | 式言語 (Pattern D 候補) | @conv.* @secret.* @env.* @fn.* @<var> |
| 5 | **物理名で entity 指定 (anti-pattern)** | ConstraintDefinition.referencedTable: "users" ← 物理名 |
| 6 | **id と name の重複** | DbAccessStep.tableId + tableName, ScreenTransitionStep.targetScreenId + targetScreenName |
| 7 | 用途の異なるネスト ID | ScreenItem.options[].value (静的 master、参照ではない) |

**問題**:
- パターン 5 (物理名で entity 指定) は entity 側の rename で参照が壊れる
- パターン 6 (id+name 重複) は **どちらが正か曖昧**、保守時にドリフト

### 1.3 FieldType の分散

`process-flow.v2` と `screen-item.v2` で **別々に FieldType 定義**:
- process-flow.v2: object variants (array / object / tableRow / tableList / screenInput / file)
- screen-item.v2: string enum (string / number / boolean / date / object[] / string[] / number[]) のみ

**問題**:
- 拡張 fieldType を追加すると、両方に追加が必要になり同期負荷
- ProcessFlow の inputs と ScreenItem.type が同じ概念 (フィールドの型) を別表現
- 業界拡張 (extensions-field-type) が両方に効くべきだが、現状は曖昧

### 1.4 DB FK の二重定義

- `TableColumn.foreignKey: { tableId, columnName, noConstraint? }` — 単一カラム FK の inline 表現
- `ConstraintDefinition.kind="foreignKey": { columns, referencedTable, referencedColumns, onDelete, onUpdate }` — 複合 FK

**問題**:
- 単一カラム FK を 2 通りで書ける → どちらを使うか判断が要る
- Constraint 側は **物理名 (referencedTable) で参照** — anti-pattern (§1.2 #5)

### 1.5 ProcessFlow root の catalog 並列肥大

ProcessFlow root に 30+ プロパティ並列。catalog 系だけで 9 個 (errorCatalog / externalSystemCatalog / secretsCatalog / envVarsCatalog / domainsCatalog / functionsCatalog / eventsCatalog / glossary / decisions)、加えて ambientVariables / ambientOverrides / markers / testScenarios / actions / health / readiness / resources / sla / maturity / mode / apiVersion / version 等。

**問題**:
- 役割の異なるもの (実行用 catalog / 設計用 markers / テスト用 testScenarios) が **意味付けなく並列**
- 新 catalog 追加時に root が肥大化し続ける
- AI 実装者が「どこを読めばいい」かが分かりにくい

### 1.6 GrapesJS UI 座標と業務情報の混在

ScreenNode に **UI 座標 (position / size / thumbnail) と業務情報 (path / kind / hasDesign / groupId)** が混在。

**問題**:
- UI 座標は Designer (エディタ) 専用、業務実装には不要
- AI 実装者が ScreenNode を読むときに「position は実装で何に使うんだろう」と迷う
- ScreenNode が GrapesJS 仕様変更で揺らぐリスク

### 1.7 Marker / DecisionRecord / GlossaryEntry が ProcessFlow 専用

これらは本質的に **設計プロセス全体に関わる概念** だが、ProcessFlow root にしか持てない:

- markers: 人間 ↔ AI のマーカーは画面・テーブルでも必要 (画面項目への質問、テーブル設計への TODO 等)
- decisions (ADR): プロジェクト全体の決定もある (DB エンジン選定、認証方式選定 等)
- glossary: ドメイン用語はプロジェクト全体で共有すべき

### 1.8 拡張機構の細分化

v2 で 10 個の extensions schema (5 + 5)。業界拡張は 1 つの namespace で複数種類が必要だが、現状はファイル分散:
- `data/extensions/retail/steps.json`
- `data/extensions/retail/field-types.json`
- `data/extensions/retail/db-operations.json`
- ...

retail 業界の全拡張を見るには 5+ ファイルを開く必要がある。

### 1.9 設計画面のコード補完経路がバラバラ

ProcessFlowEditor は process-flow.v2 + extensions 合成 schema を読むが、TableEditor / ScreenItemEditor / Designer の補完経路は別実装になりがち。**プロジェクトで使う拡張 namespace の宣言** が現状ない。

### 1.10 enum 命名規範が暗黙のまま

UPPER (DataType / DbOperation / 等) と lowercase (SqlDialect / IndexMethod) と kebab (WorkflowPattern) と lowerCamelCase が混在。**規範文書 (#517 §2.2)** には書いたが、それは v1 schema の事実集計。v3 では **将来追加される enum がどの命名を取るべきか** の判断軸を明文化したい。

### 1.11 業務識別子規範の境界曖昧

- BusinessIdentifier (camelCase) — ScreenItem.id, StructuredField.name
- DbColumnName (snake_case) — TableColumn.name
- DbTableName (snake_case) — TableDefinition.name (← これが業務開発者には「物理名」と認識されるべき)

**問題**: TableDefinition.name は実態として **DB 物理名** だが、フィールド名が `name` だと「表示名」と誤読される。

---

## §2 v3 設計 (Opus 自身の判断)

### 2.1 共通 entity meta mix-in を `common.v2` に追加

```jsonc
// schemas/v2/common.v2.schema.json (追加 $defs)
{
  "$defs": {
    // 既存の Uuid / LocalId / Timestamp / SemVer / Description / MaturityLevel / ProcessMode 等

    "EntityMeta": {
      "description": "全 top-level entity (Screen / Table / ProcessFlow / View / Sequence / CustomBlock 等) が共有する meta 構造。各 entity の root に展開する。",
      "type": "object",
      "required": ["id", "name", "createdAt", "updatedAt"],
      "properties": {
        "id": { "$ref": "#/$defs/Uuid" },
        "name": { "type": "string", "description": "表示名 (人間向け)。物理名と異なる場合は physicalName で別管理。" },
        "description": { "$ref": "#/$defs/Description" },
        "version": { "$ref": "#/$defs/SemVer" },
        "maturity": { "$ref": "#/$defs/MaturityLevel" },
        "createdAt": { "$ref": "#/$defs/Timestamp" },
        "updatedAt": { "$ref": "#/$defs/Timestamp" }
      }
    },

    "LocalEntityMeta": {
      "description": "ネスト構造 (Step / Branch / Action / Index / Constraint / Trigger 等) が共有する meta。LocalId + 任意の maturity / notes。",
      "type": "object",
      "required": ["id"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "description": { "$ref": "#/$defs/Description" },
        "maturity": { "$ref": "#/$defs/MaturityLevel" },
        "notes": { "type": "array", "items": { "$ref": "#/$defs/StepNote" } }
      }
    }
  }
}
```

各 entity は **`allOf` で `EntityMeta` をマージ** + 固有プロパティを追加。これにより:
- 全 entity の id / name / createdAt / updatedAt 等が共通の型で参照される
- maturity が全 entity で持てる (現状は ProcessFlow / Action / Step のみ)
- AI 実装者は EntityMeta を 1 度学習すれば全 entity を読める

### 2.2 参照規範を 4 パターンに統一

#### Pattern A: `<entity>Id: Uuid` — top-level entity 単独参照

```jsonc
"screenId": { "$ref": "common.v2.schema.json#/$defs/Uuid" }
"tableId":  { "$ref": "common.v2.schema.json#/$defs/Uuid" }
"processFlowId": { "$ref": "common.v2.schema.json#/$defs/Uuid" }
```

#### Pattern B: `<entity>Ref: { ... }` — 複合参照 (entity 内のサブ要素を指す)

```jsonc
// common.v2 に追加
"ScreenItemRef": { "type": "object", "properties": { "screenId": Uuid, "itemId": BusinessIdentifier } }
"TableColumnRef": { ... }
"ActionRef": { "type": "object", "properties": { "processFlowId": Uuid, "actionId": LocalId } }
"StepRef": { ... }
"ResponseRef": { "type": "object", "properties": { "processFlowId": Uuid, "actionId": LocalId, "responseId": LocalId } }
```

#### Pattern C: catalog key 参照 — `string` (同一 entity 内 catalog のキー)

```jsonc
"errorCode": { "type": "string", "description": "errorCatalog のキー参照" }
"domainRef": { "type": "string", "description": "domainsCatalog のキー参照" }
```

これは catalog が ProcessFlow 等の同 entity 内で完結するため string で OK。

#### Pattern D: 式言語参照

```
@conv.tax.standard.rate
@secret.stripeApiKey
@env.STRIPE_API_BASE
@fn.calcTax(@subtotal, ...)
@<localVar>
$statusCode (Criterion 内のみ)
```

#### Anti-pattern (廃止)

| 廃止対象 | 修正先 |
|---|---|
| `ConstraintDefinition.referencedTable: "users"` (物理名) | `referencedTableId: Uuid` (Pattern A) |
| `DbAccessStep.tableId + tableName` (id と物理名併記) | `tableId: Uuid` のみ。tableName は実装が tableId で table.v2 を引いて取得 |
| `ScreenTransitionStep.targetScreenId + targetScreenName` | `targetScreenId` のみ |
| 「id と name の両方を持つ」全般 | id のみ。name は entity 側で取得 |

### 2.3 FieldType を `common.v2` に集約

```jsonc
// schemas/v2/common.v2.schema.json
"FieldType": {
  "description": "全領域 (ProcessFlow inputs/outputs / StructuredField / ScreenItem / domainsCatalog) で共有する型。",
  "oneOf": [
    { "type": "string", "enum": ["string", "number", "boolean", "date", "datetime", "json"] },
    { "type": "object", "required": ["kind", "itemType"], "additionalProperties": false,
      "properties": { "kind": { "const": "array" }, "itemType": { "$ref": "#/$defs/FieldType" } } },
    { "type": "object", "required": ["kind", "fields"], "additionalProperties": false,
      "properties": { "kind": { "const": "object" }, "fields": { "type": "array", "items": { "$ref": "#/$defs/StructuredField" } } } },
    { "type": "object", "required": ["kind", "tableId"], "additionalProperties": false,
      "properties": { "kind": { "const": "tableRow" }, "tableId": { "$ref": "#/$defs/Uuid" } } },
    { "type": "object", "required": ["kind", "tableId"], "additionalProperties": false,
      "properties": { "kind": { "const": "tableList" }, "tableId": { "$ref": "#/$defs/Uuid" } } },
    { "type": "object", "required": ["kind", "screenId"], "additionalProperties": false,
      "properties": { "kind": { "const": "screenInput" }, "screenId": { "$ref": "#/$defs/Uuid" } } },
    { "type": "object", "required": ["kind"], "additionalProperties": false,
      "properties": { "kind": { "const": "file" }, "format": { "type": "string" } } },
    { "type": "object", "required": ["kind", "extensionRef"], "additionalProperties": false,
      "properties": { "kind": { "const": "extension" }, "extensionRef": { "type": "string", "description": "namespace:fieldTypeKey 形式 (例: 'retail:productCode')" } } }
  ]
}
```

これで:
- ProcessFlow.inputs[].type / ScreenItem.type / DomainDef.type / TableColumn から派生する SchemaField で **同じ FieldType** を参照
- 業界拡張 fieldType は `kind: "extension"` + `extensionRef: "retail:productCode"` で参照 — schema を変えずに拡張可能

### 2.4 DB FK を ConstraintDefinition に集約

`TableColumn.foreignKey` を **完全削除**。すべての FK は `ConstraintDefinition.kind="foreignKey"` で表現:

```jsonc
"ForeignKeyConstraint": {
  "type": "object",
  "required": ["id", "kind", "columns", "referencedTableId", "referencedColumnIds"],
  "additionalProperties": false,
  "properties": {
    "id": { "$ref": "common.v2.schema.json#/$defs/LocalId" },
    "kind": { "const": "foreignKey" },
    "columns": { "type": "array", "items": { "$ref": "common.v2.schema.json#/$defs/LocalId" }, "description": "Column.id (LocalId) の配列" },
    "referencedTableId": { "$ref": "common.v2.schema.json#/$defs/Uuid" },
    "referencedColumnIds": { "type": "array", "items": { "$ref": "common.v2.schema.json#/$defs/LocalId" } },
    "onDelete": { "$ref": "#/$defs/FkAction" },
    "onUpdate": { "$ref": "#/$defs/FkAction" },
    "noConstraint": { "type": "boolean", "description": "true なら DDL に FK 制約を出力しない (論理 FK のみ)" },
    "description": { "$ref": "common.v2.schema.json#/$defs/Description" }
  }
}
```

単一カラム FK もここで表現 (`columns: ["col-u02"], referencedColumnIds: ["col-u01"]`)。これで FK 表現の一元化。

### 2.5 ProcessFlow root を 4 セクションに再編

```jsonc
{
  "$schema": "...",
  "$id": ".../schemas/v3/process-flow.v3.schema.json",
  "type": "object",
  "required": ["meta", "body"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },

    "meta": {
      "description": "ProcessFlow の identity と運用設定。",
      "type": "object",
      "required": ["id", "name", "kind", "createdAt", "updatedAt"],
      "additionalProperties": false,
      "properties": {
        "id": { "$ref": "common.v2.schema.json#/$defs/Uuid" },
        "name": { "type": "string" },
        "kind": { "$ref": "#/$defs/ProcessFlowKind" },
        "screenId": { "$ref": "common.v2.schema.json#/$defs/Uuid" },
        "description": { "$ref": "common.v2.schema.json#/$defs/Description" },
        "version": { "$ref": "common.v2.schema.json#/$defs/SemVer" },
        "apiVersion": { "type": "string" },
        "maturity": { "$ref": "common.v2.schema.json#/$defs/MaturityLevel" },
        "mode": { "$ref": "common.v2.schema.json#/$defs/ProcessMode" },
        "sla": { "$ref": "#/$defs/Sla" },
        "createdAt": { "$ref": "common.v2.schema.json#/$defs/Timestamp" },
        "updatedAt": { "$ref": "common.v2.schema.json#/$defs/Timestamp" }
      }
    },

    "context": {
      "description": "実行に必要な参照情報 (catalog 群 + ambient + 健全性 / リソース)。",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "catalogs": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "error": { "type": "object", "additionalProperties": { "$ref": "#/$defs/ErrorCatalogEntry" } },
            "externalSystem": { "type": "object", "additionalProperties": { "$ref": "#/$defs/ExternalSystemCatalogEntry" } },
            "secrets": { "type": "object", "additionalProperties": { "$ref": "#/$defs/SecretRef" } },
            "envVars": { "type": "object", "additionalProperties": { "$ref": "#/$defs/EnvVarEntry" } },
            "domains": { "type": "object", "additionalProperties": { "$ref": "#/$defs/DomainDef" } },
            "functions": { "type": "object", "additionalProperties": { "$ref": "#/$defs/FunctionDef" } },
            "events": { "type": "object", "additionalProperties": { "$ref": "#/$defs/EventDef" } }
          }
        },
        "ambientVariables": { "type": "array", "items": { "$ref": "#/$defs/StructuredField" } },
        "ambientOverrides": { "type": "object", "additionalProperties": { "type": "string" } },
        "health": { "$ref": "#/$defs/HealthCheckGroup" },
        "readiness": { "$ref": "#/$defs/ReadinessCheckGroup" },
        "resources": { "$ref": "#/$defs/ResourceRequirements" }
      }
    },

    "body": {
      "description": "実行ロジック (actions)。",
      "type": "object",
      "required": ["actions"],
      "additionalProperties": false,
      "properties": {
        "actions": { "type": "array", "items": { "$ref": "#/$defs/ActionDefinition" } }
      }
    },

    "authoring": {
      "description": "設計プロセス用情報 (実行に不要)。markers / testScenarios / decisions / glossary。これらは common.v2 に共通定義あり (§2.6 参照)。",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "markers": { "type": "array", "items": { "$ref": "common.v2.schema.json#/$defs/Marker" } },
        "testScenarios": { "type": "array", "items": { "$ref": "#/$defs/TestScenario" } },
        "decisions": { "type": "array", "items": { "$ref": "common.v2.schema.json#/$defs/DecisionRecord" } },
        "glossary": { "type": "object", "additionalProperties": { "$ref": "common.v2.schema.json#/$defs/GlossaryEntry" } }
      }
    }
  },
  "$defs": { ... }
}
```

**理由**:
- AI 実装者は `body` だけ読めば実装に十分、`authoring` は読まなくていい
- `context.catalogs` で全 catalog が 1 ヶ所に集まる、新 catalog 追加時に root が肥大化しない
- meta / context / body / authoring の 4 階層が、ProcessFlow を読むときの認知マップを与える

### 2.6 markers / decisions / glossary を `common.v2` に共通化

```jsonc
// common.v2.schema.json
"Marker": {
  "description": "人間 ↔ AI のメッセージマーカー。指示・質問・TODO・チャット。entity の authoring セクションで使用。",
  "type": "object",
  "required": ["id", "kind", "body", "author", "createdAt"],
  "additionalProperties": false,
  "properties": {
    "id": { "$ref": "#/$defs/Uuid" },
    "kind": { "type": "string", "enum": ["chat", "attention", "todo", "question"] },
    "body": { "type": "string" },
    "anchor": {
      "type": "object",
      "description": "マーカーが指す entity 内の位置情報",
      "properties": {
        "stepId": { "$ref": "#/$defs/LocalId" },
        "fieldPath": { "type": "string" },
        "shape": { "$ref": "#/$defs/MarkerShape" }
      }
    },
    "author": { "type": "string", "enum": ["human", "ai"] },
    "createdAt": { "$ref": "#/$defs/Timestamp" },
    "resolvedAt": { "$ref": "#/$defs/Timestamp" },
    "resolution": { "type": "string" }
  }
},
"DecisionRecord": { ... ProcessFlow.decisions と同じ構造 },
"GlossaryEntry": { ... 同上 }
```

各領域の schema (process-flow / table / screen / screen-item) は `authoring.markers` / `authoring.decisions` / `authoring.glossary` を持てる。

`FlowProject` (project root) も `authoring.glossary` / `authoring.decisions` を持つ — プロジェクト全体の用語集 / ADR。

### 2.7 GrapesJS UI 座標を別 schema に分離

`screen.v2.schema.json` を **業務情報のみ**にする:

```jsonc
"ScreenNode": {
  "allOf": [{ "$ref": "common.v2.schema.json#/$defs/EntityMeta" }],
  "type": "object",
  "required": ["kind", "path"],
  "additionalProperties": false,
  "properties": {
    "no": { "type": "integer", "minimum": 1 },
    "kind": { "$ref": "#/$defs/ScreenKind" },
    "path": { "type": "string", "description": "URL ルーティングパス (例: /customers, /customers/:id)" },
    "hasDesign": { "type": "boolean" },
    "groupId": { "$ref": "common.v2.schema.json#/$defs/Uuid" }
  }
}
```

UI 座標は新規 `schemas/v2/screen-layout.v2.schema.json` に分離:

```jsonc
"ScreenLayout": {
  "type": "object",
  "required": ["positions", "updatedAt"],
  "additionalProperties": false,
  "properties": {
    "positions": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["x", "y"],
        "properties": {
          "x": { "type": "number" },
          "y": { "type": "number" },
          "width": { "type": "number" },
          "height": { "type": "number" },
          "thumbnail": { "type": "string", "description": "data URL" }
        }
      }
    },
    "updatedAt": { "$ref": "common.v2.schema.json#/$defs/Timestamp" }
  }
}
```

データファイル: `data/screen-flow-positions.json` (er-layout.json と並列)。旧名: `data/screen-layout.json` (#1029 でリネーム)。

### 2.8 拡張機構を 1 ファイル統合

10 個の extensions schema → **`schemas/v2/extensions.v2.schema.json` 1 ファイル** に統合:

```jsonc
{
  "$schema": "...",
  "$id": ".../schemas/v2/extensions.v2.schema.json",
  "title": "Extensions v2 (統合拡張定義)",
  "description": "業界・業態別 (retail / finance / manufacturing 等) の全種類の拡張を 1 namespace = 1 ファイルで定義する。",
  "type": "object",
  "required": ["namespace"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "namespace": { "$ref": "common.v2.schema.json#/$defs/NamespaceId" },
    "version": { "$ref": "common.v2.schema.json#/$defs/SemVer" },
    "requiresCoreSchema": { "type": "string" },
    "deprecated": { "type": "boolean" },
    "description": { "$ref": "common.v2.schema.json#/$defs/Description" },

    "fieldTypes": { "type": "array", "items": { "$ref": "#/$defs/CustomFieldType" } },
    "dataTypes": { "type": "array", "items": { "$ref": "#/$defs/CustomDataType" } },
    "triggers": { "type": "array", "items": { "$ref": "#/$defs/CustomTrigger" } },
    "dbOperations": { "type": "array", "items": { "$ref": "#/$defs/CustomDbOperation" } },
    "screenTypes": { "type": "array", "items": { "$ref": "#/$defs/CustomScreenType" } },
    "steps": { "type": "object", "additionalProperties": { "$ref": "#/$defs/CustomStepDef" } },
    "responseTypes": { "type": "object", "additionalProperties": { "$ref": "#/$defs/CustomResponseTypeDef" } },
    "valueSources": { "type": "array", "items": { "$ref": "#/$defs/CustomValueSourceKind" } },
    "columnTemplates": { "type": "array", "items": { "$ref": "#/$defs/CustomColumnTemplate" } },
    "constraintPatterns": { "type": "array", "items": { "$ref": "#/$defs/CustomConstraintPattern" } },
    "conventionCategories": { "type": "array", "items": { "$ref": "#/$defs/CustomConventionCategory" } }
  },
  "$defs": { /* 11 の Custom* 型 */ }
}
```

データ運用:
- `data/extensions/retail.v2.json` 1 ファイル → retail 業界の全拡張 (steps + fieldTypes + screenTypes + dbOperations + ...)
- `data/extensions/finance.v2.json` 1 ファイル → finance 業界の全拡張
- 旧 v2 の `data/extensions/<ns>/*.json` 5 ファイル分散から **`data/extensions/<ns>.v2.json` 1 ファイルに統合**

10 個の extensions schema は不要になり削除。

### 2.9 設計画面コード補完経路の統一

`project.v2.schema.json` (FlowProject) に `extensionsApplied` を追加:

```jsonc
"FlowProject": {
  ...,
  "properties": {
    ...,
    "schemaVersion": { "type": "string", "enum": ["v2", "v3"], "description": "プロジェクトが使う schema バージョン" },
    "extensionsApplied": {
      "type": "array",
      "items": { "$ref": "common.v2.schema.json#/$defs/NamespaceId" },
      "description": "本プロジェクトが適用する拡張 namespace 一覧。loader はこれを読んで合成 schema を組み立てる。"
    }
  }
}
```

全 editor (ProcessFlowEditor / TableEditor / ScreenItemEditor / Designer) は 同一 loader 関数で:
1. project.v2 を読み extensionsApplied を取得
2. 各 namespace の `data/extensions/<ns>.v2.json` を読む
3. core schema + extensions を merge した合成 schema を返す
4. validator + IDE 補完で合成 schema を使用

### 2.10 enum 命名規範の文書化

`schemas/README.md` (or schema-design-principles.md) に明文化:

| ドメイン | 命名 | 例 |
|---|---|---|
| SQL keyword 由来 | `UPPER` | `DataType` (`VARCHAR`), `DbOperation` (`SELECT`), `TriggerTiming` (`BEFORE`) |
| HTTP 由来 | `UPPER` | `HttpMethod` (`GET`, `POST`) |
| TX/EE 由来 | `UPPER_SNAKE` | `TransactionIsolationLevel` (`READ_COMMITTED`), `TransactionPropagation` (`REQUIRED`) |
| ベンダ慣習 (lowercase 慣習) | `lowercase` | `SqlDialect` (`postgresql`), `IndexMethod` (`btree`) |
| Workflow / BPM 業界 | `kebab-case` | `WorkflowPattern` (`approval-sequential`), `ad-hoc` |
| ER モデリング | `kebab-case` | `ErCardinality` (`one-to-many`) |
| **その他 (新規 enum / 値オブジェクト discriminator)** | **`lowerCamelCase`** | `StepKind` (`validation`, `dbAccess`), `ConstraintKind` (`foreignKey`), `ValidationRuleKind` (`error`) |

判断軸:
- 業界・業務開発者の認知慣習がある場合はそれに従う
- それ以外は **lowerCamelCase デフォルト**
- 新規 enum を追加する設計者は、上表のドメインに該当するか確認、該当しなければ lowerCamelCase

### 2.11 業務識別子規範の整理 (TableDefinition の例)

現状: `TableDefinition.name` が DB 物理名 (snake_case)、表示名は `logicalName` (日本語)

v3: **`physicalName` と `name` (表示名) を分離**

```jsonc
"TableDefinition": {
  "allOf": [{ "$ref": "common.v2.schema.json#/$defs/EntityMeta" }],  // id / name / description / createdAt / updatedAt / version / maturity
  "type": "object",
  "required": ["physicalName", "columns"],
  "additionalProperties": false,
  "properties": {
    "physicalName": { "$ref": "common.v2.schema.json#/$defs/DbTableName", "description": "DB 物理名 (snake_case)。例: 'users', 'order_items'" },
    "category": { "type": "string" },
    "columns": { "type": "array", "items": { "$ref": "#/$defs/TableColumn" } },
    "indexes": { "type": "array", "items": { "$ref": "#/$defs/IndexDefinition" } },
    "constraints": { "type": "array", "items": { "$ref": "#/$defs/ConstraintDefinition" } },
    "defaults": { "type": "array", "items": { "$ref": "#/$defs/DefaultDefinition" } },
    "triggers": { "type": "array", "items": { "$ref": "#/$defs/TriggerDefinition" } },
    "comment": { "type": "string", "description": "DDL レベルの COMMENT (DB に保存されるコメント)" }
  }
}
```

TableDefinition.name (EntityMeta から継承) が表示名、TableDefinition.physicalName が DB 物理名。AI 実装者が「表示名と物理名を取り違えない」明確な規範になる。

`TableColumn` も同様:
```jsonc
"TableColumn": {
  "type": "object",
  "required": ["id", "physicalName", "name", "dataType"],
  "additionalProperties": false,
  "properties": {
    "id": { "$ref": "common.v2.schema.json#/$defs/LocalId" },
    "no": { "type": "integer" },
    "physicalName": { "$ref": "common.v2.schema.json#/$defs/DbColumnName" },
    "name": { "type": "string", "description": "表示名 (日本語可)。logicalName の後継。" },
    "dataType": { "$ref": "#/$defs/DataType" },
    ...
  }
}
```

`logicalName` を廃止し `name` (表示名) に統一、`physicalName` を新設。entity 全領域で **`name = 表示名 / physicalName = システム識別子`** の規範を一貫させる。

ScreenNode も:
```
ScreenNode.name (表示名: "顧客一覧")
ScreenNode.path (URL パス: "/customers") ← physicalName 相当
```

これで **「name = 人間が見る名前、physicalName = システムが使う名前 (DB / URL / etc.)」**の規範が全領域で立つ。

---

## §3 採用しない選択肢 (棄却理由付き)

### A. 「全 ID を UUID 統一」(v2 議論で既出)
棄却 — Step.id 等の階層性が読めなくなる。

### B. 「全 enum を lowerCamelCase 統一」
棄却 — SQL / HTTP の業界慣習を破壊する。

### C. 「ProcessFlow root 30+ プロパティをそのまま並列」
棄却 — 本 v3 で `meta / context / body / authoring` の 4 階層化を導入。

### D. 「FieldType を ProcessFlow と ScreenItem で別々に持つ」(v2 で採用)
棄却 — common.v2 に集約 (§2.3)。

### E. 「Marker / Decision / Glossary を ProcessFlow root だけ」(v1/v2)
棄却 — 全領域で必要なので common.v2 に共通化 (§2.6)。

### F. 「拡張機構を 10 ファイル分散」(v2 で採用)
棄却 — 1 ファイル統合 (§2.8)。namespace 単位の運用が自然。

### G. 「TableDefinition.name = 物理名」(v1/v2 で採用)
棄却 — 表示名と物理名を `name` / `physicalName` に分離 (§2.11)。

### H. 「TableColumn.foreignKey の inline 表現を残す」
棄却 — ConstraintDefinition に集約 (§2.4)。

### I. 「ScreenNode に position / size / thumbnail 含める」(v1/v2)
棄却 — UI 座標は別 schema (`screen-layout.v2`) に分離 (§2.7)。

### J. 「式言語を `{ lang, src }` object 化」(v1/v2 で既出棄却)
棄却維持 — convention で 1 言語固定。

---

## §4 実装ロードマップ (Opus 自身が手で進める、委譲なし)

### Step 5-1: common.v2 拡張

- EntityMeta / LocalEntityMeta 追加
- FieldType 集約
- StructuredField を common.v2 に移動
- Marker / DecisionRecord / GlossaryEntry / StepNote / MarkerShape を common.v2 に移動
- ScreenItemRef / TableColumnRef / ActionRef / StepRef / ResponseRef 追加
- 命名規範を README に追記

### Step 5-2: process-flow.v3 を再起草

- root を `meta / context / body / authoring` の 4 セクションに再編
- catalogs を `context.catalogs.<kind>` に集約
- string union / 旧 note / deprecated field 全廃 (v2 で実施済み、v3 でも継続)
- Step variant を common.v2 の StepBaseProps + variant 固有で再構築
- markers / testScenarios / decisions / glossary を authoring に
- common.v2 への $ref を最大化

### Step 5-3: table.v3 を再起草

- physicalName と name (表示名) を分離
- TableColumn.foreignKey 削除、ConstraintDefinition に集約
- ConstraintDefinition.referencedTable → referencedTableId (Uuid)
- EntityMeta を allOf でマージ

### Step 5-4: screen.v3 + screen-flow-positions.v3 分離 (旧称: screen-layout.v3、#1029 でリネーム)

- screen.v3: 業務情報のみ (EntityMeta + path / kind / hasDesign / groupId)
- screen-flow-positions.v3: UI 座標 (positions / groupPositions / thumbnails)

### Step 5-5: screen-item.v3 / project.v3 / er-layout.v3 / custom-block.v3 / sequence.v3 / view.v3 を再起草

- 各 entity に EntityMeta or LocalEntityMeta を allOf
- 参照を Pattern A/B/C/D に統一
- ScreenItem の name (表示名) と id (BusinessIdentifier) を整理

### Step 5-6: extensions.v3 統合 schema 新設

- 1 ファイルに 11 種の Custom* 型を集約
- 旧 10 ファイル削除
- README 更新

### Step 5-7: spec 文書更新

- schema-design-principles.md (PR #518) を v3 反映
- schema-v2-design.md (#519) は撤回 (v2 の機械変換版なので、v3 が完成版)

### 統合 PR

ブランチ: `feat/issue-521-schema-opus-redesign` (既存 worktree)

すべて Opus 自身が手で書く。Sonnet/Codex 委譲しない。

---

## §5 ユーザー判断ポイント (Q1-Q5)

### Q1: ProcessFlow root の 4 セクション化 (`meta / context / body / authoring`)

これが最大の構造変更。process-flow JSON のすべてが書き換えになる。

**推奨**: (a) 4 セクション化採用 / (b) 並列維持

### Q2: catalogs の階層化 (errorCatalog 等を `context.catalogs.error` に移動)

### Q3: TableDefinition / TableColumn の `physicalName` 分離

`name` を表示名、`physicalName` を DB 物理名に。

### Q4: 拡張機構の 1 ファイル統合

10 ファイル → 1 ファイル (`extensions.v2.schema.json`)、namespace 単位運用。

### Q5: ScreenNode から UI 座標を分離 (screen-flow-positions.v3 新設、旧称: screen-layout.v3)

---

## §6 承認パターン

- **「OK / 進めて」** → Q1-Q5 すべて推奨案 (a) で Step 5-1 着手
- **「Q<N> は (b)」** → 該当のみ変更
- **「全体見直し」** → 本ドキュメント修正

ご判断お願いします。
