# Markdown → Harmony JSON 変換ガイドライン (AI 向け)

**Status**: 🟡 **draft v0.1 (RFC)** — ISSUE #1060 Q7-Q11 決定を反映
**起点 spec**: [`generic-definition-layer.md`](generic-definition-layer.md)
**スキル起点**: [`.claude/skills/import-md/SKILL.md`](../../.claude/skills/import-md/SKILL.md)
**起票日**: 2026-05-13

---

## 0. このドキュメントの位置付け (最初に読む)

**読み手**: 設計書 Markdown を Harmony JSON に変換しようとしている AI (Claude / Codex / その他)。

**前提**:
- Harmony 側に固定 importer ツールは無い。**変換は AI の責務**。
- 各 project の MD は構造がバラバラ (heading 名・表ヘッダ・命名規則すべて project 依存)。
- 「project ごとの規約をすべて事前に schema 化する」のは現実的でないので、本ガイドラインで AI に **判断材料を与え** 、AI が project 固有のルールを毎回解釈する。

**できること 2 種類** (project 状況で使い分け):

| パターン | 状況 | 産物 |
|---|---|---|
| **(A) 1 回限り変換** | MD が 1 度きり / 更新が少ない / 数十ファイル程度 | Harmony JSON ファイル群 |
| **(B) Importer 生成** | MD が継続更新される / ファイル多数 / 同パターンを繰り返し変換する | `scripts/import/*.ts` + 上記 JSON |

判断フローは §9 (Decision flowchart) 参照。

**変換が完了 ≠ 設計が完成**。本ガイドラインの目的は「MD の情報をなるべく漏らさず構造化された Harmony JSON に落とす」までで、その後の設計レビューは別。draft-state policy ([`draft-state-policy.md`](draft-state-policy.md)) で warning 残存保存を許容する。

---

## 0.5. ⚠️ 本ガイドラインの schema 状態 (必読)

本ガイドラインは **2 種類の schema** を扱う:

| 印 | 種別 | 実体 | AJV 検証 |
|---|---|---|---|
| ✅ | **現行 schema 適合形** | `schemas/v3/*.json` に既存。今すぐ使える | **必須通過** (§10 完了判定の対象) |
| ✨ | **RFC 将来 schema 案** | ISSUE #1060 で提案中。**まだ `schemas/v3/` に存在しない** | **検証対象外** (生成すると AJV 失敗) |

### 何が ✨ RFC 将来案か

- `screenItem.binding.{kind,path,role,formatHint,sourceNote}` — 現行 ScreenItem は `additionalProperties: false` で `binding` を許可しない
- `screenItemEvent.{trigger,target,effects[]}` — 現行 ScreenItemEvent は `id` / `handlerFlowId` / `argumentMapping` のみ
- ProcessFlow step `kind: "componentCall"`, `kind: "dbQuery"|"dbInsert"|"dbUpdate"` — 現行は `commonProcess` / `dbAccess` (operation: SELECT/INSERT/UPDATE/DELETE)
- `validation[].throw.exceptionTypeRef` (step 内 inline) — 現行は `errorCode` catalog 参照
- `generic-definitions/<kind>/*.json` 全般 — 現行 `schemas/v3/` に該当 schema なし
- `step.outputBinding: "stock"` の string 短縮形 — v3 で廃止、`{ name: "stock" }` のみ

### AI が今すべきこと

1. **現行 schema 範囲のみで Harmony JSON を生成** — AJV で validate して保存
2. **RFC 将来 schema 案で表現したい情報** は次のいずれかで退避:
   - (a) 現行 schema の `description` field 内に構造化文字列で埋め込み (旧来パターン継続)
   - (b) `extensions/<namespace>/*.json` に opt-in 拡張として書き出し
   - (c) project 内の `generic-definitions/<kind>/*.json` に書き出し、**audit warning `rfc_future_field_skipped` を残す** (current loader は読まないが、将来 schema 確定時に取り込まれる)
3. **AJV gate は (a)(b) のみ通過確認、(c) は warning 扱いで保存許容** (draft-state policy)

各 §3 の archetype 例では ✅ 現行適合形 と ✨ RFC 将来案 を併記。AI は ✅ 側を必ず生成し、✨ は将来用に温存する。

### コード fence の表記 (重要)

本ガイドラインの JSON 例は **```jsonc fence** を使用 (```json ではなく)。先頭の `// <path>` コメントは **配置先を示すための注釈** であり、標準 JSON 構文では不正。

**AI が例を実 JSON file として保存する際の手順**:
1. ```jsonc fence の中身を抽出
2. **`//` から始まる行を全削除** (path 注釈と inline コメント両方)
3. それから AJV / `JSON.parse` / loader に渡す

AJV / loader / `JSON.parse` は **標準 JSON のみ** 受け付ける。jsonc のままだと AJV gate (§10 A) で必ず失敗する。

---

## 1. 出力先 Harmony JSON の全体構造

変換先の entity 一覧。**まず project の `harmony.json` を読み**、active workspace の `dataDir` (= 出力ルート) を特定する。

### 1.1 既存 entity (schemas/v3/)

| Entity | ファイル配置 | Schema | 主な役割 |
|---|---|---|---|
| Project meta | `harmony.json` | `schemas/v3/harmony.v3.schema.json` | project 設定 (techStack / 規約 / dataDir 指定) |
| Conventions | `conventions/*.json` | `schemas/v3/conventions.v3.schema.json` | message / constant / codeMaster / domain |
| Screen | `screens/{screenId}.json` | `schemas/v3/screen.v3.schema.json` | 画面定義 (route / purpose / 認証要件) |
| ScreenItem | `screens/{screenId}/items/*.json` (or inline) | `schemas/v3/screen-item.v3.schema.json` | 画面項目 (入力 / 出力 / イベント) |
| ScreenTransition | screen.json 内に inline (独立ファイルなし) | (screen 内) | 画面遷移グラフ |
| ProcessFlow | `process-flows/{flowId}.json` | `schemas/v3/process-flow.v3.schema.json` | 処理フロー (action / step) |
| Table | `tables/{tableId}.json` | `schemas/v3/table.v3.schema.json` | DB テーブル定義 |
| ViewDefinition | `view-definitions/*.json` | `schemas/v3/view-definition.v3.schema.json` | 一覧 UI viewer |
| Extensions | `extensions/<namespace>/*.json` | `schemas/v3/extensions.v3.schema.json` | opt-in 拡張型 |
| PageLayout | `page-layouts/*.json` | `schemas/v3/page-layout.v3.schema.json` | ページ全体構造 (header / sidebar / content slot) |
| Sequence | `sequences/*.json` | `schemas/v3/sequence.v3.schema.json` | 番号採番系 |

### 1.2 新規 Generic Definition Catalog (本 ISSUE で導入予定)

**配置**: `<project>/<dataDir>/generic-definitions/<kind>/*.json` (project ごとに独立、`harmony.json` の `dataDir` 配下に置く。実例 `examples/retail/harmony/` が dataDir なら `examples/retail/harmony/generic-definitions/<kind>/*.json`)

| kind | 用途 | 例 |
|---|---|---|
| `data-contract` | DTO / Form / Result / ViewModel (層間契約) | OrderForm / SearchResultDto |
| `domain-type` | Entity / Model (ドメイン型、永続化を含む) | Customer / Account |
| `exception-type` | 例外種別・階層・semantic kind | ValidationException / BusinessAbortException |
| `application-rule` | 認証認可 / ログ / 監査 / 例外変換 (横断ルール) | SecurityConfig / LoggingConfig |
| `ui-behavior` | 画面横断振る舞い (dirty check / dialog / datepicker) | dirtyCheck / messageDialog |
| `runtime-policy` | retry / timeout / circuit breaker / cache (横断ポリシー) | externalRetryPolicy |
| `component-definition` | service / mapper / repository / validator / formatter の責務 | OrderService / OrderMapper |
| `ui-fragment` | 再利用 UI 断片 (ヘッダー / フッター / メッセージ領域) | commonHeader / messageArea |

詳細スキーマと共通メタモデルは [`generic-definition-layer.md` §4.1](generic-definition-layer.md) 参照。

**配置上の注意**:
- `ui-fragment` と PageLayout の境界: PageLayout = ページ全体の骨格 (header / sidebar / content slot / footer)、`ui-fragment` = ページ内 or 複数画面で使い回す部品。詳細は [`generic-definition-layer.md` §3.6](generic-definition-layer.md)。
- `process-flow-extensions` ([`process-flow-extensions.md`](process-flow-extensions.md)) と Generic Definition Catalog は独立。process-flow-extensions = ProcessFlow 内側のステップ拡張、generic-definitions = project 全体の再利用資産。ProcessFlow からは `$ref` で generic-definitions を参照する。

