# サンプルプロジェクト構造

## 位置づけ

`examples/<project-id>/` 以下の各サブディレクトリは、**designer で作成する業務アプリ設計成果物の独立したサンプル単位**。フレームワーク本体のデバッグ・テスト・動作確認・ドッグフード検証を多様なシナリオで行うために配置されている。

ディレクトリ命名 (`retail` / `realestate` 等) は **シナリオ題材を簡易表現したもの** に過ぎず、フレームワーク側に「業界」という概念は存在しない。各サブディレクトリは「1 つの完結した業務アプリ」として独立しており、相互に成果物を共有しない。

## 基本原則: プロジェクト = 完結した成果物セット

designer の実運用は **1 プロジェクト = 1 業務アプリ** 単位。
- designer の規約カタログ画面 (`/conventions/catalog`) は 1 プロジェクトに 1 つの規約カタログを永続化
- テーブル / 処理フロー / 拡張 / 画面 等もすべてプロジェクト単位

サンプルもこの実運用を模す。各サンプルプロジェクト (= サブディレクトリ) は以下の成果物を **個別に・完結して** 持つ。プロジェクト間で成果物を共有 (= サンプル特有の横断配置) してはならない。

## canonical 配置先

サンプルプロジェクトの唯一の canonical 配置先は **`examples/<project-id>/`**。

| 現行プロジェクト | 配置先 | 備考 |
|---|---|---|
| retail | `examples/retail/` | v3 schema / process-flows/ ディレクトリ |
| realestate | `examples/realestate/` | v3 schema / process-flows/ ディレクトリ |

## プロジェクトに含まれる成果物

各サンプルプロジェクト (`examples/<project-id>/`) の推奨レイアウト:

`<dataDir>` は `harmony.json` の `dataDir` field で指定 (推奨慣習: `"harmony"`)。

### 必須

