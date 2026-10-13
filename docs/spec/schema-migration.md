# スキーマの版の移行

スキーマの版 (`harmony.json` の `schemaVersion`) が上がったとき、既存の設計データ (JSON) を新しい版へ書き換える枠組み。

> スキーマそのもの (`schemas/v3/*.json`) の変更は**設計者の専権** ([schema-governance.md](schema-governance.md))。この枠組みは、設計者が決めた版の変更を既存データへ反映する道具で、何を移行するかは決めない。リリース前は後方互換を持たない方針のため、**登録された移行はいまは空** (最新の版 v3 では「移行は不要」と返る)。

## 使い方

- コマンド: `npm run migrate:schema -- <workspace-dir> [--apply]` (既定は予行。書かずに、書き換わるファイルと変わる項目を表示する)
- AI (MCP): `designer__migrate_schema` (`apply: true` で実行。編集中のセッションがあるときは実行できない)
- 書き換える前の内容は、保存と同じ世代 ([file-backup.md](file-backup.md)) に残るので、戻せる
- 移行は冪等にする。各設計を先に書き、最後に `harmony.json` の `schemaVersion` を上げるので、途中で止まっても、もう一度実行できる
- **読めないファイルがあるとき、apply は実行しない** (版を上げると、そのファイルは旧版のまま、あとから移行されなくなるため)。予行は、飛ばしたファイルを知らせる
- 対象は、設計の実体 (画面・テーブル・処理フロー・シーケンス・ビュー・ビュー定義・ページレイアウト) のほか、業務フロー・帳票・画面項目 (`screen-items`)・汎用定義・規約 (`conventions/catalog.json`)・独自部品 (`layout-components.json`)・`harmony.json`。`targets` で種類を絞れる (`businessFlow` / `report` / `screenItems` / `genericDefinition` / `conventions` / `layoutComponents` / `project`)
- コマンドの `--apply` は、backend が動いているあいだは拒否する (編集中の画面が古い内容で上書きして、移行を巻き戻さないため。確かめた上で実行するなら `--even-if-running`)。MCP の `designer__migrate_schema` は、編集中のセッションが無いことを確かめてから実行する

## 移行を足すとき

`backend/src/schemaMigration.ts` の `MIGRATIONS` に、次を足す (スキーマの版を上げる変更と同じ PR で)。

```ts
{
  id: "v3-to-v4/rename-name",         // 一意の名前
  from: "v3", to: "v4",
  description: "name → title",
  targets: ["table"],                 // 省略時はすべての種類。"project" は harmony.json
  migrate(data, { target, id }) { ... return 新しい値 },   // 渡された値は書き換えない
}
```

版は順にたどる (v3 → v4 → v5)。途中の版が欠けていると、実行せずに止まる。あわせて `LATEST_SCHEMA_VERSION` を上げる。テスト (`hardening.test.ts` の「スキーマの版の移行の枠組み」) の例を参考にする。
