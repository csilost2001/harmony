# プラグインシステム仕様

処理フロースキーマをソース変更なしに拡張するための仕組み。業務アプリ開発者がプロジェクト固有の型・ステップ・操作を追加できる。

**関連 ISSUE**: #390 (GM50 バッチ対応、本仕様の最初のユーザー)

---

## 設計原則

### グローバルスキーマ vs プラグイン の判断基準

| 区分 | 基準 | 例 |
|---|---|---|
| **グローバル** | どの業務プロジェクトでも合理的に必要になる | `"file"` FieldType、`"auto"` トリガー、`MERGE` DB 操作 |
| **プラグイン** | 特定プロジェクト・業界・業態に固有 | GM50 の `"csv"` / `"ZIP"` / `"TBL"` 型 |

**原則**: グローバルに入れるべきものはグローバルに。プラグインはソースを触らずに拡張できる手段であり、グローバル定義の代替ではない。

### アーキテクチャ

```
グローバルスキーマ (schemas/process-flow.schema.json)
  └─ 全プロジェクト共通の型・enum・ステップ定義

プラグイン (data/extensions/*.json)
  └─ プロジェクト固有の追加定義
  └─ バリデーターは検証のたびに動的読み込み → グローバルとマージして検証
```

### グローバル ↔ プラグインの併存ルール (種別別)

「上書き」の意味は種別ごとに異なる。種別別に明示する:

| 種別 | 競合時の挙動 | 理由 |
|---|---|---|
| **enum 拡張** (field-types / triggers / db-operations) | **追加のみ**。グローバル値の削除・置換は不可 | 既存 ProcessFlow JSON が壊れる |
| **カスタムステップ型** (steps) | 同名なら**プラグイン側が上書き**。ただし namespace で衝突回避を推奨 | プロジェクト固有のステップ定義で標準を上書きする要求は妥当 |
| **レスポンス型** (response-types) | キー単位で**プラグイン側が上書き** | 同上 |

**禁止**: グローバル enum 値 (`{kind: "string"}` 等) と同じ値をプラグインで再定義すること。バリデーターはこれを検出してエラーを返す。

---

## ファイル配置

### 二層構造 (sample / runtime)

```
docs/sample-project/extensions/   ← 本リポジトリ管理。サンプル/テンプレート (GM50 等)
  steps.json
  field-types.json
  ...

data/extensions/                  ← 業務プロジェクト固有 (本リポジトリでは追跡対象)
  steps.json
  field-types.json
  triggers.json
  db-operations.json
  response-types.json
```

- **`docs/sample-project/extensions/`**: 仕様の動作確認用サンプル。GM50 を含む業界別テンプレートをここに置く
- **`data/extensions/`**: 実行時にバリデーターが読む場所。本リポジトリでは追跡対象 (CLAUDE.md の `data/ is gitignored` 記述は古く実態と異なる。`data/process-flows/` 等と同様に追跡する)
- 両者の関係は将来 `project.json` の `extensionsPath` 設定で切り替え可能にする (将来拡張)

### 拡張種別ごとのファイル

```
data/extensions/
  steps.json          カスタムステップ型 (処理フローエディターのカード)
  field-types.json    FieldType 拡張 (入出力フィールドの型)
  triggers.json       ActionTrigger 拡張 (アクションの起動条件)
  db-operations.json  DbOperation 拡張 (DB 操作の種別)
  response-types.json レスポンス型定義 (typeCatalog の後継)
```

- 拡張種別ごとに**1 ファイル**。同種別を複数ファイルに分割しない (運用シンプル化)
- ファイルが存在しない場合はその種別の拡張なしとして扱う (エラーにしない)

### 各ファイルの JSON Schema

`schemas/extensions-{steps,field-types,triggers,db-operations,response-types}.schema.json` を用意し、拡張ファイル自体を schema validation する。

**必須フィールド**: `namespace` (空文字列でも明示)、種別ごとの本体 (`steps` / `fieldTypes` / `triggers` / `dbOperations` / `responseTypes`)。

### 将来の拡張

- 外部パス設定: `project.json` に `extensionsPath` を追加し、`data/extensions/` 以外の場所を指定できるようにする
- 複数プロジェクト対応: 外部パス指定により、各業務プロジェクトのリポジトリ内に拡張定義を置ける

---

## 名前空間

プラグイン定義の各エントリには名前空間プレフィックスを付けられる。

```json
// steps.json
{
  "namespace": "gm50",
  "steps": {
    "BatchStep": { ... }
  }
}
// → "gm50:BatchStep" として登録される
```

```json
// namespace が空の場合
{
  "namespace": "",
  "steps": {
    "BatchStep": { ... }
  }
}
// → "BatchStep" としてそのまま登録
```