---

## 2. 入力 MD の archetype 10 種類

MD ファイルがどの archetype に属するかを最初に判定する。判定根拠は (1) ファイル名 (2) 主要見出し (3) 表ヘッダ の 3 段階。

| archetype | 典型ファイル名 | 典型見出し | 主な変換先 |
|---|---|---|---|
| `screen-controller` | `spec_SC000001_Controller.md` | controlMapping / 画面項目定義 | screen + screen-item |
| `service-flow-spec` | `spec_OrderService.md` | 処理概要 / メソッド詳細 | process-flow |
| `architecture-spec` | `arch_overview.md` | Controller/Service 責務分割 | 複数 entity への metadata 補完 |
| `frontend-script` | `spec_commonJS.md` | 関数一覧 / 効果表 | generic-definitions/ui-behavior |
| `configuration-class` | `spec_SecurityConfig.md` | アノテーション / 依存性注入 | generic-definitions/application-rule |
| `exception-model` | `spec_exception_validation.md` | 例外一覧 / 階層 | generic-definitions/exception-type |
| `class-definition` | `spec_OrderForm.md` | プロパティ一覧 / フィールド定義 | generic-definitions/data-contract or domain-type |
| `reference-catalog` | `ref_message.md` | メッセージ一覧 / 定数一覧 | conventions (message / constant) |
| `pulldown-catalog` | `spec_Pulldown_status.md` | enum 値 / コード値 | conventions (codeMaster) or extensions catalog |
| `unknown` | (上記いずれにも該当しない) | — | warning として残し、強引に解釈しない |

**判定アルゴリズム**:
1. ファイル名 regex で 1 次分類
2. 見出し一致 (alias 統一後) で 2 次分類
3. 1 次と 2 次が不一致 → warning `inconsistent_archetype_classification` を出して 2 次優先
4. どちらも決まらない → `unknown`、強引な推測はしない

---

## 3. archetype 別 落とし方ガイド (before/after 例)

### 3.1 `screen-controller` → screen + screen-item

**Before (MD 抜粋)**:
```markdown
# 注文画面 (SC000001)

## 基本情報
| 項目 | 値 |
|---|---|
| 画面コード | SC000001 |
| URL | /order/new |
| 認証 | ログイン必須 |

## コントロールマッピング
| 項目名 | 属性 | マッピング | 備考 |
|---|---|---|---|
| 商品コード | th:field | form.productCode | 必須 |
| 数量 | th:field | form.quantity | 1以上 |
| 合計金額 | th:text | viewModel.totalPrice | 整形: 円 |
| カテゴリ | th:each | catalog.categories | 選択肢 |
```

#### ✅ After — 現行 schema 適合形 (今すぐ生成すべき)

Screen v3 schema (`schemas/v3/screen.v3.schema.json`) の root は EntityMeta (`id` / `name` / `createdAt` / `updatedAt` 必須) + `kind` 必須 + `path` (purpose='page' で必須)、`auth` は string enum (`required` / `optional` / `none`)。`code` や `route` という property は存在しない。`unevaluatedProperties: false` なので余計な field は AJV 落ち:

```jsonc
// screens/00000000-1060-4000-8000-000000000001.json
{
  "$schema": "../../schemas/v3/screen.v3.schema.json",
  "id": "00000000-1060-4000-8000-000000000001",
  "name": "注文画面",
  "description": "spec_SC000001_Controller.md を元に変換。コード: SC000001",
  "createdAt": "2026-05-13T00:00:00.000Z",
  "updatedAt": "2026-05-13T00:00:00.000Z",
  "kind": "form",
  "purpose": "page",
  "path": "/order/new",
  "auth": "required",
  "items": [
    {
      "id": "productCode",
      "label": "商品コード",
      "type": "string",
      "direction": "input",
      "required": true,
      "description": "[binding.v1] binding.attr=th:field; binding.path=form.productCode; source=spec_SC000001_Controller.md#コントロールマッピング"
    },
    {
      "id": "quantity",
      "label": "数量",
      "type": "integer",
      "direction": "input",
      "required": true,
      "min": 1,
      "description": "[binding.v1] binding.attr=th:field; binding.path=form.quantity"
    },
    {
      "id": "totalPrice",
      "label": "合計金額",
      "type": "integer",
      "direction": "output",
      "displayFormat": "¥#,##0",
      "description": "[binding.v1] binding.attr=th:text; binding.path=viewModel.totalPrice"
    },
    {
      "id": "category",
      "label": "カテゴリ",
      "type": "string",
      "direction": "input",
      "options": [
        { "value": "food", "label": "食品" },
        { "value": "drink", "label": "飲料" }
      ],
      "description": "[binding.v1] binding.attr=th:each; binding.path=catalog.categories"
    }
  ]
}
```

ポイント:
- ファイル名 = `<id>.json` (画面コード SC000001 は description に記録、ID は uuid v4)
- 必須 root: `id` / `name` / `createdAt` / `updatedAt` (EntityMeta 由来) + `kind` (`form` / `list` / `detail` / `confirm` 等 12 種 enum)
- URL は `path` (`route` ではない)、認証は `auth: "required"|"optional"|"none"` (object ではない)
- `purpose: "page"` 既定 (gadget 部品は `"gadget"`)
- ScreenItem の `type` は **データ型のみ** (FieldType: `string` / `number` / `integer` / `boolean` / `date` / `datetime` / `json` / `{kind: "array"/object/domain/file/extension}`)。**`select` / `button` / `submit` / `text` は無効** — select は `string` + `options[]`、ボタンは `{ "kind": "extension", "extensionRef": "<namespace>:button" }` で project ごとに extension
- **binding grammar v1** (description 埋め込みの厳密形式):
  - 先頭に sentinel `[binding.v1]` を必ず付ける (将来別形式と区別するため)
  - その後ろは `<key>=<value>; <key>=<value>; ...` の **セミコロン+空白区切り**
  - 標準 key は `binding.attr` (HTML 属性、コロン許容) / `binding.path` (bind 先) / `binding.role` (input/output/display) / `binding.formatHint` / `source` (出典)
  - `value` 内に `=` / `;` を含めない (含む場合は別フィールドに分割)
  - 例: `[binding.v1] binding.attr=th:field; binding.path=form.productCode; source=spec.md#section`
  - 将来 RFC で `binding` サブ field 確定後、migration script は **`[binding.v1]` sentinel を持つ description のみ** parse → `binding` field 化 → sentinel と key/value 削除、自由文 description だけ残す

#### ✨ Alternative — RFC 将来 schema 案 (#1060 確定後)

`binding` サブオブジェクトが ScreenItem に追加されたら以下に migrate (現在 AJV 落ちるため **生成しない**):

```jsonc
// 【RFC 将来案・現状不可】
{
  "id": "productCode",
  "label": "商品コード",
  "type": "string",
  "direction": "input",
  "required": true,
  "binding": {
    "kind": "formField",
    "path": "form.productCode",
    "role": "input",
    "sourceNote": "spec_SC000001_Controller.md#コントロールマッピング"
  }
}
```

このパターンは [`generic-definition-layer.md` §3.1](generic-definition-layer.md) で提案中、子 ISSUE で schema 拡張予定。

**落とし方 hints**:
- `th:field` / `th:value` / `th:text` / `th:each` 等の属性 → ✅ 現行は `description` に **binding grammar v1** (`[binding.v1] binding.attr=<attr>; binding.path=<path>`) 形式で記録 / ✨ 将来は `binding.kind`
- 「必須」「N 以上」等の備考 → `required` (boolean) / `min` / `max`
- 整形指示 (「円」「%」「日付」等) → `displayFormat` ('¥#,##0' / '0.00%' / 'YYYY/MM/DD')
- 出典 (表内に書かれた要件) → `description` に `source=...` で記録

**よく落とす情報**:
- 表外の説明文に書かれた「change イベントで X を fetch」→ §3.2 参照 (現行は別 ProcessFlow に切り出し handlerFlowId で接続)
- 「`[hidden]`」マーカー → `visibleWhen: "false"` または `direction` 調整 / `description` に hidden を記載

### 3.2 `screen-controller` の画面イベント (UI effects)

**Before**:
```markdown
## イベント定義
| イベント | 対象項目 | 効果 |
|---|---|---|
| change | 都道府県 | 市区町村プルダウンを fetch → 設定 |
| click | 戻るボタン | dirty check → 確認 → 遷移 |
| submit | 確定ボタン | 全ボタン無効化 → POST |
```

#### ✅ After — 現行 schema 適合形 (今すぐ生成すべき)

