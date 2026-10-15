# マーカー (AI への指示・質問) — 仕様書 (UI 改善提案 第 4 弾)

**Status**: 実装済 (2026-10)。スキーマの追加が要る部分は、設計者の判断待ち ([#1510](https://github.com/csilost2001/harmony/issues/1510))
**関連**: [ui-input-assist.md](ui-input-assist.md) / [ui-keyboard.md](ui-keyboard.md) / [schema-governance.md](schema-governance.md) / [docs/user-guide/marker-workflow.md](../user-guide/marker-workflow.md)

人が設計に付けた指示・質問を、AI (Claude Code の `/designer-work`) が読み、直して、結果を返す往復の仕組み。**スキーマは変えていない**。

## 1. 保存の場所 (画面と AI の共通)

マーカーは、設計の **`authoring.markers`** に保存する (schema の `Marker`: id = UUID・kind・body・author・createdAt・`anchor`・resolvedAt・resolution)。

- 以前、**MCP (`designer__list_markers` ほか) だけが、処理フローの最上位の `markers` (平らな stepId / fieldPath、id は `mk-…`) を読み書きしていた**。画面は `authoring.markers` を読み書きするので、**人が付けたマーカーを AI は読めず、AI が付けたマーカーは画面に出なかった** (schema にも合わない)。今回、共通の処理 (`@harmony/shared` の `markers.ts`) に揃えた
- 古い形のマーカー (最上位の `markers`) は、読むときにメモリ上で `authoring.markers` へ移す (id は、古い id から決まる同じ UUID なので、一覧と解決で食い違わない)。次の書き込みで保存される
- 対象の設計: 処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト (schema に `authoring` がある設計)。**業務フロー・帳票は、スキーマに `authoring` が無く、対象外** (#1510)

### 位置 (anchor)

| 設計 | 位置の書き方 |
|---|---|
| 処理フロー | `anchor.stepId` (+ `fieldPath`、手書きの `shape`) |
| テーブル | `anchor.fieldPath` = `$.columns[<カラムの id>]` |
| 画面 | `$.items[<項目の id>]` / `$.layout.nodes[<部品の id>]` |
| ページレイアウト | `$.regions[<region 名>]` |
| 位置なし | 設計全体 |

`fieldPath` は schema の既存の欄 (自由な文字列) で、この形は、共通の処理 (`anchorPath*` / `anchorLabel`) が持つ。

## 2. AI (MCP)

`designer__list_markers` / `designer__find_all_markers` / `designer__add_marker` / `designer__resolve_marker` / `designer__remove_marker` が、対象の設計を `entityType` + `entityId` で受ける (処理フローは、従来どおり `processFlowId` だけでもよい)。`find_all_markers` は全設計を横断し、`entityType` / `entityId` / `entityName` を付けて返す。`list_markers` は `fieldPathPrefix` (例 `$.columns[`) で絞れる。`add_marker` の種類は chat / attention / todo / question (validator はツールの警告用で、付けられない)。

`/designer-work` は、`<processFlowId>` / `<entityType> <entityId>` / 引数なし (全設計を一望してから) を受ける ([.claude/commands/designer-work.md](../../.claude/commands/designer-work.md))。

## 3. 画面 (どの編集画面でも同じ部品)

共通の部品 `MarkerListPanel` (`components/common/`): 種類を選び、(位置を選べる設計では) 位置を選び、本文を書く。

- **Enter で追加、Shift+Enter で改行、Ctrl+Enter でも追加**。日本語の変換中の Enter は追加しない (以前の 1 行の入力欄は、変換確定の Enter で送信していた)
- 解決 (メモつき・Ctrl+Enter)・未解決に戻す・削除。解決済みは既定では隠す
- 絞り込み: 解決済みも表示 / 種類のチップ (凡例を兼ねる)
- **AI に渡す文をコピー**: 未解決のマーカーを、対象の設計と位置つきの依頼の文 (`/designer-work` の案内つき) にして、クリップボードへ。Claude Code などに貼ればよい
- 「位置へ」(位置のあるもの)・位置が消えたマーカーの印

| 設計 | 置き場所 | 保存 |
|---|---|---|
| 処理フロー | 上部の「AI へのマーカー」(従来どおり。工程のチップ・手書きの赤線もそのまま) | 設計の保存 |
| テーブル | 「マーカー」タブ。カラムを指せる。未解決のあるカラムの行に件数のバッジ (クリックでタブへ) | 設計の保存 |
| シーケンス・ビュー・ビュー定義・ページレイアウト | 画面の先頭の節 | 設計の保存 |
| 画面 (項目) | 項目の画面の上部。項目を指せる。行のバッジ | **その場で保存** (設計の保存とは別。下記) |

**画面のマーカーが、その場で保存される理由**: 画面の保存は項目とレイアウトだけを書く作りで、マーカーを設計の編集中の内容に持つと、AI が並行して足したマーカーを、古い内容で上書きしてしまう。そこで、マーカーだけを、サーバの内容へ**差分 (追加・更新・削除) で重ねて保存**する RPC (`applyMarkerChanges`) を使う。AI が足したものは消えない。

### キー

- **Ctrl+Alt+M**: テーブル・画面項目では、フォーカスのあるカラム・項目について、追加欄を開く。処理フローでは、工程の見出しにカーソルがあるとき、その工程へのマーカーのダイアログ (複数行・種類を選べる。以前の「AI に指摘」は `window.prompt` だった) を開く
- コマンドパレット: 「マーカーを追加 (AI への指示・質問)」

## 4. 全設計の一覧と集計

- **マーカー一覧** (メニュー「マーカー (AI への指示)」、`/markers`): 全設計のマーカーを、古いもの (滞っているもの) から並べる。設計の種類・種類・語・解決済みで絞り込み。選んだものを、メモつきで、まとめて解決 (設計ごとに `applyMarkerChanges`)。「AI に渡す文をコピー」(選んだものだけ、無ければ未解決のすべて)。設計の名前から、編集画面へ
- **ダッシュボードの集計パネル**: 全設計の未解決の件数・種類別・設計の種類別・設計ごと・**いちばん古い未解決の経過日数**・新しい 5 件。「すべて見る」で一覧へ
- RPC: `listMarkers` (1 設計) / `listAllMarkers` (全設計。読むだけ。件数つき) / `applyMarkerChanges`。不正な形 (UUID でない id・空や 20,000 字を超える本文・知らない種類・書き手) は保存しない (`normalizeMarker`)

## 5. 今回はやっていないこと (正直に)

- **吹き出し・ピン** (対象の横に出る番号つきの吹き出し): 工程のチップとカラム・項目の行のバッジ (件数。クリックでパネルを開く) まで。返信を重ねる吹き出しは、返信の置き場 (スキーマ) が先 (#1510)
- **画面デザイナ (プレビュー) へのピン**: 画面のマーカーは項目の画面で付ける。部品 (`$.layout.nodes[…]`) を指すのは、MCP からは可能
- **AI の現在位置・対応状況の表示 / 返信スレッド / 担当・期限 / 差分の添付 / 画像 / レビューコメントとの整理**: スキーマの判断が先 (#1510)
- **UI から AI を起動して、その場で処理させる**: コピーした文を AI に貼る形。画面から AI を直接動かす入口は、Codex 連携の設計 (別) が先
- 手書きの赤線 (処理フロー) の本文入力は、従来どおり `window.prompt`
