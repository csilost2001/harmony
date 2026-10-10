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
| CLI: `npm run check:design -- <workspace>... [--strict] [--info] [--json]` | 「要確認事項」だけを検査して一覧する (終了コード 0 = 問題なし / 1 = エラー (`--strict` なら警告も) あり / 2 = 読み込み失敗)。読めない (壊れた) JSON はエラー扱い。AI が設計を直したあと・コミット前の点検用。`npm run check` が `examples/` 全件を `--strict` で検査する |
| CLI: `npm run export:tests -- <workspace> [--format csv\|json\|md]` | テスト観点表を書き出す ([test-viewpoints.md](test-viewpoints.md))。設計書の付録「テスト観点 (画面入力)」と同じ導出 |
| ダッシュボード「設計の要確認」パネル | 要確認事項の件数 (エラー・警告・情報) と上位 6 件。クリックで設計書へ。保存・改名のたびに自動で更新する |

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
| 10〜 業務フロー (定義があるときだけ) | フローごとの図 (スイムレーン SVG) と工程表。工程から画面・処理へリンク ([business-flow.md](business-flow.md)) | business-flows/*.json |
| (業務フローの次) 帳票 (定義があるときだけ) | 帳票ごとの基本情報・出力条件・用紙の見本図・項目定義表。出力契機から画面・処理へリンク ([report.md](report.md)) | reports/*.json |
| (帳票の次) 権限 (定義か権限の指定があるときだけ) | 役割 / 権限 / 画面 × 役割 / 処理 × 役割 ([§3.1](#31-権限の章の導出規則)) | conventions catalog の role / permission、画面の permissions、処理の requiredPermissions |
| (権限の次) メッセージ一覧 | `@conv.msg.*` | conventions catalog |
| (最後) 要確認事項 | レイアウト検証結果、未作成のレイアウト、未配置項目、CRUD の所見、使われていない独自部品 | 上記の自動検出 |

画面設計の画面レイアウトは、独自部品の参照部品を定義で展開して描く (点線の枠と名前付き)。独自部品の中で `args` 経由で使われている画面項目は「配置済み」に数える。

### 3.1 権限の章の導出規則

新しいスキーマは使わず、既存の定義から導く (`shared/src/accessMatrix.ts`)。

- **役割の有効な権限** = 役割自身の `permissions` + `inherits` で継承した役割の有効な権限 (未定義の継承元・循環は無視して要確認に出す)
- **画面 × 役割**: 画面の `permissions` を**すべて**持つ役割に ○。権限を指定していない画面は「誰でも開ける」として表には載せず、件数だけ注記する
- **処理 × 役割**: 処理 (アクション) の `requiredPermissions` を同様に扱う。権限を指定していない処理は省略する
- 権限キーは `@conv.permission.<key>` でもキーだけでもよい
- 要確認事項に出す: 規約に無い権限を参照 (画面・処理・役割) / どの役割にも付与されていない権限を要求する画面・処理 (誰も使えない) / 役割の継承の不整合 / どこでも必要とされていない権限 (情報)

## 4. CRUD の導出規則

処理フロー内 (分岐・ループ・TX・ロールバック時・コミット後を含む) の `dbAccess` を集計する。`SELECT`=R、`INSERT`=C、`UPDATE`=U、`DELETE`=D、`UPSERT`/`MERGE`=C+U、名前に `DECREMENT`/`INCREMENT` を含む独自操作=U、`CLEAR` を含む独自操作=D、それ以外=R。

所見: どの処理フローからも使われないテーブル / 登録 (C) する処理が無いテーブル / 参照 (R) する処理が無いテーブル。

## 5. 表示

紙面はアプリのテーマに関係なく明色 (印刷・PDF 化を前提とする)。単体 HTML は印刷時に目次を隠し、章ごとに改ページする。