| ファイル / ディレクトリ | schema | 役割 |
|---|---|---|
| `harmony.json` | `schemas/v3/harmony.v3.schema.json` | プロジェクトメタデータ (ID / 名称 / 説明 / 成熟度 / 作成日 / 更新日 + dataDir 指定)。**workspace root 直下** (dataDir 配下ではない、#849 で rename 旧 `project.json`) |
| `<dataDir>/tables/*.json` | `schemas/v3/table.v3.schema.json` | テーブル定義群 |
| `<dataDir>/process-flows/*.json` | `schemas/v3/process-flow.v3.schema.json` | 処理フロー群 (旧 `actions/` から rename、L54 参照) |
| `<dataDir>/extensions/<namespace>.v3.json` | `schemas/v3/extensions.v3.schema.json` | 拡張定義 (namespace 単位、v3 canonical combined format) |
| `<dataDir>/conventions/catalog.json` | `schemas/v3/conventions.v3.schema.json` | 規約カタログ (v3 canonical パス) |

### 任意 (シナリオで必要に応じて)

| ファイル / ディレクトリ | schema | 役割 |
|---|---|---|
| `<dataDir>/screens/*.json` | `schemas/v3/screen.v3.schema.json` | 画面 (画面項目定義 `items[]` を内包) |
| `<dataDir>/view-definitions/*.json` | `schemas/v3/view-definition.v3.schema.json` | ViewDefinition (UI viewer) |
| `<dataDir>/sequences/*.json` | `schemas/v3/sequence.v3.schema.json` | DB シーケンス定義 |
| `<dataDir>/views/*.json` | `schemas/v3/view.v3.schema.json` | DB ビュー定義 |
| `<dataDir>/page-layouts/*.json` | `schemas/v3/page-layout.v3.schema.json` | ページレイアウト (RFC #1021) |
| `<dataDir>/generic-definitions/<kind>/<name>.json` | `schemas/v3/generic-definition.v3.schema.json` + kind 別 schema | 汎用定義カタログ (kind 別ファイル、#1063-) |
| `<dataDir>/catalogs/external.json` | `schemas/v3/external-catalogs.v3.schema.json` | project-level 共有 catalog (外部システム / AI / シークレット / 環境変数 / イベント / 関数、#940 / #1142) |
| `<dataDir>/er-layout.json` | `schemas/v3/er-layout.v3.schema.json` | ER 図 UI 座標 + 論理リレーション |
| `<dataDir>/screen-flow-positions.json` | `schemas/v3/screen-flow-positions.v3.schema.json` | 画面フロー UI 座標 (Designer 専用) |
| `<dataDir>/custom-blocks.json` | `schemas/v3/custom-block.v3.schema.json` | GrapesJS カスタムブロック集合 |

### ❌ 廃止された配置

| 旧配置 | 状態 | 移行先 |
|---|---|---|
| `screen-items/<screenId>.json` | Phase 4-β で廃止 (#712) | `screens/<screenId>.json` の `items[]` に embed |
| `conventions-catalog.v3.json` (プロジェクトルート直下) | #774 で非推奨 (旧 dogfood パス) | `conventions/catalog.json` |
| `extensions/<namespace>/<type>.json` (種別ごと別ファイル) | 廃止 — retail で v3 canonical combined に移行済み | `extensions/<namespace>.v3.json` (combined format) |
| `actions/` (旧フロー DIR 命名) | 廃止 — retail で process-flows/ に移行済み | `process-flows/` |
| `docs/sample-project-v3/<project>/` | #774 で廃止 | `examples/<project-id>/` |
| `docs/sample-project/` (v1) | #774 で廃止 | 削除 (git log で参照可) |
| `docs/legacy-sample-project/` | #774 で廃止 | 削除 (git log で参照可) |

## `$schema` 相対パス規約

`examples/<project-id>/` 直下のファイル:
```
"$schema": "../../schemas/v3/<schema-name>.v3.schema.json"
```

`examples/<project-id>/<subdir>/` 直下のファイル:
```
"$schema": "../../../schemas/v3/<schema-name>.v3.schema.json"
```

`examples/retail/` の既存ファイルを参考にすること。

## 拡張定義 (extensions) の canonical 形式

### v3 canonical combined format (推奨)

`extensions/<namespace>.v3.json` — 1 namespace = 1 ファイルで全拡張種別を含む形式:

```json
{
  "$schema": "../../../schemas/v3/extensions.v3.schema.json",
  "namespace": "myns",
  "version": "1.0.0",
  "fieldTypes": [...],
  "triggers": [...],
  "dbOperations": [...],
  "steps": { "stepName": { ... } },
  "responseTypes": { "TypeName": { ... } }
}
```

- `validate:samples` は `*.v3.json` ファイルをこの形式として読み込む
- `namespace` フィールドが必須 (referentialIntegrity 検証で `<namespace>:<name>` 形式の参照解決に使用)

### レガシー形式 (廃止済み)

`extensions/<namespace>/field-types.json` / `triggers.json` / `db-operations.json` / `steps.json` / `response-types.json` — 種別ごと別ファイルの旧形式。retail サンプルは `retail.v3.json` への移行が完了済み。新規サンプルでは combined format のみ使用すること。

## 規約カタログ (conventions) の canonical パス

`conventions/catalog.json` — v3 canonical パス。

旧 dogfood パス `conventions-catalog.v3.json` (プロジェクトルート直下) は非推奨。`validate:samples` は `conventions/catalog.json` のみ参照する。

## 反パターン

### ❌ プロジェクト横断の単一ファイル配置

`examples/conventions-catalog.v3.json` のようにトップレベル単一ファイルで複数サンプルプロジェクト共通とするのは **禁止**。理由:

- designer の実運用 (1 プロジェクト 1 規約カタログ) と整合しない
- サンプルは実運用を模すべきで、サンプル特有の構造を持つと設計検証が破綻する
- 業務アプリ A が業務アプリ B の規約に依存することは普通あり得ない

これは規約カタログだけでなく、全リソース (project / tables / process-flows / extensions 等) に適用される原則。

### ❌ 「業界」という概念をフレームワークに持ち込む

サブディレクトリ名 (`retail` / `realestate`) は **題材** であって **意味のある分類** ではない。validator / loader / schema / UI が「業界」を判定材料にすることは禁止。任意のサンプル名 (例: `sample-a` / `demo-1`) でも動作する設計でなければならない。

### ❌ プロジェクトの一部リソース欠落を許容する

「ある業務アプリのサンプルだから規約は要らない」のような判断はしない。実運用では業務アプリは必ず規約カタログを持つので、サンプルにも必ず存在する。最小有効インスタンス (`{ "version": "1.0.0" }` のみで各カテゴリ未定義) でも良いので、ファイル自体は配置する。

## design.json の preview-only マーキング規約 (#763)

### 背景・目的

`screens/<id>.design.json` (GrapesJS 出力 HTML) には、見栄え確認のためのハードコードサンプル行が含まれることがある。AI がコンポーネントを生成する際、これが「preview ダミーで実 API 呼びに置き換える」のか「実データ初期値」なのかを判別する根拠が必要。本規約はその判別基準を定める。

### 規約本体

**属性**: HTML 要素に `data-preview-only="true"` を付与する。

**意味**: 「この DOM 要素配下の中身は、AI コード生成時に実 API 呼び結果で置換される placeholder」と解釈する。

**適用対象例**:

| 適用例 | 説明 |
|---|---|
| `<tbody data-item-id="xxx" data-preview-only="true">` | 一覧 viewer の hardcoded `<tr>` 行 (実データ一覧で置換) |
| `<select data-preview-only="true">` | 動的 options bind 時の hardcoded `<option>` (API 取得オプションで置換) |
| `<div data-preview-only="true">` | フロー出力で書き換わる文言を包む表示専用領域 |

**`direction: "viewer"` の screen-item との関係**: viewer screen-item を持つ画面では、対応する viewer DOM 要素 (= `data-item-id="<viewerId>"` を持つ `<tbody>` / `<ul>` / `<div>` 等の包含要素) 自体に `data-preview-only="true"` を付与することで「この一覧は実データで置換される、配下の hardcoded 行は preview のみ」と明示できる。

### AI コード生成器の解釈ルール

- `data-preview-only="true"` が付いた要素 → 子要素の中身は無視し、要素自体を対応する screen-item の binding で置換実装する
- 親要素に `data-item-id="<id>"` がある場合、対応する screen-item の `valueFrom: flowVariable` 等に従って実装する
- `data-preview-only` は **子要素を包含する** (親に付いていれば配下の中身全体が preview 対象)。兄弟要素・親の外側には影響しない。子要素を単独で preview-only にしたい場合は子要素に直接付与する

### 業務設計者向けの記述ルール

- preview ダミーは実装可能性検証 (見栄え・幅・空白の確認) のために温存を推奨する
- **実データに置換することを前提とする要素** (検索結果 / カート明細 / 一覧表示等) は **必ず** `data-preview-only="true"` を付ける
- 静的に表示確定する要素 (固定テキスト / ヘッダーラベル / ナビゲーション等) には付けない

## 検証規約

`npm run validate:samples` コマンド一本でサンプル検証を行う:

```bash
cd frontend
npm run validate:samples -- ../examples/retail
npm run validate:samples -- ../examples/realestate
```

- `examples/<project-id>/` を 1 プロジェクト単位で読み込む
- 12 バリデータ (sqlColumnValidator / sqlOrderValidator / conventionsValidator / referentialIntegrity / identifierScope / screenItemFlowValidator / screenItemFieldTypeValidator / screenItemRefKeyValidator / viewDefinitionValidator / screenNavigationValidator / runtimeContractValidator / processFlowAntipatternValidator) を実行
- エラーがあれば exit code 1、全 pass で exit code 0

> 旧コマンド `validate:dogfood` は #774 で削除済み。

## 関連

- `docs/spec/schema-governance.md` — schema 変更ガバナンス (本仕様の前提)
- `docs/spec/draft-state-policy.md` — 設計途中の保存許容ポリシー
- `frontend/scripts/validate-samples.ts` — サンプルプロジェクト検証 CLI
