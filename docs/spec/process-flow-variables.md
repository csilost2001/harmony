# 処理フローの入出力・変数構造化

Issue: #152 (親トラッキング: #151) / #525 R3 fix で StepBaseProps.lineage 透過 / #533 R3-1 で IdentifierPath 化 / **#539 で v3 schema 反映**
策定日: 2026-04-20
**改訂日: 2026-04-28 (v3 反映 — schema は v3.0.2 で確定)**
ステータス: **v3 整合性確保** — データモデルは v3 schema (`schemas/v3/`) を一次成果物とし、本仕様で意図と慣例を補足する

本ドキュメントは、処理フローの **入出力とステップ間の変数受け渡し** を構造化して、AI エージェントが実装時に関数シグネチャと中間変数を明確に決められるようにする仕様を定める。

## 1. 目的

現状の処理フローは:

- `inputs` / `outputs` が「改行区切り自由テキスト」
- ステップ間のデータ受け渡しが `description` の自由文で表現
- 条件式 / ループソース / 表示対象が自由テキスト

これにより AI エージェントは実装時に以下で迷う:

- 各入出力の**型・必須性**が不明 → 関数シグネチャが決まらない
- DB 検索結果 → 後続ステップでの**参照方法**が不明 → 中間変数名を推測
- 共通処理呼び出し時の**引数マッピング**が書けない
- 条件式内のフィールド参照が識別子か自然言語か不明

本仕様は、これを「**自由テキスト併用可能・漸進的に構造化**」な形式に拡張する。全か無かではなく、書ける範囲だけ構造化する。

## 2. 背景

2026-04-20 のドッグフード結果:

- 「Top 3 不足項目」の **1 位**「共通のコード採番ポリシーおよび outputs で保持する変数の型・命名」
- 曖昧さパターン **A (変数の受け渡し方法)** が全 4 サンプルで頻出
- パターン **C (DB 操作の詳細)** で INSERT/UPDATE のフィールド順・省略項目・採番が不明と指摘

## 3. 概念モデル (4 ピース)

### 3.1 入出力の構造化 (v3)

`ActionDefinition.inputs` / `outputs` は **`StructuredField[]` のみ** (v3 で string 短縮形廃止):

```ts
interface StructuredField {
  name: string;                    // Identifier (camelCase 強制)
  label?: string;                  // 表示名 (例: "ユーザーID")
  type: FieldType;
  required?: boolean;
  description?: string;
  format?: string;                 // 採番形式 / @conv.numbering.* 参照
  defaultValue?: string;           // 既定値 (式可)
  screenItemRef?: ScreenItemRef;   // Pattern B 参照 (画面項目)
  formula?: ExpressionString;      // 派生属性の計算式
}

// FieldType (common.v3.schema.json#/$defs/FieldType) — v3 の確定形
type FieldType =
  | "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "json"  // プリミティブ 7 種
  | { kind: "array"; itemType: FieldType }
  | { kind: "object"; fields: StructuredField[] }
  | { kind: "tableRow"; tableId: Uuid }
  | { kind: "tableList"; tableId: Uuid }
  | { kind: "screenInput"; screenId: Uuid }
  | { kind: "domain"; domainKey: string }              // PascalCase、context.catalogs.domains 参照
  | { kind: "file"; format?: string }                  // CSV/ZIP/PDF 等
  | { kind: "extension"; extensionRef: string };       // namespace:fieldType 形式 (例: 'retail:productCode')

interface ActionDefinition {
  inputs?: StructuredField[];
  outputs?: StructuredField[];
}
```

**v3 での廃止**:
- `string` 短縮形 (改行区切り) — 全部 `StructuredField[]` で記述
- `kind: "custom"` (deprecated) — array/object/extension で代替

**v3 で追加**:
- `integer` プリミティブ (number と区別)
- `datetime` プリミティブ (date と区別)
- `json` プリミティブ (任意の構造化データ)
- `kind: "domain"` (context.catalogs.domains 参照)
- `kind: "file"` (バッチ I/O 等)
- `kind: "extension"` (namespace:identifier、業界別拡張)