- `namespace` フィールドは**必須** (空文字列でも明示)。各ファイルの JSON Schema で required 強制
- enum 拡張 (field-types/triggers/db-operations) は値そのものが識別子のため、namespace は付与しない (メタ情報としてのみ記録)

---

## 各ファイルの仕様

### steps.json — カスタムステップ型

```json
{
  "namespace": "gm50",
  "steps": {
    "BatchProcessStep": {
      "label": "バッチ処理",
      "icon": "bi-gear",
      "description": "大量データの一括処理ステップ",
      "schema": {
        "type": "object",
        "required": ["batchId"],
        "additionalProperties": false,
        "properties": {
          "batchId": {
            "type": "string",
            "description": "バッチ定義 ID"
          },
          "chunkSize": {
            "type": "number",
            "description": "1 回の処理件数"
          }
        }
      }
    }
  }
}
```

- `label`: 処理フローエディターのカードパレットに表示される名称
- `icon`: Bootstrap Icons のクラス名
- `schema`: JSON Schema draft 2020-12 で記述。UI フォームはこの schema から動的生成される (対応サブセットは「動的フォーム生成スコープ」節参照)

**UI への反映**: 定義されたカスタムステップはカードパレットの「カスタム」セクションに表示され、D&D でフローに追加できる。

### field-types.json — FieldType 拡張

```json
{
  "namespace": "gm50",
  "fieldTypes": [
    {
      "kind": "view",
      "label": "ビュー"
    },
    {
      "kind": "tbl",
      "label": "テーブル参照 (旧TBL形式)"
    }
  ]
}
```