現行 ScreenItemEvent (`schemas/v3/screen-item.v3.schema.json:97`) は `id` / `label` / `handlerFlowId` / `handlerActionId` / `argumentMapping` のみ許可。UI 効果は **別 ProcessFlow に切り出し**、event は handlerFlowId で接続。

**注意**:
- ScreenItem.type は FieldType (`schemas/v3/common.v3.schema.json#/$defs/FieldType`) で `string` / `number` / `integer` / `boolean` / `date` / `datetime` / `json` 等のデータ型のみ。`button` / `submit` / `select` は無効。
- button 系は **`{ "kind": "extension", "extensionRef": "<namespace>:button" }`** で project ごとに extension を切る (実例 `examples/retail/harmony/screens/c2254dd6-...json` 参照)
- select 系はデータ型 (`string` 等) + `options[]` 配列

```jsonc
// screens/00000000-1060-4000-8000-000000000001.json (events 抜粋)
{
  "$schema": "../../schemas/v3/screen.v3.schema.json",
  "id": "00000000-1060-4000-8000-000000000001",
  "name": "住所入力画面",
  "createdAt": "2026-05-13T00:00:00.000Z",
  "updatedAt": "2026-05-13T00:00:00.000Z",
  "kind": "form",
  "path": "/order/address",
  "auth": "required",
  "items": [
    {
      "id": "prefecture",
      "label": "都道府県",
      "type": "string",
      "direction": "input",
      "required": true,
      "options": [
        { "value": "13", "label": "東京都" },
        { "value": "14", "label": "神奈川県" }
      ],
      "events": [
        {
          "id": "change",
          "label": "都道府県変更",
          "handlerFlowId": "00000000-1060-4000-8000-000000000010",
          "argumentMapping": {
            "prefectureCode": "@screen.prefecture"
          }
        }
      ],
      "description": "[binding.v1] binding.attr=th:field; binding.path=form.prefecture"
    },
    {
      "id": "city",
      "label": "市区町村",
      "type": "string",
      "direction": "input",
      "description": "[binding.v1] binding.attr=th:field; binding.path=form.city; note=都道府県 change 時に options 再生成"
    }
  ]
}
```

ProcessFlow 側 (`pf-load-cities`) で API 呼び出し + `displayUpdate` で項目更新:

```jsonc
// process-flows/00000000-1060-4000-8000-000000000010.json
{
  "$schema": "../../schemas/v3/process-flow.v3.schema.json",
  "meta": {
    "id": "00000000-1060-4000-8000-000000000010",
    "name": "市区町村プルダウン更新",
    "kind": "screen",
    "screenId": "00000000-1060-4000-8000-000000000001",
    "createdAt": "2026-05-13T00:00:00.000Z",
    "updatedAt": "2026-05-13T00:00:00.000Z"
  },
  "actions": [
    {
      "id": "act-001",
      "name": "市区町村取得",
      "trigger": "change",
      "description": "都道府県コードに紐付く市区町村一覧を取得し、city ScreenItem の options を再生成。",
      "inputs": [
        { "name": "prefectureCode", "type": "string", "required": true }
      ],
      "outputs": [
        { "name": "cities", "type": { "kind": "array", "itemType": "json" } }
      ],
      "steps": [
        {
          "id": "step-01",
          "kind": "dbAccess",
          "description": "都道府県コードで市区町村マスタを引く",
          "tableId": "00000000-1060-4000-8000-000000000020",
          "operation": "SELECT",
          "sql": "SELECT city_code AS code, city_name AS name FROM cities c WHERE c.prefecture_code = @inputs.prefectureCode ORDER BY city_code",
          "outputBinding": { "name": "cities" }
        },
        {
          "id": "step-02",
          "kind": "displayUpdate",
          "description": "city 項目の options を再生成 (@cities → screen.items.city.options)",
          "target": "screen.items.city.options"
        }
      ]
    }
  ]
}
```

ポイント:
- `trigger` は string enum (`click` / `submit` / `select` / `change` / `load` / `timer` / `auto` / `other` または `namespace:eventName` 拡張形式) — オブジェクトではない
- `displayUpdate` step は `target` (string) 必須、`updates: []` のような配列は schema に無い (target に DOM パス or 変数を直接書く)
- 多項目更新が必要な場合は `displayUpdate` step を複数並べる
- 戻るボタン / dirty check / 二重送信防止等の UI ロジックは、対応する extension 型 button をデザインし、その events[].handlerFlowId に専用 ProcessFlow を割り当てる

#### ✨ Alternative — RFC 将来 schema 案 (#1060 確定後)

ScreenItemEvent に `trigger` / `target` / `effects[]` が追加されたら以下に migrate (現在 AJV 落ちるため **生成しない**):

```jsonc
// 【RFC 将来案・現状不可】
{
  "events": [
    {
      "trigger": "change",
      "target": "prefecture",
      "effects": [
        { "kind": "fetch", "endpoint": "/api/cities", "params": { "pref": "prefecture" } },
        { "kind": "setOptions", "target": "city" }
      ]
    }
  ]
}
```

このパターンは [`generic-definition-layer.md` §3.2](generic-definition-layer.md) で提案中、子 ISSUE で schema 拡張予定。

**落とし方 hints (✅ 現行)**:
- 「change / click / submit イベントで X」→ ScreenItem.events[].handlerFlowId に ProcessFlow を切り出し
- UI ローカル効果 (clear / setOptions / showDialog) → ProcessFlow 内 `displayUpdate` step (`schemas/v3/process-flow.v3.schema.json` `kind: "displayUpdate"`)
- 「全ボタン無効化 → POST」のような multi-effect → 1 ProcessFlow 内に複数 step で順次記述

### 3.3 `service-flow-spec` → process-flow

**Before**:
```markdown
# OrderService.placeOrder

## 処理概要
| No | 処理 | 詳細 |
|---|---|---|
| 1 | 在庫チェック | inventory テーブル参照、不足なら ValidationException |
| 2 | 注文登録 | orders テーブル INSERT、SEQ_ORDER 採番 |
| 3 | 在庫減算 | inventory.quantity -= 注文数 |
| 4 | 確認メール送信 | 共通処理: MailComponent.send(orderId) |
| 5 | 結果返却 | OrderResult { orderId, totalPrice } を返却 |

## トランザクション
1〜3 は 1 TX。4 は別 TX (失敗しても 1〜3 は維持)。
```

#### ✅ After — 現行 schema 適合形 (今すぐ生成すべき)

現行 ProcessFlow v3 schema (`schemas/v3/process-flow.v3.schema.json`) の重要点:

**root 構造** — `meta` + `context` + `actions` + `authoring` の 4 セクション。`kind`/`id`/`code`/`name` を root に直書きは AJV 落ち。構造スケッチ (実際の JSON ではない、説明用):
```text
{
  "meta":     { id, name, kind, createdAt, updatedAt, ... },
  "context":  { catalogs: { errors: {...}, events: {...} } },
  "actions":  [ ... ],
  "authoring": { ... }
}
```
(完全な動作する例は本節末尾 §3.3 ✅ After を参照)

**Step union (24 variants)** ([schema:529](../../schemas/v3/process-flow.v3.schema.json)):
`validation` / `dbAccess` / `externalSystem` / `commonProcess` / `screenTransition` / `displayUpdate` / `branch` / `loop` / `loopBreak` / `loopContinue` / `jump` / `compute` / `return` / `log` / `audit` / `workflow` / `transactionScope` / `eventPublish` / `eventSubscribe` / `closing` / `cdc` / `aiCall` / `aiAgent` / `extension`

**Step kind ではない** (混同しやすい — 別の場所で使う kind):
- `expression` / `tryCatch` / `affectedRowsZero` / `externalOutcome` — **BranchCondition の kind** (`branch.branches[].condition.kind`)
- `auditLog` — **CDC 出力先の kind** (`cdc.outputs[].kind`)
- `componentCall` / `dbQuery` / `dbInsert` / `dbUpdate` — 存在しない (RFC 将来案)

**マッピング**:
- DB 操作 → **すべて `kind: "dbAccess"`** + `operation: "SELECT|INSERT|UPDATE|DELETE|MERGE|LOCK"` + `tableId` (Uuid) + 完全 `sql`
- 共有内部処理呼び出し → **`kind: "commonProcess"` + `refId` (他 ProcessFlow の Uuid)**
- バリデーション + エラー応答 → **`kind: "validation"` step** + `conditions` (人間向け概要) + `rules[]` ({field, type, severity, message, ...}) + `fieldErrorsVar` + `inlineBranch.ng[]` に `kind: "return"` + `responseId`/`bodyExpression`
- 条件分岐 → **`kind: "branch"`** + `branches[]` ({id, code, label, condition: {kind: "expression", expression}, steps[]})
- エラーコード → `context.catalogs.errors.<CODE>` ({httpStatus, defaultMessage, responseId, description})