### 3.2 ステップの出力変数 (Output Binding) — v3 構造化のみ

```ts
// v3 で string 短縮形廃止、object 形式に統一
type OutputBindingOperation = "assign" | "accumulate" | "push";

interface OutputBindingTransformation {
  field: string;                                         // 変換対象 column 名 (SELECT alias 名)
  type: "integer" | "float" | "boolean" | "date" | "json"; // 変換後の型
}

interface OutputBinding {
  name: string;                            // Identifier (camelCase 強制)
  operation?: OutputBindingOperation;      // 既定 "assign"
  initialValue?: string;                   // accumulate: "0", push: "[]" 相当 (式可)
  transformations?: OutputBindingTransformation[]; // SELECT 結果の型変換 (#781)
}

interface StepBaseProps {
  outputBinding?: OutputBinding;  // 例: { name: "users" } / { name: "subtotal", operation: "accumulate", initialValue: "0" }
}
```

operation の意味:
- `assign` (既定): 上書き代入
- `accumulate`: `+=` で数値累積 (例: 税額計算の積算)
- `push`: 配列の末尾追加 (例: ループ内で enrichedItems を構築)

#### transformations — DB 方言吸収 (#781)

`transformations` は SQL の SELECT 結果を binding に格納する前に runtime が型変換するための宣言。**SQL 側に `CAST(...)` を書かずに DB 中立な SQL を保ちつつ**、PG 固有の型変換問題を吸収できる。

| type | 変換処理 | 主なユースケース |
|------|----------|----------------|
| `integer` | `parseInt(value, 10)` | PG `COUNT(*)`→bigint→string |
| `float` | `parseFloat(value)` | PG `SUM(amount)`→decimal→string |
| `boolean` | truthy 判定 | PG `bool` 値→string "t"/"f" |
| `date` | `new Date(value)` | ISO 日付文字列→Date オブジェクト |
| `json` | `JSON.parse(value)` | JSON 文字列→オブジェクト |

**適用範囲**:
- `transformations` は `dbAccess` step の `outputBinding` に対して適用される。
- `transactionScope` の outputBinding (`txResult.committed` / `txResult.error`) には適用されない (txResult はフレームワークが型付きで expose するため変換不要)。

**AI 実装時のルール**:
1. PG `COUNT(*)` / `SUM(...)` / `AVG(...)` 等の集約関数を使う `dbAccess` step は、後続で数値比較する場合 `transformations` で `integer` または `float` を宣言する
2. SQL 側では PG 等の DB 固有の `CAST(COUNT(*) AS INTEGER)` 等の構文を書かず、`transformations` 経由で runtime に吸収させる (DB 中立な SQL を保つため)
3. `field` には SELECT の alias 名を指定する (例: `"itemCount"`, `"totalAmount"`)

**例 (retail カート追加フロー)**:

```json
{
  "id": "step-09",
  "kind": "dbAccess",
  "operation": "SELECT",
  "sql": "SELECT COUNT(*) AS \"itemCount\" FROM cart_items WHERE cart_id = @cart.id",
  "outputBinding": {
    "name": "cartItemCount",
    "transformations": [
      { "field": "itemCount", "type": "integer" }
    ]
  }
}
```

後続の `@cartItemCount.itemCount >= @conv.limit.cartMaxItems` は数値比較として正しく評価される。

対応ステップタイプ (v3):

