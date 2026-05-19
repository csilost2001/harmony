# JSON Schema (一次成果物) — バージョン管理

このディレクトリは、Harnize Harmony の JSON 資産の**正規スキーマ**をバージョン別に保持する。

## ディレクトリ構成

```
schemas/
├── v3/                                          ← v3 (現行) 17 top-level + 7 generic-definitions/ = 24 file
│   ├── common.v3.schema.json                    ← 共通 $defs (全 v3 schema が参照)
│   ├── harmony.v3.schema.json
│   ├── process-flow.v3.schema.json
│   ├── conventions.v3.schema.json
│   ├── extensions.v3.schema.json
│   ├── external-catalogs.v3.schema.json
│   ├── screen.v3.schema.json
│   ├── screen-item.v3.schema.json
│   ├── screen-flow-positions.v3.schema.json
│   ├── table.v3.schema.json
│   ├── er-layout.v3.schema.json
│   ├── sequence.v3.schema.json
│   ├── view.v3.schema.json
│   ├── view-definition.v3.schema.json
│   ├── page-layout.v3.schema.json               ← RFC #1021 で導入
│   ├── custom-block.v3.schema.json
│   ├── generic-definition.v3.schema.json
│   ├── generic-definitions/                     ← Generic Definition Catalog kind 別 schema (#1063-)
│   │   ├── application-rule.v3.schema.json
│   │   ├── data-contract.v3.schema.json
│   │   ├── domain-type.v3.schema.json
│   │   ├── exception-type.v3.schema.json
│   │   ├── runtime-policy.v3.schema.json
│   │   ├── ui-behavior.v3.schema.json
│   │   └── ui-fragment.v3.schema.json
│   └── README.md                                ← schema 別の役割 / 配置 / 設計詳細はこちら
└── README.md (本ファイル)
```

各 schema の役割・配置 (`<dataDir>/...` 相対パス) は [`v3/README.md`](v3/README.md) 参照。

> **Note**: v1 / v2 は #774 で削除済み。過去の記録は `git log` を参照してください。

## バージョン管理ポリシー

### 凍結ポリシー

各バージョンディレクトリは**マージ後は修正不可**。バグ修正・機能追加は新バージョンを作成する。

理由:
- 既存案件が特定バージョンを参照している場合、後から変更すると validation 結果が変わる
- 業務データの schema 互換性を厳密に追跡する

例外: 起草中 (PR がまだ open) のバージョンは PR 内で改変可。マージ後は凍結。

### 新バージョンの作成

破壊的変更が必要になったら新バージョンディレクトリを作る:

```
schemas/v4/
├── common.v4.schema.json
├── process-flow.v4.schema.json
└── ...
```

非破壊的な追加 (optional フィールド追加 / additive enum) は同バージョン内で行う。

### バージョン選択

`harmony.json` に `schemaVersion` プロパティを記述することで、その案件が使う schema バージョンを宣言できる:

```json
{
  "schemaVersion": "v3",
  "meta": { "name": "顧客管理システム" },
  ...
}
```

loader (designer / backend / vitest) は本プロパティを読んで `schemas/v<N>/` を選択する想定。**現状は v3 をハードコードで参照**。

### `$id` 規約

各 schema の `$id` はバージョン込みで宣言する:

- v3: `https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/<name>.v3.schema.json`

外部 AI / CI は特定バージョンに固定して参照する。

## 一次成果物の原則

本プロジェクトは **AI が JSON を読み取って実装する** ことを主用途とする。したがって設計層の優先順位は:

| 順位 | 層 | 役割 |
|---|---|---|
| 1 (一次) | JSON Schema (`schemas/v<N>/*.schema.json`) | 機械可読な正規仕様 |
| 2 (派生) | TypeScript 型 (`frontend/src/types/*.ts`) | designer 内部のみ利用 |
| 3 (表示層) | UI (`frontend/src/components/*`) | エディタとしての視覚化 |

矛盾が起きたら **schema を正、TS 型と UI を schema に合わせる**。

## ガバナンス

schema 変更権限は **フレームワーク製作者 (設計者) の専権**。詳細: [`docs/spec/schema-governance.md`](../docs/spec/schema-governance.md) (#511)。

## 関連

- 設計原則: [`docs/spec/schema-design-principles.md`](../docs/spec/schema-design-principles.md)
- 過去監査: [`docs/spec/schema-audit-2026-04-27.md`](../docs/spec/schema-audit-2026-04-27.md)