```jsonc
// process-flows/00000000-1060-4000-8000-000000000030.json
{
  "$schema": "../../schemas/v3/process-flow.v3.schema.json",
  "meta": {
    "id": "00000000-1060-4000-8000-000000000030",
    "name": "注文受付",
    "description": "spec_OrderService.md placeOrder メソッドの変換。",
    "kind": "common",
    "createdAt": "2026-05-13T00:00:00.000Z",
    "updatedAt": "2026-05-13T00:00:00.000Z"
  },
  "context": {
    "catalogs": {
      "errors": {
        "VALIDATION_ERROR": {
          "httpStatus": 400,
          "defaultMessage": "入力値が不正です。",
          "responseId": "400-validation"
        },
        "INVENTORY_SHORTAGE": {
          "httpStatus": 422,
          "defaultMessage": "在庫が不足しています。",
          "responseId": "422-inventory-shortage",
          "description": "在庫数 < 注文数 のとき発生。RFC 将来 schema では generic-definitions/exception-type/ValidationException に紐付ける。"
        }
      }
    }
  },
  "actions": [
    {
      "id": "act-001",
      "name": "注文確定",
      "trigger": "submit",
      "description": "在庫チェック → 注文登録 → 在庫減算 を 1 TX で実行、別 TX でメール送信。",
      "httpRoute": { "method": "POST", "path": "/api/orders", "auth": "required" },
      "inputs": [
        { "name": "productCode", "type": "string", "required": true },
        { "name": "quantity", "type": "integer", "required": true }
      ],
      "outputs": [
        { "name": "orderId", "type": "integer" },
        { "name": "totalPrice", "type": "integer" }
      ],
      "responses": [
        { "id": "200-ok", "status": 200, "description": "注文確定成功" },
        { "id": "400-validation", "status": 400, "description": "入力エラー" },
        { "id": "422-inventory-shortage", "status": 422, "description": "在庫不足" }
      ],
      "steps": [
        {
          "id": "step-01",
          "kind": "validation",
          "description": "入力バリデーション (productCode 必須 + quantity 範囲)",
          "rules": [
            { "field": "productCode", "type": "required", "severity": "error", "message": "商品コードは必須です。" },
            { "field": "quantity", "type": "range", "min": 1, "severity": "error", "message": "数量は 1 以上を指定してください。" }
          ],
          "fieldErrorsVar": "fieldErrors",
          "inlineBranch": {
            "ok": [],
            "ng": [
              {
                "id": "step-01-ng-01",
                "kind": "return",
                "description": "400 を返す",
                "responseId": "400-validation",
                "bodyExpression": "{ code: 'VALIDATION_ERROR', details: @fieldErrors }"
              }
            ]
          }
        },
        {
          "id": "step-02",
          "kind": "dbAccess",
          "description": "在庫チェック",
          "tableId": "00000000-1060-4000-8000-000000000040",
          "operation": "SELECT",
          "sql": "SELECT quantity AS qty, price AS price FROM inventory inv WHERE inv.product_code = @inputs.productCode",
          "outputBinding": { "name": "stock" },
          "txBoundary": { "txId": "tx-main", "role": "begin" }
        },
        {
          "id": "step-03",
          "kind": "branch",
          "description": "在庫不足なら 422 を返す",
          "branches": [
            {
              "id": "br-03-a",
              "code": "A",
              "label": "在庫不足",
              "condition": { "kind": "expression", "expression": "@stock.qty < @inputs.quantity" },
              "steps": [
                {
                  "id": "step-03-a-01",
                  "kind": "return",
                  "description": "422 を返す",
                  "responseId": "422-inventory-shortage",
                  "bodyExpression": "{ code: 'INVENTORY_SHORTAGE' }"
                }
              ]
            }
          ]
        },
        {
          "id": "step-04",
          "kind": "dbAccess",
          "description": "注文登録",
          "tableId": "00000000-1060-4000-8000-000000000041",
          "operation": "INSERT",
          "sql": "INSERT INTO orders (id, product_code, quantity) VALUES (NEXTVAL('SEQ_ORDER'), @inputs.productCode, @inputs.quantity) RETURNING id AS order_id",
          "outputBinding": { "name": "orderId" },
          "txBoundary": { "txId": "tx-main", "role": "member" }
        },
        {
          "id": "step-05",
          "kind": "dbAccess",
          "description": "在庫減算",
          "tableId": "00000000-1060-4000-8000-000000000040",
          "operation": "UPDATE",
          "sql": "UPDATE inventory inv SET quantity = quantity - @inputs.quantity WHERE inv.product_code = @inputs.productCode",
          "txBoundary": { "txId": "tx-main", "role": "end" }
        },
        {
          "id": "step-06",
          "kind": "commonProcess",
          "description": "確認メール送信 (別 TX、失敗しても tx-main は維持)",
          "refId": "00000000-1060-4000-8000-000000000050",
          "argumentMapping": { "orderId": "@orderId" },
          "txBoundary": { "txId": "tx-mail", "role": "begin" }
        },
        {
          "id": "step-07",
          "kind": "return",
          "description": "200 を返す",
          "responseId": "200-ok",
          "bodyExpression": "{ orderId: @orderId, totalPrice: @stock.price * @inputs.quantity }"
        }
      ]
    }
  ]
}
```

#### ✨ Alternative — RFC 将来 schema 案 (#1060 確定後)

`kind: "componentCall"` + `exceptionTypeRef` + 簡易 inline 構文が schema に追加されたら以下に migrate (現在 AJV 落ちるため **生成しない**):

```jsonc
// 【RFC 将来案・現状不可】
{
  "id": "step-04",
  "kind": "componentCall",
  "componentRef": "generic-definitions/component-definition/MailComponent",
  "operation": "send"
}
```

このパターンは [`generic-definition-layer.md` §3.3](generic-definition-layer.md) で提案中、子 ISSUE で schema 拡張予定。