| Step kind | 出力変数 | 例 |
|---|---|---|
| `dbAccess` (SELECT/INSERT) | ✓ (既定候補: テーブル名) | `{ name: "rows" }` / `{ name: "createdOrder" }` (RETURNING) |
| `commonProcess` | ✓ | `{ name: "authResult" }` |
| `externalSystem` | ✓ | `{ name: "paymentResponse" }` |
| `compute` | ✓ | `{ name: "totalValuation" }` |
| `loop` (collection mode) | ✓ (operation=push 推奨) | `{ name: "bomComponents", operation: "push", initialValue: "[]" }` |
| `validation` | ✕ (`fieldErrorsVar` で出力先) | — |
| `branch` / `loopBreak` / `loopContinue` / `jump` | ✕ (制御構造) | — |
| `screenTransition` / `displayUpdate` | ✕ (副作用のみ) | — |
| `eventPublish` / `eventSubscribe` / `audit` / `log` | ✕ (副作用のみ) | — |
| `transactionScope` / `closing` / `cdc` / `workflow` | ✕ (制御構造、内部 step が outputBinding 持つ) | — |
| `extension` (拡張 step) | ✓ | `{ name: "creditCheckResult" }` |

空欄なら「この名前では参照できない」でよい。強制しない。

### 3.3 参照補完 (`@` 記法)

ExpressionString 内で **`@` プレフィックス**を使った補完可能参照を使用:

```
@users[0].role          # users 配列の先頭要素の role
@authResult.userId      # authResult オブジェクトの userId
@userId                 # そのアクションの入力値
@inputs.userId          # 全体参照スタイル (推奨)
@createdOrder.order_number  # IdentifierPath (#533 R3-1、underscore セグメント可)
@conv.regex.email       # Conventions catalog 参照
@secret.apiKey          # secrets catalog 参照
@env.STRIPE_API_BASE    # envVars catalog 参照
@fn.calculateTotal(@a, @b) # functions catalog 参照
```

対象フィールド (v3): 詳細は [`process-flow-expression-language.md`](process-flow-expression-language.md) §6 を参照。

ScreenItem.valueFrom.flowVariable.variableName は **IdentifierPath** ($defs in common.v3) で field 参照可:

```jsonc
"valueFrom": {
  "kind": "flowVariable",
  "variableName": "createdOrder.order_number"  // ← #533 R3-1 fix で許容
}
```

動作:

- `@` 押下で UI ポップアップ、そのステップまでに定義された変数 + アクションの inputs + ambient + catalog を候補表示
- ↑↓ で選択、Enter で確定
- catalog 参照 (`@conv.*` / `@secret.*` / `@env.*` / `@fn.*`) は別グループで表示
- **厳密な型チェックはしない** (構文的補完のみ、将来の参照整合性バリデータで強化)

### 3.4 共通処理の引数マッピング (v3)

`CommonProcessStep` (kind="commonProcess"):

```ts
interface CommonProcessStep extends StepBaseProps {
  kind: "commonProcess";
  description: string;
  refId: Uuid;                                   // 呼び出し先 ProcessFlow の Uuid (kind="common")
  argumentMapping?: Record<string, ExpressionString>;
  // キー: 呼び先 inputs.name (Identifier)
  // 値: 値表現 (式)
  returnMapping?: Record<string, string>;
  // キー: 呼び先 outputs.name
  // 値: 説明 / バインド先
}
```

UI: `refId` 選択時、呼び先フローの `inputs` を自動展開して対応表が現れる:

```
共通処理: 認証チェック
  呼び先の入力:
    sessionId     → [@session.id         ]
    trustedLevel  → ['high'               ]
```

### 3.5 変数スコープ

- **アクション単位**がスコープの単位
- アクション内の `outputBinding` は、そのステップ以降・同一アクション内で参照可能
- 分岐・ループ内で定義した変数は、その分岐・ループを抜けると参照不可 (v1 では警告のみ、禁止にはしない)
- アクションの `inputs` はアクションの先頭から参照可能

## 4. UI 要素

### 4.1 入出力の表形式エディタ (Phase 1)

現在の改行区切りテキストエリアを次の表に置換 (切替可能):

```
┌─ 入力 ──────────────────────────────────────────────┐
│  名前       | 型        | 必須 | 説明           [+] │
│  userId     | 文字列    | ✓    | ログイン ID        │
│  password   | 文字列    | ✓    |                    │
└─────────────────────────────────────────────────────┘
[自由記述モードに戻す]
```