> **注意**: `{kind: "file"}` はグローバルスキーマ (#443) で追加済みのため、プラグインで定義する必要はない。
> グローバルに既存の `kind` (`"string"` 等) と同じ値をプラグインに書くと**バリデーションエラー**になる。

- `kind`: FieldType の `kind` 値として登録される
- `label`: UI 表示ラベル

### triggers.json — ActionTrigger 拡張

```json
{
  "namespace": "gm50",
  "triggers": [
    {
      "value": "webhook",
      "label": "Webhook"
    },
    {
      "value": "mq",
      "label": "メッセージキュー"
    }
  ]
}
```

> **注意**: `"auto"` はグローバルスキーマ (#443) で追加済みのため、プラグインで定義する必要はない。

### db-operations.json — DbOperation 拡張

```json
{
  "namespace": "gm50",
  "dbOperations": [
    { "value": "TRUNCATE", "label": "TRUNCATE" }
  ]
}
```

### response-types.json — レスポンス型定義 (typeCatalog 後継)

```json
{
  "namespace": "",
  "responseTypes": {
    "ApiError": {
      "description": "API エラーレスポンス",
      "schema": {
        "type": "object",
        "properties": {
          "code": { "type": "string" },
          "message": { "type": "string" }
        }
      }
    }
  }
}
```

`HttpResponseSpec.bodySchema = { "typeRef": "ApiError" }` の解決先。`typeCatalog` (ProcessFlow 内部) を廃止しこちらに移行する。

---

## バリデーター設計

### 動的読み込み

- 処理フロー JSON の検証のたびに `data/extensions/` を読み込む (再起動不要)
- マージ戦略: enum 拡張は追加のみ、step / response-type は同名キーでプラグインが上書き
- グローバルスキーマの enum にプラグインの値を追加した合成スキーマで検証する
- extensions/ が存在しない・空の場合はグローバルスキーマのみで検証

### サーバ側 (Node) とブラウザ側の経路

| 実行環境 | 読み込み経路 |
|---|---|
| Node (vitest, backend) | `readdirSync('data/extensions/')` で直接読み込み |
| ブラウザ (designer UI / E2E) | `wsBridge` 経由で取得 (`getExtensions` メッセージ追加) |

- ブラウザ側はキャッシュを持ち、wsBridge の broadcast (`extensionsChanged`) で invalidate する
- 拡張管理 UI (#447) からの編集後、broadcast → 全ブラウザタブが即時再取得 → カードパレット・バリデーター反映

---

## 動的フォーム生成スコープ

`steps.json` の `schema` から自動生成される編集フォーム (#446) で対応する JSON Schema 機能の範囲を**明示的に限定**する:

| キーワード | 対応 | UI |
|---|---|---|
| `type: "string"` | ✅ | テキスト入力 |
| `type: "number"` / `"integer"` | ✅ | 数値入力 |
| `type: "boolean"` | ✅ | チェックボックス |
| `enum` | ✅ | セレクトボックス |
| `type: "object"` + `properties` | ✅ | ネストしたフォーム (再帰) |
| `type: "array"` + `items` | ✅ | 追加/削除可能なリスト (再帰) |
| `required` | ✅ | 必須マーク + バリデーション |
| `description` | ✅ | フィールド説明文 |
| `default` | ✅ | 初期値 |
| **その他** (`oneOf` / `anyOf` / `allOf` / `$ref` / `if-then-else` / `dependencies` / `patternProperties` / `format` 等) | ❌ | **非対応**。schema validation 時にエラー |

- カスタムステップの schema 定義者は、上記サブセット内で書く必要がある
- 非対応キーワードを含む schema は `extensions-steps.schema.json` の段階で reject する (UI 側は対応キーワードのみを前提に実装可能)

---

## MCP ツール設計

AI がプラグインを操作するための専用ツール。拡張種別ごとに分ける (誤操作防止)。

| ツール名 | 操作 |
|---|---|
| `add_step_extension` | カスタムステップを追加・更新 |
| `add_field_type_extension` | FieldType を追加 |
| `add_trigger_extension` | ActionTrigger を追加 |
| `add_db_operation_extension` | DbOperation を追加 |
| `add_response_type_extension` | レスポンス型を追加 (旧 add_catalog_entry の typeCatalog 機能の後継) |
| `remove_extension` | 任意の拡張エントリを削除 |
| `list_extensions` | 現在の全拡張一覧を取得 |

### 既存 `add_catalog_entry` / `remove_catalog_entry` の扱い

これらの MCP ツールは現状 `errorCatalog` / `secretsCatalog` / `typeCatalog` / `externalSystemCatalog` の 4 種を扱う (`CatalogName` enum)。

- **typeCatalog** → 廃止し `add_response_type_extension` に置換
- **errorCatalog / secretsCatalog / externalSystemCatalog** → 引き続き ProcessFlow 内部のカタログとして残す (これらはグローバル化の必然性が低く、ProcessFlow 単位で完結する)
- `CatalogName` enum から `"typeCatalog"` を削除

---

## UI 設計

### 拡張管理パネル (#447)

ヘッダーメニューから「拡張管理」へ遷移できるシングルトンタブ (新ルート `/extensions`)。

- 拡張種別ごとにタブ表示 (ステップ / フィールド型 / トリガー / DB 操作 / レスポンス型)
- 各エントリの追加・編集・削除が可能
- 編集後は wsBridge broadcast で全ブラウザタブに即時反映 (再起動不要)

### カスタムステップの編集フォーム (#446)

カスタムステップをフロー上に配置した後の編集 UI:

- `steps.json` に定義された `schema` から「動的フォーム生成スコープ」節のサブセットでフォームを自動生成
- **汎用 JSON テキストエリアは不可** (業務設計者が使えないため)
- 標準ステップの専用パネル (DbAccessPanel 等) と同じ位置に表示

### カードパレット

標準ステップのカードに加え、「カスタム」セクションを設けてプラグイン定義のカードを表示。`label` と `icon` を使って表示。

---

## typeCatalog 移行 (#445 詳細スコープ)

ProcessFlow 内部にある `typeCatalog` を本仕様の `response-types.json` に移行する。**影響範囲が広いため #445 は以下の全項目をスコープに含む**。

### 影響範囲 (全 14 ファイル)

| 区分 | ファイル | 変更内容 |
|---|---|---|
| Schema | `schemas/process-flow.schema.json` | `typeCatalog` プロパティ削除 |
| TypeScript 型 | `frontend/src/types/action.ts` | `ProcessFlow.typeCatalog` 削除 |
| **クロスリファレンス検証** | `frontend/src/schemas/referentialIntegrity.ts` | `typeRef` の解決先を `group.typeCatalog` から**グローバル extensions** に変更 |
| 同テスト | `frontend/src/schemas/referentialIntegrity.test.ts` | typeCatalog ベースのテスト 2 件を extensions ベースに書き換え |
| Schema テスト | `frontend/src/schemas/samples-v3.schema.test.ts` | typeCatalog 関連テストを v3 extensions ベースに更新 (v1 凍結テストは削除済み — 現行は `samples-v3.schema.test.ts` / `v3-variant-coverage.test.ts`) |
| UI コンポーネント | `frontend/src/components/process-flow/TypeCatalogPanel.tsx` | 削除 |
| UI 統合 | `frontend/src/components/process-flow/ActionMetaTabBar.tsx` | typeCatalog タブ削除 |
| MCP ツール | `backend/src/tools.ts` | `CatalogName` enum から `typeCatalog` 削除 + 新 `add_response_type_extension` 追加 |
| MCP edits | `backend/src/processFlowEdits.ts` | `CatalogName` 型と `typeCatalog?` フィールド処理を削除 |
| E2E | `frontend/e2e/catalog-panels.spec.ts` | typeCatalog 関連シナリオを extensions パネル (#447) ベースに書き換え |
| サンプル | `docs/sample-project/process-flows/cccccccc-{0005,0006,0007,0008}-*.json` | `typeCatalog` セクションを抽出し `docs/sample-project/extensions/response-types.json` に移行 |
| サンプル仕様 | `docs/spec/process-flow-extensions.md`, `docs/user-guide/process-flow-workflow.md` | typeCatalog の記述をグローバル extensions に置換 |
| 設計者向け | `.claude/commands/designer-work.md` | typeCatalog 言及を更新 |

### referentialIntegrity の再設計

現状 `typeRef` 解決は `ProcessFlow.typeCatalog` 内部のキーをチェックしている。グローバル extensions に外出しすると、**バリデーター実行時に extensions を読む経路が必要**:

- Node 環境: `loadExtensions()` の戻り値を `checkReferentialIntegrity` に注入する API 変更 (引数追加)
- 既存呼び出し元 (テスト含む) の更新が必要
- ブラウザ環境: wsBridge から取得済みのキャッシュを引数で渡す

### UI デグレ防止 (順序制約)

`TypeCatalogPanel` を削除すると typeCatalog の編集 UI が一時的に消える。**回避策**:

- **#447 (拡張管理 UI) を #445 と同時マージする** (推奨)、または
- **#445 で `TypeCatalogPanel` を残し、内部実装だけを extensions ファイル書き込みに切り替える** (中間段階の暫定)

### MCP ツール後方互換

`add_catalog_entry catalogName=typeCatalog` の旧呼び出しは **deprecation warning + 自動的に `add_response_type_extension` に転送**するシムを 1 リリース置く。

---

## AI 向けガイド (操作規約)

AI が処理フロー設計中にプラグインを操作する際の判断規約。

### 拡張を追加する前に確認すること

1. **グローバルスキーマに既に存在しないか** — まず `list_extensions` とスキーマ定義を確認する
2. **グローバルに入れるべきものではないか** — 「どの業務プロジェクトでも必要か」を問う。そうなら実装者に報告してグローバル追加を提案する
3. **既存の拡張と名前が衝突しないか** — `list_extensions` で確認する。衝突する場合は名前空間を使う

### カスタムステップを追加する際の schema の書き方

- 「動的フォーム生成スコープ」節の対応キーワードのみを使う
- フィールドには必ず `description` を付ける (AI 実装者が読む)
- `required` を明示する
- `additionalProperties: false` を推奨 (意図しないフィールドの混入防止)

### やってはいけないこと

- グローバルスキーマで既にカバーされている enum 値をプラグインに重複定義する
- `namespace` を省略する (空文字列でも明示する)
- schema のない step を定義する
- 動的フォーム生成スコープ外のキーワード (`oneOf` / `$ref` 等) を使う

---

## #390 との関係

#390 (GM50 バッチ処理フロー対応) は本プラグインシステムの最初のユーザー。

**グローバルスキーマに追加 (#443 で実装済み・PR #448 マージ済)**:
- `FieldType`: `{kind: "file"}` を追加
- `ActionTrigger`: `"auto"` を追加
- `DbOperation`: `"MERGE"`, `"LOCK"` を追加
- `ValidationInlineBranch.ok/ng`: `string | Step[]` に拡張
- `CommonProcessStep.returnMapping`: プロパティ追加

**GM50 プラグインとして定義 (#390 本体で実装、子 ISSUE 完了後)**:
- `field-types.json`: `"csv"`, `"tsv"`, `"zip"`, `"view"` 等の GM50 固有型
- `"TBL"` → グローバルの `{kind: "tableRow"}` に正規化

プラグインシステムインフラ完成後、#390 は「GM50 用拡張定義ファイルを作成する」チケットとして実行する。

---

## 推奨実装順序 (改訂)

1. **#443** (グローバルスキーマ) ✅ マージ済み
2. **#444** (インフラ) — extensions/*.schema.json + ローダー + namespace 強制 + ブラウザ側経路 (wsBridge)
3. **#445 + #447 を同時 PR** — typeCatalog 移行と拡張管理 UI を一括マージ (UI デグレ回避)
   - または #445 で TypeCatalogPanel を残したまま内部だけ移行 → #447 で UI を差し替え
4. **#446** (動的フォーム) — #444 完了後
5. **#390** (GM50 プラグイン) — 全て完了後
6. **#449** (#443 negative テスト) — 並行実施可能
