---
description: "点検の設定 design-check.json (要確認の抑制・独自の検査ルール)"
status: current
category: design
---

# 点検の設定 (`design-check.json`)

要確認事項の**抑制**と、プロジェクト独自の**検査ルール**を置く設定ファイル。場所は `<データフォルダ>/design-check.json` (例: `examples/retail/harmony/design-check.json`)。設計の原本ではなく運用の設定なので、`schemas/v3` には載せず、コード側 (`@harmony/shared` の `parseCheckSettings`) で検証する。git で、設計と一緒にチームで共有できる。

```json
{
  "version": 1,
  "suppressions": [
    { "key": "i-f307b62378933667", "reason": "ログアウトは、誰でも実行できる操作のため", "expiresOn": "2027-03-31", "by": "設計者", "at": "2026-10-14T00:00:00.000Z",
      "severity": "warning", "section": "処理フロー ヘッダーガジェット処理", "message": "更新を伴う操作「ログアウト処理」…" }
  ],
  "rules": [
    { "id": "table-description", "name": "テーブルの説明は必須", "target": "table", "path": "description", "check": { "type": "required" }, "severity": "warning" }
  ]
}
```

## 検査の内容 (要確認事項)

`designer__check_design` / `npm run check:design` / 設計書の「要確認事項」は、同じ検査を使う。主なもの:

- **設計どうしの参照の整合** (`shared/src/analysis/integrity.ts`): 処理フローの `meta.screenId`・DB アクセスの `tableId`・画面遷移の `targetScreenId`・`return` の `responseId`、画面項目の結びつき先のテーブルとカラム・イベントが呼ぶ処理フロー / アクション、テーブルの外部キーの参照先、規約の参照 (`@conv.limit.*` `regex` `msg` `role` `permission`。その種類の定義が 1 つもないときは見ない — 規約が読めていないと全部が未定義になるため。`@conv.limit.max-1` のように式が続く参照・`product:view` の形の権限キーも扱う)、`inlineBranch.ngResponseId` が `responses` にあること、分岐の道の条件が空、同じアクションでの工程 id の重複 (警告)。アクションをまたぐ同じ工程 id は**情報** (動作は壊れないが、工程を id で指す操作は、最初に見つかったアクションに当たる)
- **スキーマ違反**: 工程は、その**種類 (kind) の定義に対してだけ**検査し直した違反を出す (工程は 26 種類の oneOf で、そのまま検査すると 1 つの項目の不足で 100 件以上並ぶ)。種類の綴り間違いは kind の違反 1 件
- 画面・テーブル・業務フロー・帳票・権限・CRUD・SQL の重複 など (各仕様書)

細かい契約 (式の中の変数・SQL の列・画面項目の型 ほか) は `cd frontend && npm run validate:samples -- ../examples/<project-id>` と画面の欄の直下の指摘が見る。

**回帰試験**: `backend/src/designMutation.test.ts` が、正しい設計 (retail) をわざと壊し (テーブルの削除・参照先の誤り・工程 id の重複・規約の参照切れ・必須項目の欠落・JSON の破損 ほか 15 種)、検査が見つけることと、雑音で原因が埋もれないことを確かめる。検査に穴を見つけたら、壊し方をここに足す。

## 抑制

- 「意図どおり」の要確認を、**理由 (必須) つき**で止める。期限 (`expiresOn`、YYYY-MM-DD) を付けると、その日の翌日から効かなくなり、要確認に戻る。
- 指摘の `key` は、重大度・対象・内容から決まる (`issueKey`)。指摘の内容が変わると別の指摘になり、抑制は効かなくなる (該当がなくなった抑制として、整理の対象に出る)。
- 抑制すると、設計書の要確認・ダッシュボード・`npm run check:design`・MCP `designer__check_design` から外れる。件数は「理由つきで抑制中 N 件」と出る。
- 操作: 設計の分析の「要確認」タブ (抑制… → 理由・期限)。外す・期限切れの記録を消す・該当のなくなった抑制をまとめて整理するのも、同じタブ。
- **AI (MCP) に出さないのは「抑制する tool」であって、ファイルの保護ではない。** AI がファイルを直接編集できる環境 (Claude Code / Codex のファイル編集) では `design-check.json` を書けてしまう。抑制の変更は git の差分に出るので、レビューで見る。
- backend は、`key` と内容が合わない抑制 (別の指摘を止めてしまう) と、理由の無い抑制を受け付けない。**AI (MCP) には、抑制する tool を出さない。**