- **自由記述モード ↔ 表形式** のトグルがあり、いつでも行き来可能
- 表形式から自由記述に戻すと、改行区切りのテキストに再シリアライズ (name のみ)
- 自由記述から表形式に切り替えると、改行区切りを `StructuredField[]` に自動変換 (name のみ、type=`"string"` 既定)

### 4.2 ステップカードの出力変数欄 (Phase 2)

該当ステップタイプのカードに「結果変数名」欄を追加:

```
┌─ DB 検索 (customers) ────────────────┐
│  検索条件: email = @email             │
│  結果を: [duplicates             ]    │
└───────────────────────────────────────┘
```

### 4.3 `@` 補完付き参照入力 (Phase 3)

自由テキストフィールド内で `@` 入力時にポップアップ:

```
条件: @users
         ┌──────────────────────────────────────┐
         │ users      (DB検索結果, users テーブル) │ ← 矢印キー
         │ userId     (入力)                      │
         │ authResult (共通処理戻り値)            │
         └──────────────────────────────────────┘
```

候補は、そのステップまでに定義された `outputBinding` + アクションの `inputs.name`。Esc で閉じる、選択しなくても自由テキストとして保存可能。

### 4.4 共通処理の引数マッピング UI (Phase 4)

共通処理カードに、呼び先 `inputs` が自動展開される専用エリア:

```
共通処理: 認証チェック [ref: cccccccc-0003 ▼]
───────────────────────────────────────
呼び先の入力:
  sessionId    → [@session.id       ] (文字列)
  trustedLevel → ['high'             ] (文字列)
```

値側入力は §4.3 の `@` 補完が利く。

### 4.5 型のテーブル・画面連携 (Phase 5, 任意)

型ドロップダウンに:

- `テーブル: users の 1 行`
- `テーブル: users の配列`
- `画面: ログイン画面の入力`

を追加。選択するとその型のフィールド一覧が自動的に利用可能に。

## 5. データモデル (v3 確定形、後方互換廃止)

v3 で string 短縮形は全廃止。v1/v2 サンプルから v3 への移行は人手必要 (機械変換不能、`schemas/v3/README.md` の v1→v3 マッピング表参照)。

### 5.1 v3 確定型

| 型 | フィールド | 確定 |
|---|---|---|
| `ActionDefinition.inputs` | — | `StructuredField[]` のみ (string 短縮形廃止) |
| `ActionDefinition.outputs` | — | 同上 |
| `StepBaseProps` | `outputBinding?: OutputBinding` | object 形式のみ (string 短縮形廃止) |
| `StepBaseProps` | `lineage?: DataLineage` | **#525 R3 fix で StepBaseProps に移植**、全 step variant で利用可能 |
| `CommonProcessStep` | `argumentMapping?: Record<string,ExpressionString>` | 確定 |
| `ProcessFlow.context.ambientVariables` | `StructuredField[]` | **#525 R3 fix で context 配下に統一** (v1/v2 では root 直下) |
| `ScreenItem.valueFrom.flowVariable.variableName` | `IdentifierPath` | **#533 R3-1 fix で IdentifierPath (camelCase + snake_case + dot path) に変更** |

### 5.2 v1/v2 → v3 マッピング (機械変換不能、人手必須)

詳細は `schemas/v3/README.md` の v1→v3 マッピング表参照。主な変更:

- `inputs: "name1\nname2"` (改行区切り) → `inputs: [{ name: "name1", type: "string" }, ...]`
- `outputBinding: "users"` (string) → `outputBinding: { name: "users" }` (object)
- `valueFrom: { kind: "flowVariable", variableName: "users" }` (Identifier 単独) はそのまま、object field 参照 (`createdOrder.order_number`) を新規許容

## 6. 型システム (v1 の範囲)

v1 は**構文レベルのみ**:

