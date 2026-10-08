# 設計書ビューと HTML 出力 — 仕様書

**Status**: 実装済 (2026-10、再設計 段階 3)
**関連**: [docs/plans/redesign-2026-10.md](../plans/redesign-2026-10.md) / [screen-layout.md](screen-layout.md)

## 1. 目的

設計データ (JSON) を、日本の現場で使われる設計書の体裁 (表紙・一覧・項目定義表・処理記述表・CRUD 図) で読めるようにする。レビュー・承認・顧客説明に使う「紙面」を、原本と常に一致した状態で提供する。

- 出力は **一方向**。HTML を直しても原本には戻らない。修正は Harmony 上で原本に対して行う
- Excel 出力は当面サポートしない (設計者判断 2026-10-08)。HTML の方が表現力が高く AI も扱いやすい

## 2. 入口

| 入口 | 内容 |
|---|---|
| アプリ: ヘッダーメニュー「設計書」(`/document`) | 目次 + 紙面を表示。「再生成」「別タブで開く (印刷用)」「HTML で保存」 |
| CLI: `node scripts/export-design-doc.mjs <workspace> [--out file.html] [--version v]` | 単体の HTML ファイル (CSS・目次同梱) を書き出す。版は省略時 git の短縮 SHA |

どちらも `@harmony/shared` の `buildDesignDocument` / `renderStandaloneDesignDoc` で生成する (同じ内容になる)。対象の処理フロー・テーブルは `harmony.json` に登録されたもの。

## 3. 構成

| 章 | 内容 | 出典 |
|---|---|---|
| 表紙 | システム名・版・作成日・件数・承認欄 | harmony.json meta |
| 1 画面一覧 | 画面 ID / 画面名 / 種別 / URL / 成熟度 | screens |
| 2 画面遷移 | 遷移元 → 遷移先 / 契機 | harmony.json screenTransitions |
| 3 画面設計 (画面ごと) | 基本情報、概要、画面レイアウト (業務部品の木の静的描画)、項目定義表、イベント、関連処理 | screen.layout / items |
| 4 処理一覧 / 処理設計 (フローごと) | 基本情報、アクションごとの入出力・フロー図 (SVG)・処理記述表 | process-flows |
| 5 テーブル一覧 / テーブル定義 | 列定義、インデックス、利用箇所 (CRUD) | tables |
| 6 CRUD 図 | 処理フロー × テーブルのマトリクスと所見 | process-flows の dbAccess |
| 7 バッチ・定期処理一覧 | flowType が batch / scheduled の処理と起動 | process-flows |
| 8 外部インタフェース一覧 | externalSystem ステップから導出した外部システムと呼び出し | process-flows |
| 9 イベント一覧 | 発行 / 購読する処理とカタログの説明 | process-flows / catalogs.events |
| 10 独自部品 (定義があるときだけ) | 独自部品ごとの差し込み口・見た目・使っている画面 ([layout-components.md](layout-components.md)) | layout-components.json |
| 10 or 11 メッセージ一覧 | `@conv.msg.*` | conventions catalog |
| 11 or 12 要確認事項 | レイアウト検証結果、未作成のレイアウト、未配置項目、CRUD の所見、使われていない独自部品 | 上記の自動検出 |

画面設計の画面レイアウトは、独自部品の参照部品を定義で展開して描く (点線の枠と名前付き)。独自部品の中で `args` 経由で使われている画面項目は「配置済み」に数える。

## 4. CRUD の導出規則

処理フロー内 (分岐・ループ・TX・ロールバック時・コミット後を含む) の `dbAccess` を集計する。`SELECT`=R、`INSERT`=C、`UPDATE`=U、`DELETE`=D、`UPSERT`/`MERGE`=C+U、名前に `DECREMENT`/`INCREMENT` を含む独自操作=U、`CLEAR` を含む独自操作=D、それ以外=R。

所見: どの処理フローからも使われないテーブル / 登録 (C) する処理が無いテーブル / 参照 (R) する処理が無いテーブル。

## 5. 表示

紙面はアプリのテーマに関係なく明色 (印刷・PDF 化を前提とする)。単体 HTML は印刷時に目次を隠し、章ごとに改ページする。