## 独自の検査ルール

コードではなく宣言で書く (任意のコードは実行しない)。

| 項目 | 意味 |
|---|---|
| `target` | 対象の種類: screen / screenItem / processFlow / action / table / column / businessFlow / report |
| `path` | 対象の JSON の中の項目の場所 (`description`・`meta.maturity`・`length` など。英数字と `.`。`__proto__` `constructor` `prototype` は不可) |
| `check` | `required` (空でない) / `forbidden` (空である) / `pattern` (正規表現) / `oneOf` (候補) / `range` (min・max) |
| `when` | 適用の条件 (`path` の値が `equals` と等しい、または `notEmpty`)。省略なら対象すべて |
| `severity` / `message` / `enabled` | 重大度 / 違反の文言 (省略なら自動) / `false` で止める |

正規表現は、ReDoS (入力しだいで極端に遅くなる) を避けるため、許す形を絞る: 長さ 200 文字まで・フラグは i m s u だけ・後方参照は不可・繰り返し (`*` `+` `?` `{n,m}`) の「最悪の試行の数」(各繰り返しの上限 + 1 の積。終わりのないものは 300 とみなす) が 5 千万以下 (終わりのない繰り返しが 3 つまで、に相当)・**2 回以上の繰り返しをつけたグループは、区切りになる 1 文字を持つ形だけ** (選択・入れ子を含まず、繰り返しのついていない 1 文字が、グループ内の他の要素と ASCII の文字を共有しない。例: `(_[a-z0-9]+)*`・`([A-Z][a-z0-9]*)+`・`([a-z0-9]+-)*`。`(a|aa)+`・`(a+)+`・`(.*a){5}` は不可)。先読み・後読みは使える (中の繰り返しは数える)。値は 300 文字までを検査し、それより長い値は検査しない。命名規約の正規表現にも、同じ検査を使う。完全な ReDoS 対策ではない (多項式の遅さは、積の上限と値の長さの上限で抑える)。 違反は要確認 (指定の重大度) に出る。編集は設計の分析の「ルール」タブで、保存前に、いまの設計への当てはまり (試し打ち) を見られる。

## 読み込みと書き込み

- 読み込み: JSON として壊れたファイルは、**空とは読まず**、理由 (行・桁) を問題として返す (画面の警告・要確認・`check:design` のエラー)。壊れた項目 (理由が空・期限が日付でない・ルールの形が不正・ID の重複・危険な正規表現) は**捨てて**、理由を問題として返す (画面の警告・`check:design` の警告)。ファイルが JSON として壊れていれば、`check:design` はエラーにして、抑制・ルールを適用しない。
- 書き込み: 検証に通らなければ書かずにエラー。**読み込みで捨てる項目があるファイルへは、書き込まない** (書くと、その項目が消えるため。ファイルを直してから)。例外: 画面の「ルール」タブの保存は、読めない項目を一覧して、利用者が確認したときだけ、読めない項目を捨てて書き直せる (`discardUnreadable`)。JSON の構文が壊れているファイルは、これでも書かない。上書き前の内容は、ほかの設計と同じく世代で残る ([file-backup.md](file-backup.md))。
- ほかの人・外部の編集で変わったら、`designCheckChanged` を画面へ通知する。

## 命名規約 (規約カタログ)

`design-check.json` ではなく、規約カタログの `regex` で決める (スキーマの変更なし)。キーは決まっている: `namingTable` / `namingColumn` / `namingScreen` / `namingProcessFlow` / `namingScreenItem`。詳細は [design-analysis.md](design-analysis.md)。

## 既存プロジェクトへの影響 (第 3 弾の導入時)

次の検査が、設計書の要確認・`npm run check:design` に加わった。`--strict` で警告を失敗にしているプロジェクトでは、新しく失敗することがある。

- 権限の仕組み (役割・権限・画面 / アクションの必要な権限) を使っているプロジェクトで、**画面または HTTP の契約から呼ぶ、更新を伴う操作**に権限が決まっていないもの (警告)
- DB 規約の `namingConvention` が読み取れる形 (snake_case など) のとき、それに合わないテーブル・カラムの物理名 (警告)
- 規約カタログに `namingTable` などの正規表現があるとき、それに合わない物理名・ID (警告)

意図どおりのものは、理由つきで抑制する (retail の `design-check.json` を参照)。