- `FieldType` の 5 基本型は文字列定数として保存
- `tableRow` / `tableList` は `tableId` の参照整合性だけ検査 (存在する ID か)
- `@` 参照のパスは検索可能な識別子列として保存 (ドット/インデックス解釈は実装側)
- 型ミスマッチの実行時検査はしない

## 7. Phase 分け

| Phase | 内容 | 視覚影響 | 規模 |
|---|---|---|---|
| 1 | 入出力の表形式エディタ + `StructuredField[]` 保存 + モード切替 | 中 | 中 |
| 2 | ステップの `outputBinding` 欄 | 小 | 小 |
| 3 | `@` 補完付き参照入力 (候補ポップアップ) | 中 | 中 |
| 4 | 共通処理の引数マッピング UI | 中 | 中 |
| 5 (任意) | 型のテーブル・画面連携 | 大 | 大 |

Phase 1 から段階投入可能。Phase 2〜4 は独立に進められる。`process-flow-maturity.md` とは独立。

## 8. 受け入れ条件

> これらは実装フェーズの追跡チェックリストです。凍結は設計確定を意味し、実装完了を意味しません。

- [ ] `inputs` / `outputs` を表形式で編集でき、`StructuredField[]` として JSON に保存される
- [ ] 旧形式 (`string`) のデータは壊れず、自由記述モードで表示される
- [ ] 表形式 ↔ 自由記述モードを UI で切り替え可能 (往復可能)
- [ ] 各ステップ (対応タイプのみ) に `outputBinding` 欄があり、JSON に保存される
- [ ] 自由テキストフィールドで `@` 押下時、そのステップまでに定義された変数 + アクション入力の補完ポップアップが出る
- [ ] 共通処理ステップで `refId` を選択すると、呼び先の `inputs` が展開されて引数マッピングを指定できる
- [ ] 既存 4 画面 (画面一覧 / テーブル一覧 / 処理フロー一覧 / テーブル定義) は引き続き動作する
- [ ] Vitest で主要ケース (変換、補完、マッピング) が検証されている
- [ ] Playwright で入出力表形式 / `@` 補完 / 引数マッピングの基本動作が検証されている
- [ ] docs/spec/process-flow-variables.md (本書) の仕様と実装が逐条一致する

## 9. スコープ外 (将来検討)

- 実行時の型検査 / 厳密な型整合性チェック
- 列型の自動推論 (SELECT 結果列から型を自動生成)
- 変数のスコープリーク検査 (ループ外から中の変数参照を強制禁止)
- `@` 補完のドット記法候補 (オブジェクトのフィールド候補)
- 変数のリネーム・リファクタリング機能
- 式言語の構文検証 (+、==、>、AND 等)

## 10. 関連仕様

- `schemas/v3/process-flow.v3.schema.json` — 一次成果物 (v3.0.2 確定)
- `schemas/v3/common.v3.schema.json` — `StructuredField` / `FieldType` / `Identifier` / `IdentifierPath` / `OutputBinding` の $defs
- `schemas/v3/screen-item.v3.schema.json` — `ScreenItem.valueFrom` (R3-1 IdentifierPath 化)
- `docs/spec/process-flow-expression-language.md` — `@` 記法・式言語仕様
- `docs/spec/process-flow-maturity.md` — 成熟度・曖昧さ管理
- `docs/spec/process-flow-extensions.md` — schema 拡張機構
- `frontend/src/types/action.ts` — TS 型同期 (本仕様完了後に着手予定)

## 11. 変更履歴

- 2026-04-20: 初版ドラフト
- 2026-04-24: v1.0 凍結 (#253)
- **2026-04-28: v3 反映 (#539)** — FieldType を v3 確定形に、OutputBinding を構造化のみに、ambientVariables を context 配下に移動、IdentifierPath (#533 R3-1) を valueFrom.flowVariable で許容、StepBaseProps.lineage 透過 (#525 R3 fix) を反映