**落とし方 hints (✅ 現行)**:
- 「共通処理: X.Y(...)」→ `kind: "commonProcess"` + `refId` (呼び先 ProcessFlow Uuid) + `argumentMapping`
- 「X テーブル参照 / INSERT / UPDATE」→ **すべて `kind: "dbAccess"`** + `operation: "SELECT|INSERT|UPDATE|DELETE"` + `tableId` (Uuid) + 完全 `sql`
- 「不足なら / 失敗なら〜エラー応答」→ `kind: "validation"` (フィールドバリデーション + `inlineBranch.ng[]` に return) または `kind: "branch"` (任意条件分岐 + `branches[].condition.kind: "expression"` + `steps[]` に return)
- 「採番」→ `sql` に `NEXTVAL('SEQ_NAME')` 等を直書き (DB 方言依存) or 別 step で取得
- 「1〜N は 1 TX」「N+1 は別 TX」→ `txBoundary: { txId: "...", role: "begin|member|end" }` を必ず begin / member / end で揃える
- 「返却値」→ `kind: "return"` step + `responseId` (Action.responses[].id 参照) + `bodyExpression`
- 「エラーコード」→ `context.catalogs.errors.<CODE>` ({httpStatus, defaultMessage, responseId, description}) に登録、`responseId` を Action.responses[] と一致させる
- SQL は必ず **alias を付ける** (`FROM orders o`、#775 規約)
- `description` field は **step ごとに必須**

**よく落とす情報**:
- `runIf` (StepBaseProps) は実行条件式、`condition` (BranchCondition) と用途が違う
- TX 境界の `role` は begin/member/end を必ず正しく付ける (`feedback_processflow_known_pitfalls_retail_2026_05_02.md` の rollbackOn 欠落と関連)
- conv 参照リテラルは `@conv.msg.XXX` / `@inputs.foo` / `@<var>.bar` 形式 (波括弧 `{{...}}` は禁止)
- `expression` / `tryCatch` は BranchCondition の kind であって Step kind ではない (混同しやすい)
- `auditLog` は CDC 出力先の kind であって Step kind ではない

---

### ✨ §3.4 〜 §3.7 についての注記 (必読)

以下 §3.4 (exception-model) / §3.5 (class-definition) / §3.6 (frontend-script) / §3.7 (configuration-class) はすべて **`generic-definitions/<kind>/*.json` 配下への出力** で、現行 `schemas/v3/` に対応 schema が存在しない。AJV 検証対象外。

**現状の扱い**:
- `examples/<project>/<dataDir>/generic-definitions/<kind>/<name>.json` ファイルに書き出す (実例: `examples/retail/harmony/generic-definitions/data-contract/OrderForm.json`)
- 現行 loader は読まない (将来 schema 確定時に取り込まれる)
- AJV 検証ゲートからは除外
- audit に **warning `rfc_future_field_skipped`** を kind 別件数で残す
- 設計者が将来 schema 確定後に migration 可能な形式で構造化保存

JSON 構造は [`generic-definition-layer.md` §4.1 共通メタモデル](generic-definition-layer.md) に準拠する。

---

### 3.4 `exception-model` → generic-definitions/exception-type (✨ RFC 将来案)

**Before**:
```markdown
# 例外体系

## ValidationException
- 種別: 業務エラー
- 親: BusinessException
- 回復可能: yes
- 用途: 入力検証失敗
- 既定処理: UI で field error として表示

## BusinessAbortException
- 種別: 業務中断
- 親: BusinessException
- 回復可能: no
- 用途: 業務的に処理続行不能
- 既定処理: ユーザーへメッセージ表示 → トップ画面へ
```

**After** (2 ファイルに分けて書き出す):

`generic-definitions/exception-type/ValidationException.json`:
```jsonc
// generic-definitions/exception-type/ValidationException.json
{
  "kind": "exception-type",
  "name": "ValidationException",
  "purpose": "入力検証失敗",
  "relations": [{ "kind": "extends", "ref": "generic-definitions/exception-type/BusinessException" }],
  "semanticKind": "validation-error",
  "recoverable": true,
  "defaultHandling": "attach-field-errors"
}
```

`generic-definitions/exception-type/BusinessAbortException.json`:
```jsonc
// generic-definitions/exception-type/BusinessAbortException.json
{
  "kind": "exception-type",
  "name": "BusinessAbortException",
  "purpose": "業務的に処理続行不能",
  "relations": [{ "kind": "extends", "ref": "generic-definitions/exception-type/BusinessException" }],
  "semanticKind": "business-abort",
  "recoverable": false,
  "defaultHandling": "return-user-message"
}
```

**落とし方 hints**:
- 「種別: 業務エラー / 業務中断 / 検証エラー / 認証エラー / 認可エラー / 競合 / システムエラー」→ `semanticKind`
- 「親: X」→ `relations[].kind = "extends"`
- 「回復可能」→ `recoverable: true|false`
- 「既定処理: X」→ `defaultHandling`

### 3.5 `class-definition` → data-contract or domain-type (✨ RFC 将来案)

**Before**:
```markdown
# OrderForm

| プロパティ | 型 | 必須 | 説明 |
|---|---|---|---|
| productCode | string | yes | 商品コード |
| quantity | integer | yes | 1以上 |
| customerNote | string | no | 備考 (max 200) |
```

**After**:
```jsonc
// generic-definitions/data-contract/OrderForm.json
{
  "kind": "data-contract",
  "name": "OrderForm",
  "purpose": "注文画面の入力フォーム",
  "fields": [
    { "name": "productCode", "type": "string", "constraints": ["required"] },
    { "name": "quantity", "type": "integer", "constraints": ["required", "min:1"] },
    { "name": "customerNote", "type": "string", "constraints": ["maxLength:200"] }
  ],
  "targets": ["backend", "frontend"]
}
```

**data-contract vs domain-type の判定**:
- 命名末尾が `Form` / `Dto` / `Result` / `Request` / `Response` / `ViewModel` → `data-contract`
- 命名末尾が `Entity` / `Model` / `Aggregate` / table と 1:1 対応 → `domain-type`
- 迷ったら project profile (§7.3) の `reusableContracts.dataContractKinds` で確定

### 3.6 `frontend-script` → generic-definitions/ui-behavior (✨ RFC 将来案)

**Before**:
```markdown
# common.js

## dirtyCheck()
画面入力に変更がある場合、戻る前に確認ダイアログを表示。
```

**After**:
```jsonc
// generic-definitions/ui-behavior/dirtyCheck.json
{
  "kind": "ui-behavior",
  "name": "dirtyCheck",
  "purpose": "画面入力に変更がある場合、画面遷移前に確認ダイアログを表示",
  "trigger": "navigate",
  "effects": ["confirm", "branch"],
  "targets": ["frontend"]
}
```

### 3.7 `configuration-class` → generic-definitions/application-rule (✨ RFC 将来案)

**Before**:
```markdown
# SecurityConfig

## 認証
- /admin/* → ADMIN role 必須
- /api/* → 認証必須
- /public/* → 認証不要

## ログ
- 全 POST/PUT/DELETE をログ出力 (request body 除く)
- 機密項目 (password, token) はマスク
```

**After**:
```jsonc
// generic-definitions/application-rule/SecurityConfig.json
{
  "kind": "application-rule",
  "name": "SecurityConfig",
  "purpose": "認証認可とログ出力ポリシー",
  "rules": [
    { "category": "auth", "pathPattern": "/admin/*", "require": "role:ADMIN" },
    { "category": "auth", "pathPattern": "/api/*", "require": "authenticated" },
    { "category": "auth", "pathPattern": "/public/*", "require": "none" },
    { "category": "log", "match": "POST|PUT|DELETE", "include": "request-line", "exclude": "request-body" },
    { "category": "log", "mask": ["password", "token"] }
  ],
  "targets": ["backend"]
}
```

### 3.8 `reference-catalog` → conventions

メッセージ / 定数 / システム設定は既存の `conventions/*.json` (`messages` / `constants` / `codeMaster`) に直接落とす。Generic Definition Catalog ではない。

### 3.9 `pulldown-catalog` → conventions or extensions catalog

enum / コード値は `conventions/codeMaster` または `extensions/<namespace>/*.json` の catalog 型に落とす。共通用語は前者、project 固有語彙は後者。

---

## 4. Generic Definition Catalog の共通メタモデル

すべての generic-definition は次の共通骨格を持つ (構造スケッチ、TypeScript 風型注釈で表現):

```text
{
  $id:              "generic-definitions/<kind>/<name>",
  kind:             "data-contract" | "domain-type" | "exception-type"
                    | "application-rule" | "ui-behavior" | "runtime-policy"
                    | "component-definition" | "ui-fragment",
  name:             string (lowerCamelOrPascalCase),
  purpose:          string (1-2 行の目的),
  responsibilities: string[],
  fields:           Array<{ name, type, constraints?: string[] }>,
  operations:       Array<{ name, inputs?: ..., outputs?: ... }>,
  relations:        Array<{
                      kind: "extends" | "implements" | "uses"
                          | "transformsFrom" | "transformsTo" | "appliesTo",
                      ref: string
                    }>,
  constraints:      string[] (不変条件・事前/事後条件),
  mappingHints:     {
                      "backend.spring"?:  { /* free-form */ },
                      "backend.nestjs"?:  { /* free-form */ },
                      "frontend.next"?:   { /* free-form */ }
                    },
  targets:          Array<"backend" | "frontend" | "shared" | "runtime">
}
```

実 JSON 例は §3.4〜§3.7 の各 archetype 落とし方ガイドを参照。

**field optionality**:
- `kind` / `name` / `purpose` / `targets` は必須
- `fields` / `operations` / `relations` / `constraints` は kind 次第
- `mappingHints` は **free-form object** (Q6 決定)、techStack 別キーで自由構造

**`mappingHints` の標準キー** (慣例):
- `backend.spring` / `backend.nestjs` / `backend.django`
- `frontend.next` / `frontend.vite` / `frontend.thymeleaf`
- `shared.openapi` / `shared.graphql`

各キー配下の構造は自由。例: `{"package": "com.example.order", "superClass": "BaseForm"}`。

---

## 5. Audit / Warning 規範

変換中に検出した「変換不能」「曖昧」「情報欠落」は warning として出力する。AI 生成 importer (§7) はこれを `audit.json` に書き出すこと。1 回限り変換 (§6) でも、PR description / コメントに warning 一覧を残す。

### 5.1 warning 構造

スケッチ (TypeScript 風型注釈):

```text
{
  file:          string  (例: "reference/spec_SC000001_Controller.md"),
  section:       string  (例: "コントロールマッピング / 商品コード"),
  kind:          string  (§5.2 標準 warning kind 一覧から),
  severity:      "warning" | "error",
  humanReadable: string  (例: "商品コードの binding source 列が空欄。"),
  suggestedFix:  string  (例: "MD 側で binding 属性を追記")
}
```

実 JSON 例:

```jsonc
{
  "file": "reference/spec_SC000001_Controller.md",
  "section": "コントロールマッピング / 商品コード",
  "kind": "missing_binding_source",
  "severity": "warning",
  "humanReadable": "商品コードの binding source 列が空欄。binding.kind が決定不能、formField 仮置きしました。",
  "suggestedFix": "MD 側で binding 属性 (th:field 等) を追記、または project profile の bindingRules.attributeKinds で別名追加"
}
```

### 5.2 標準 warning kind

| kind | 発生条件 | severity |
|---|---|---|
| `unknown_archetype` | §2 で archetype 分類不能 | warning |
| `inconsistent_archetype_classification` | ファイル名と見出しの archetype 推定が不一致 | warning |
| `heading_alias_unmatched` | 別名一致しなかった見出し | warning |
| `table_header_drift` | 表ヘッダ揺れが profile 未登録 | warning |
| `missing_binding_source` | §3.1 で binding.kind 決定不能 | warning |
| `generated_screen_items_zero` | §3.1 で screen-item を 1 つも抽出できなかった | error |
| `unsupported_harmony_entity` | §1 / §4 のどちらにも落ちない情報 | warning |
| `processflow_step_kind_undecided` | §3.3 で step kind 決定不能 | warning |
| `exception_semantic_kind_undecided` | §3.4 で semanticKind 推測不能 | warning |
| `data_contract_kind_undecided` | §3.5 で data-contract vs domain-type 判定不能 | warning |
| `commonprocess_ref_unresolved` | §3.3 ✅ 現行形の `commonProcess` step の `refId` (呼び先 ProcessFlow Uuid) が未定義 | error |
| `rfc_future_field_skipped` | RFC 将来 schema 案 (binding / events.effects / componentCall / exceptionTypeRef / generic-definitions kind) を生成しようとした際、現行 schema に未対応のため `description` 退避 or 別ディレクトリ書き出しに切り替えた | warning |

### 5.3 audit summary

```jsonc
{
  "totalDocuments": 142,
  "archetypeBreakdown": { "screen-controller": 45, "service-flow-spec": 67, "unknown": 2 },
  "generatedEntities": {
    "screen": 45, "processFlow": 67, "table": 12,
    "genericDefinition": { "data-contract": 23, "exception-type": 8, "ui-behavior": 5 }
  },
  "warnings": { "byKind": { "missing_binding_source": 12 }, "total": 14 },
  "coverage": { "screenControllers": 0.97, "serviceFlowSpecs": 0.98 },
  "schemaValidation": { "passed": 158, "failed": 2 }
}
```

### 5.4 Review gate

- `severity: "error"` が 1 件でも残れば変換完了扱いにしない
- `severity: "warning"` は draft-state policy ([`draft-state-policy.md`](draft-state-policy.md)) により保存自体は許可
- coverage が project ごとの基準 (e.g. 95%) を下回れば設計者レビュー必須

---

## 6. パターン (A) 1 回限り変換 の進め方

MD が少数 (~数十ファイル) で更新もまれな場合の手順。

1. **`harmony.json` を読む** — `dataDir` を確認、出力先決定
2. **MD inventory** — 全 MD ファイルを `ls`/`find` で列挙、サイズ・典型 heading 一覧を頭に入れる
3. **archetype 分類** — §2 アルゴリズムで各ファイルを分類、`unknown` は warning ログ
4. **catalog 系から処理** — `pulldown-catalog` / `reference-catalog` を先に変換し、conventions を確立 (他 archetype の binding 解決に必要)
5. **screen / processFlow / table** — §3.1-§3.3 の **✅ 現行 schema 適合形** で変換 (§0.5 参照)
6. **generic-definitions** — §3.4-§3.7 (✨ RFC 将来案) で `examples/<project>/<dataDir>/generic-definitions/<kind>/*.json` に書き出し、各件数を `rfc_future_field_skipped` warning として記録
7. **ProcessFlow `commonProcess` の link** — `refId` (呼び先 ProcessFlow Uuid) を解決、未解決は **error** `commonprocess_ref_unresolved` を audit に出す (§10 (A) hard gate 対象、warning ではないので review gate で必ず止まる)。RFC 将来案の `componentCall` ref は generic-definitions/ 側のみで保持 (現行 hard gate 対象外)
8. **AJV 検証 (現行 schema 範囲)** — `schemas/v3/*.json` 配下で生成した JSON のみ AJV で検証。generic-definitions/ 配下は検証対象外 (§10 (A)/(B) 参照)
9. **audit summary** — §5.3 形式で出力、PR description に貼る (`rfc_future_field_skipped` の kind 別件数を含む)
10. **完了判定** — §10 (A) hard gate を全件パス、§10 (B) soft gate は warning として残す

**並列処理の指針**: 同一 archetype ファイル群は **1 ファイルずつ順次** 変換するのが安全 (memory `feedback_one_test_at_a_time_strict.md` 同様の原則 — batch 化すると同根エラーの connection が見えにくい)。

---

## 7. パターン (B) Importer 生成 の進め方

MD が継続更新される / ファイルが多い場合は、project 固有 `scripts/import/*.ts` を生成する。AI は 1 回変換のロジックを TypeScript script に **写し取る** イメージ。

### 7.1 推奨フロー (10 ステップ)

```
[input] reference/**/*.md + (optional) project profile
    │
    ▼
[1] inventory  →  inventory.json (中間成果物、原文不変)
    ▼
[2] archetype 分類
    ▼
[3] heading / table 正規化  (profile.headingAliases で上書き)
    ▼
[4] entity mapping  →  screen / processFlow / table / viewDefinition / conventions (画面遷移は screen.json 内 inline)
    ▼
[5] generic definition 退避  →  <project>/<dataDir>/generic-definitions/<kind>/*.json
    ▼
[6] warning / audit 出力  →  audit.json
    ▼
[7] deterministic 再実行  ←  同 MD + 同 profile = 同 JSON
    ▼
[8] schema validation (AJV) + audit summary
    ▼
[9] human review gate  (warning しきい値超過時は完了扱いにしない)
    ▼
[10] profile feedback loop  →  AI 初回解釈を profile に静的ルール化
```

各ステップの責務:

| Step | 純 TS / AI 補完 |
|---|---|
| 1 inventory | 純 TS (file walk + heading 抽出) |
| 2 archetype 分類 | 純 TS で 1 次・2 次、`unknown` のみ AI 補完 |
| 3 正規化 | 純 TS (profile alias 適用) |
| 4 entity mapping | 純 TS でテーブル抽出、未登録 binding pattern のみ AI 補完 |
| 5 generic 退避 | AI 主体 (semantic kind 判定 / 責務抽出) |
| 6 audit | 純 TS |
| 7 決定性 | 純 TS |
| 8 schema validation | 純 TS (AJV) |
| 9 review gate | 純 TS (しきい値判定) |
| 10 feedback | AI が profile に追記、人間レビュー |

### 7.2 TS scaffold テンプレート

**ディレクトリ構造** (10 ステップ全部に対応するファイルを 1 対 1 で持つ):
```
scripts/import/
  README.md                   # 使い方
  index.ts                    # entry point: 全 step オーケストレーション
  step1-inventory.ts
  step2-archetype.ts
  step3-normalize.ts
  step4-entity-mapping.ts
  step5-generic-definition.ts
  step6-audit.ts
  step7-deterministic.ts      # 同 MD + 同 profile = 同 JSON を保証する出力 sort / 順序固定
  step8-validate.ts
  step9-review-gate.ts        # warning しきい値判定、coverage チェック
  step10-profile-feedback.ts
  lib/
    md-parser.ts              # markdown-it ラッパー
    profile-loader.ts
    ai-fallback.ts            # AI 補完が必要な場合のフォールバック
```

**重要: profile は optional**。spec §7.3 で「profile を使わない場合は AI が毎回解釈」と明記しているため、scaffold は **profile 不在でも動作するように default を当てる** こと。`loadProfile()` は missing file / missing section に対して以下の最小 default を返す:

```ts
// lib/profile-loader.ts (defaults)
const DEFAULT_PROFILE = {
  profileVersion: "v1",
  name: "<auto>",
  sourceInventory: {
    rootDirs: ["reference/"],
    includeGlobs: ["**/*.md"],
    excludeGlobs: ["**/README.md", "**/tmp/**"],
    priorityDocuments: [],
  },
  fileNaming: { codeExtractionPatterns: [], archetypeHints: [] },
  headingAliases: {},
  tableHeaderAliases: {},
  archetypeRules: [],
  // ... 他全 section も {} or [] で埋める
};

export async function loadProfile(path: string) {
  let user: any = {};
  try { user = JSON.parse(readFileSync(path, "utf8")); } catch { user = {}; }
  // deep merge: ユーザー指定が default を上書き、未指定 section は default を維持
  return deepMerge(DEFAULT_PROFILE, user);
}
```

これにより profile 不在 / 部分指定 / valid-but-minimal の 3 ケースすべてで scaffold が動く。

**index.ts 雛形** (step 1〜10 を全て呼び出す、profile は load 後に常に full shape):
```ts
import { loadProfile } from "./lib/profile-loader";
import { runInventory } from "./step1-inventory";
import { runArchetypeClassification } from "./step2-archetype";
import { runNormalize } from "./step3-normalize";
import { runEntityMapping } from "./step4-entity-mapping";
import { runGenericDefinition } from "./step5-generic-definition";
import { runAudit } from "./step6-audit";
import { ensureDeterministicOutput } from "./step7-deterministic";
import { runValidate } from "./step8-validate";
import { runReviewGate } from "./step9-review-gate";
import { runProfileFeedback } from "./step10-profile-feedback";

async function main() {
  const profile = await loadProfile("./import-project-profile.json"); // 不在でも default が返る
  const inventory = await runInventory(profile);
  const classified = await runArchetypeClassification(inventory, profile);
  const normalized = await runNormalize(classified, profile);
  const mapped = await runEntityMapping(normalized, profile);
  const generic = await runGenericDefinition(mapped, profile);
  const audit = await runAudit(mapped, generic, profile);
  await ensureDeterministicOutput(mapped, generic); // sort + 順序固定
  await runValidate(mapped, generic);
  const gateResult = await runReviewGate(audit, profile);
  await runProfileFeedback(profile, audit); // AI 解釈を profile に還元 (option)
  console.log(JSON.stringify(audit.summary, null, 2));
  if (!gateResult.passed) {
    console.error("Review gate failed:", gateResult.reason);
    process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**step1-inventory.ts 雛形** (大規模 MD に耐える設計):

- **複数 rootDirs flatten** — `rootDirs[0]` だけでなく全 root を順次処理
- **本文は inventory に保持しない** — path / size / heading metadata のみ保持、本文は Step 4 entity mapping 時に必要なものだけ読む (1000+ MD で OOM 回避)
- **path 絶対化** — `glob({cwd})` 返却は cwd 相対 → `join(rootDir, relativePath)` で絶対化必須
- **heading parser bug 回避** — `filter().map((t, i) => tokens[i+1])` は filter 後の i を元配列に適用していて 2 つ目以降の heading を取りこぼす → reduce で元配列の i を保持

```ts
import { glob } from "glob";
import { readFileSync, statSync } from "fs";
import { join } from "path";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt();

export type InventoryEntry = {
  rootDir: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  mtime: Date;
  headings: string[];
};

export async function runInventory(profile: any): Promise<InventoryEntry[]> {
  const entries: InventoryEntry[] = [];
  // 複数 rootDirs を flatten
  for (const rootDir of profile.sourceInventory.rootDirs) {
    const relativePaths = await glob(profile.sourceInventory.includeGlobs, {
      cwd: rootDir,
      ignore: profile.sourceInventory.excludeGlobs,
    });
    for (const relativePath of relativePaths) {
      const absolutePath = join(rootDir, relativePath);
      const stat = statSync(absolutePath);
      // 本文は読まず、heading だけ抽出して捨てる (大規模 MD のメモリ対策)
      const content = readFileSync(absolutePath, "utf8");
      const tokens = md.parse(content, {});
      const headings = tokens.reduce<string[]>((acc, t, i) => {
        if (t.type === "heading_open") {
          const inline = tokens[i + 1]?.content;
          if (inline) acc.push(inline);
        }
        return acc;
      }, []);
      entries.push({
        rootDir,
        relativePath,
        absolutePath,
        size: stat.size,
        mtime: stat.mtime,
        headings,
      });
    }
  }
  return entries;
}
```

`content` は entry に含めない。後続 step が必要時に `readFileSync(entry.absolutePath, "utf8")` で読む。1000+ MD でも OOM しない。

**さらにメモリが厳しい場合** (10000+ MD): `runInventory` を async generator にして chunk 単位で yield、Step 2-5 も chunk 単位で進める設計に。

各 step の実装テンプレは省略 (本ガイドラインの長さ抑制のため、AI は本指針に沿って書く)。

### 7.3 Project Profile を使う場合

profile を使うと §7.1 の各 step に project 固有ルールを注入できる。**profile は optional**、無くても変換は動く (AI が毎回解釈する) が、profile を使うと再現性が上がる。

profile schema: [`schemas/import-project-profile.v1.schema.json`](../../schemas/import-project-profile.v1.schema.json)
サンプル: [`examples/retail/import-project-profile.json`](../../examples/retail/import-project-profile.json)

**profile 14 セクション**:

1. `sourceInventory` — root dirs, includeGlobs, excludeGlobs, priorityDocuments
2. `fileNaming` — code extraction patterns, archetype hints (file name regex)
3. `headingAliases` — canonical 名 → 別名 list
4. `tableHeaderAliases` — canonical 名 → 別ヘッダパターン list
5. `archetypeRules` — heading ベース archetype 2 次分類
6. `businessVocabulary` — terms / synonyms
7. `catalogRules` — priority sources, option resolution
8. `bindingRules` — attribute kinds, hidden markers, loop / output markers
9. `uiBehaviorPatterns` — known patterns, shared script files
10. `processFlowRules` — shared call / db / throw / message setting markers
11. `reusableContracts` — promote kinds, data contract kinds
12. `exceptionSemantics` — classification rules, default handling
13. `outputPolicy` — generate entities, warning thresholds, allow draft
14. `reviewPolicy` — must review warnings, minimum coverage

各セクションの詳細は schema 内 description 参照。

### 7.4 profile feedback loop (Step 10)

AI が新パターン (未登録 heading / 新 archetype / 新 binding pattern) を解釈した時、その判断を profile に追記する。次回 import 時は AI 不在で同じ結果になる。

```ts
// step10-profile-feedback.ts (擬似コード)
export async function applyAIFeedback(profile: any, aiDecisions: AIDecision[]) {
  for (const d of aiDecisions) {
    if (d.kind === "new-heading-alias") {
      profile.headingAliases[d.canonical] ??= [];
      profile.headingAliases[d.canonical].push(d.alias);
    } else if (d.kind === "new-archetype-rule") {
      profile.archetypeRules.push(d.rule);
    }
    // ...
  }
  await writeProfile(profile);
}
```

---

## 8. 既知の落とし穴 (memory 集約)

過去の dogfood で実際に発生した落とし穴。AI は変換時にこれらを **必ず先に確認** すること。

### 8.1 ProcessFlow 系 (memory `feedback_processflow_known_pitfalls_retail_2026_05_02.md`)

1. **conv 参照リテラル化** — `{{conv:msg-001}}` をリテラル文字列のまま出力。`expression` フィールドに置く
2. **JSON 重複 kind** — `kind: "dbQuery"` と `kind: "compute"` を同 step 内に書く誤り。1 step 1 kind
3. **screenTransition と httpRoute 衝突** — 同じパスを両方で定義しない
4. **採番 nextSeq() 不能** — `sequence.ref` の参照先 sequence 未定義
5. **rollbackOn 欠落** — TX 内のステップが throw する条件で `rollbackOn` 未指定
6. **lineage purpose 誤り** — `purpose` を type と混同
7. **loop 同名衝突** — 複数 loop で同 iterator 名
8. **複数文 SQL** — 1 SQL ステップに `;` 区切り複数文を書く誤り

### 8.2 ScreenItem 系

- ✅ 現行 schema では binding 情報を `description` 内に **binding grammar v1** で退避する (§3.1 / §0.5 参照)。grammar 仕様 (parser 実装 + 9 ケース pass 確認済):
  - **sentinel** `[binding.v1] ` (末尾 1 半角スペース込) を **必ず先頭に持つ**
  - 続けて `<key>=<value>; <key>=<value>; ...` の **セミコロン + 半角スペース区切り** (`/;\s+/`)
  - **標準 key** (全 optional): `binding.attr` (HTML 属性名、`:` 許容) / `binding.path` (bind 先パス) / `binding.role` (input / output / display) / `binding.formatHint` / `source` (出典) / `note` (補足)
  - key/value 区切りは **最初の `=`** のみ。value 内の `=` はリテラル扱い
  - 区切り `; ` (セミコロン+空白) を含まない `;` は value 内リテラル扱い
  - 空 key は parse error、空 value は許容
  - 例: `"description": "[binding.v1] binding.attr=th:field; binding.path=form.productCode; source=spec_SC000001.md"`
  - 参考 parser 実装 (`.tmp/test-binding-grammar.mjs` で 9/9 pass 確認済):
    ```ts
    const SENTINEL = "[binding.v1] ";
    function parseBindingDescription(d: string): Record<string, string> | null {
      if (!d?.startsWith(SENTINEL)) return null;
      const body = d.slice(SENTINEL.length).trim();
      if (body === "") return {};
      const out: Record<string, string> = {};
      for (const pair of body.split(/;\s+/)) {
        if (!pair) continue;
        const i = pair.indexOf("=");
        if (i === -1) throw new Error(`no = in pair: ${pair}`);
        const k = pair.slice(0, i).trim();
        if (!k) throw new Error(`empty key in pair: ${pair}`);
        out[k] = pair.slice(i + 1).trim();
      }
      return out;
    }
    ```
- ❌ **自由文章だけに埋もれさせるのは禁止** — migration script で機械抽出できないため、将来 RFC `binding` field 確定後の自動移行が壊れる
- ❌ **sentinel なしの旧形式 `binding: <attr>=<path>` も禁止** — `:` が key-value 区切りと衝突して migration parser が confused になる
- ✨ RFC 将来 schema 確定後は `binding` サブ field (§3.1 ✨) に migrate する。migration script は **`[binding.v1]` sentinel を持つ description のみ** 対象、自由文 description はそのまま保持
- `purpose: "gadget"` (#1021 PageLayout 系) の screen は別扱い

### 8.3 CSS / リネーム系 (memory `feedback_css_rename_verification.md`)

- 変換生成物に既存 CSS class 名を勝手に変更しない (E2E selector / TSX className / CSS 定義の 3 形態突合が必須)
- 本ガイドラインの変換範囲は MD → JSON のみで、CSS / TSX は触らない

### 8.4 SQL alias 必須化 (#775)

- generated DDL / DML SQL は alias を必須化済 (`FROM orders o` 等)
- 変換時に SQL を書き出す場合は alias を必ず付ける

### 8.5 silent pass の防止 (memory `feedback_silent_validation_pass_audit.md`)

- 必須リソース欠落 / field 名不一致 / 形式不対応で AJV が silent pass する anti-pattern が 5 種類ある
- 変換完了報告前に **AJV 結果 + 抽出件数 + warning 一覧** をユーザーに見せる

### 8.6 サンプル v3 はプロジェクト別

- `examples/<project-id>/` 配下に **独立した 1 業務アプリ** として配置 ([`sample-project-structure.md`](sample-project-structure.md))
- プロジェクト横断の単一ファイル配置は禁止
- 規約カタログ (conventions) も project 内に閉じる

---

## 9. Decision flowchart (パターン (A) vs (B) の選択)

```
[start] MD 数を確認
   │
   ▼
MD が ~30 ファイル以下 ?
   ├── Yes ─▶ MD 更新頻度は?
   │            ├── ほぼ無し ─▶ パターン (A) 1 回限り変換 (§6)
   │            └── 月次以上  ─▶ パターン (B) Importer 生成 (§7)
   │
   └── No (数百ファイル) ─▶ 同パターン MD が繰り返し出現する?
                              ├── Yes ─▶ パターン (B) Importer 生成 (§7)
                              └── No (全部バラバラ) ─▶ パターン (A) を chunk に分けて反復
                                                       (chunk = 同 archetype の ~30 ファイル単位)
```

**追加判断材料**:
- project が今後も MD を追加・更新するか (= importer のメンテコストを取り戻せるか)
- 自動 CI で MD 同期したいか (importer 必須)
- 1 回切りで設計者承認後はもう触らないか ((A) で十分)

---

## 10. 変換完了の判定基準

完了判定は **(A) 現行 schema 範囲のゲート** と **(B) RFC 将来 schema 範囲の確認** に分離する。

### (A) 現行 schema 範囲 — Hard gate (1 件でも failing なら完了不可)

以下すべて満たすこと:

- [ ] §5 audit.json を出力した
- [ ] `severity: "error"` の warning が 0 件
- [ ] **AJV validation passed** — `schemas/v3/*.json` 配下の schema を使って生成した全 JSON (screens / process-flows / tables / view-definitions / conventions / extensions、画面遷移は screen.json 内に inline) が validate を通過する。実行コマンド例:
   ```bash
   # project ディレクトリ単位の一括検証 (推奨)
   cd frontend && npm run validate:samples -- ../examples/<project-id>

   # 個別 file 検証 (debug 用)
   cd backend && npx ajv-cli@5 validate \
     -s ../schemas/v3/screen.v3.schema.json \
     -r "../schemas/v3/common.v3.schema.json" \
     -r "../schemas/v3/screen-item.v3.schema.json" \
     -d <output.json> --spec=draft2020 --strict=false
   ```
- [ ] coverage (project ごとの基準、未指定なら screen-controller / service-flow-spec / reference-catalog の 95% 以上)
- [ ] ScreenItem binding metadata は ✅ 現行形 (`description` 埋め込み) で記録、`missing_binding_source` 0 件
- [ ] ProcessFlow step kind が `schemas/v3/process-flow.v3.schema.json#/$defs/Step` oneOf の 24 variant (`validation` / `dbAccess` / `externalSystem` / `commonProcess` / `screenTransition` / `displayUpdate` / `branch` / `loop` / `loopBreak` / `loopContinue` / `jump` / `compute` / `return` / `log` / `audit` / `workflow` / `transactionScope` / `eventPublish` / `eventSubscribe` / `closing` / `cdc` / `aiCall` / `aiAgent` / `extension`) のみ。`expression` / `tryCatch` (BranchCondition kind) / `auditLog` (CDC 出力先 kind) を Step として使っていないこと
- [ ] ProcessFlow `commonProcess` step の `refId` が全件解決済 (生成した ProcessFlow と一致)
- [ ] ProcessFlow `validation` step の `inlineBranch.ng[]` 内 `return` の `responseId` が Action.responses[].id と一致、対応する error code が `context.catalogs.errors.<CODE>` に登録済
- [ ] `unknown` archetype 0 件 (もしくは設計者承認済)
- [ ] PR description に audit summary を貼った

### (B) RFC 将来 schema 範囲 — Soft gate (warning として記録、保存許容)

以下は **AJV ゲートから除外** し、draft-state policy ([`draft-state-policy.md`](draft-state-policy.md)) に従って保存:

- `examples/<project>/<dataDir>/generic-definitions/<kind>/*.json` 配下の出力 (data-contract / domain-type / exception-type / application-rule / ui-behavior / runtime-policy / component-definition / ui-fragment) — 現行 loader は読まないが、将来 schema 確定時の取り込み用に保存
- `description` 内に埋め込んだ ✨ RFC binding metadata / UI effects / componentCall ref / exceptionTypeRef
- audit warning `rfc_future_field_skipped` で kind 別件数を記録

(B) の件数が増えすぎる場合、設計者が将来 schema 確定タイミングを判断するためのシグナルになる。

### 補足

満たさない場合は draft-state で残置可だが、その旨を明示する。AJV failed は (A) 違反として **必ず修正してから保存**。

---

## 11. 関連 spec / memory リンク

### 関連 spec
- [`generic-definition-layer.md`](generic-definition-layer.md) — 親 spec / catalog 8 kind / 共通メタモデル
- [`schema-governance.md`](schema-governance.md) — schema 拡張時の権限 (AI 単独禁止)
- [`draft-state-policy.md`](draft-state-policy.md) — warning 残存保存の規範
- [`sample-project-structure.md`](sample-project-structure.md) — `examples/<project-id>/` 配置規約
- [`process-flow-extensions.md`](process-flow-extensions.md) — ProcessFlow step 拡張型 (本 catalog とは独立)
- [`page-layout.md`](page-layout.md) — PageLayout (#1021)、本 catalog の `ui-fragment` と区別
- [`workspace.md`](workspace.md) — active workspace / dataDir 解決

### 関連 memory
- `feedback_processflow_known_pitfalls_retail_2026_05_02.md` — §8.1 出典
- `feedback_silent_validation_pass_audit.md` — §8.5 出典
- `feedback_css_rename_verification.md` — §8.3 出典
- `feedback_one_test_at_a_time_strict.md` — §6 順次処理原則
- `project_framework_research_2026_04_25.md` — 19 拡張項目との overlap (Domain ↔ domain-type の統合)

### 既存スキーマ
- `schemas/v3/*.json` — 全 entity schema
- `schemas/import-project-profile.v1.schema.json` — profile schema (本 ISSUE で追加)

---

## 12. このガイドラインの育て方

本 spec は **AI のための運用知** を集約する場所。新しい dogfood / 失敗例 / project profile pattern が出るたびに更新する:

- 新 archetype を発見したら §2 + §3 に追加
- 新 warning kind が必要になったら §5.2 に追加
- 新しい落とし穴を踏んだら §8 に追記
- profile schema が変わったら §7.3 を更新

更新は本 ISSUE (#1060) の議論を経て、設計者承認後に commit する。
