# 設計の分析 (改善提案 第 3 弾)

設計の品質を、機械が助ける機能の仕様。画面は「設計の分析」(`/analysis`。メニューの「出力」)。計算はすべて `@harmony/shared` の純粋関数 (`shared/src/analysis/`) で、画面・`npm run check:design`・MCP が同じ結果を使う。**設計は書き換えない** (書くのは点検の設定 [design-check.md](design-check.md) と、進捗の記録だけ)。

入力は設計書と同じ `DesignDocInput` (画面・処理フロー・テーブル・業務フロー・帳票・規約・独自部品・汎用定義)。シーケンス・ビュー・ページレイアウトは入力に含まれないため、対象外。

## 機能

| タブ | 内容 | 実装 | MCP (`designer__analyze_design` の kind) |
|---|---|---|---|
| 要確認 | 要確認事項の一覧、理由つきの抑制 (期限つき可)、抑制中・期限切れ・該当がなくなった抑制の見直し | `suppress.ts` | `suppressions` |
| 影響分析 | 変える設計 (テーブルは列でも) を選ぶと、連鎖して影響する設計を段ごとに示す | `graph.ts` / `impact.ts` | `impact` |
| 対応表 | 業務フロー→画面→処理→テーブル (CRUD)→テスト観点の表と欠け / 画面項目↔カラム / 役割×画面×操作 | `traceability.ts` / `columnMap.ts` / `accessOps.ts` | `traceability` / `column-map` / `operations` |
| 整理 | 未使用の定義 / 用語の揺れ / メッセージの使用箇所・重複 / **SQL の一覧と重複** | `unused.ts` / `terms.ts` / `messages.ts` / `sqlCatalog.ts` | `unused` / `terms` / `messages` / `sql` |
| 運用 | SLA の宣言の一覧と漏れ / ジョブの一覧と依存 / 外部システムの呼び出しと相手の OpenAPI の突き合わせ | `operations.ts` / `externalContract.ts` | `sla` / `jobs` / `external` |
| 進捗 | 種類ごとの成熟度の集計・確定までの残り・日ごとの推移 | `progress.ts` (+ backend `progressStore.ts`) | `progress` |
| ルール | 命名規約の設定状況・独自の検査ルールの編集 | `naming.ts` / `customRules.ts` | (check_design に含まれる) |
| 書き出し | テスト雛形 / テストデータ / OpenAPI | `testScaffold.ts` / `testData.ts` / `openapi.ts` | `get_test_viewpoints` (`scaffold`) / `generate_test_data` / `export_openapi` |

表は CSV で保存できる (対応表・SLA・SQL の一覧)。CSV の文字列セルは、Excel で式として解釈されないよう、`= + - @` で始まるものの先頭に `'` を付ける。

ダッシュボードには「設計の完成度」パネル (種類別の成熟度) が加わり、「設計の要確認」パネルは抑制中の件数を出す。

## SQL の一覧と重複

SQL は、処理フローの DB アクセス工程に直接書く (MyBatis のように別管理にはしない: サンプルでは、SQL 100 件のうち、複数の処理フローをまたいで同じものは 5 件だけで、工程の中にあるほうが、流れとして読める)。代わりに、次の 2 つを足した。

- **SQL の一覧** (設計の分析 > 整理 > SQL): すべての処理フローの、SQL つきの DB アクセス工程を 1 つの表にする (処理フロー・アクション・説明・テーブル・操作・SQL)。**CSV で保存**できる (DBA・レビューへの共有用。「同じ SQL の件数」の列つき)。MCP は `designer__analyze_design` の `kind: "sql"` (`format: "csv"` も可)
- **同じ SQL の検出**: 差し込む変数 (`@x` `:x` `$1`)・文字列の中身・空白・大文字小文字の違いを除いて同じになる SQL が 2 か所以上あるときは、**要確認 (情報)** として知らせる (「共通処理・ビュー定義にまとめられないか」の目安)。情報なので、`npm run check:design` は失敗にせず、`--info` で表示。40 文字未満の短い SQL は数えない。PostgreSQL のキャスト (`::型`) は、引数と取り違えない。要確認の内容には、場所や件数を入れない (増減・改名で、理由つきの抑制が外れないため。場所は SQL の一覧で見る)。意図どおりなら、そのままで構わない (抑制もできる)

読み取りのみで、設計は書き換えない。

## 参照のつながり (影響分析・未使用・対応表の共通)

辺は「from が to に頼っている (to を変えると from に影響する)」向き。

- 画面項目 → テーブルの列 (`binding.kind=tableColumn`)、画面 → 処理 (項目のイベント `handlerFlowId`)、画面 → 独自部品
- 画面 → 画面 (画面遷移)
- 処理 → テーブル (DB アクセス)、処理 → 画面 (`meta.screenId`・画面遷移ステップ)、処理 → 処理 (共通処理 `commonProcess`、イベントの購読 → 発行元)
- テーブル → テーブル (外部キー。`noConstraint` の論理 FK も含む)
- 業務フロー → 画面・処理 (工程の参照)、帳票 → 画面・処理・テーブルの列 (契機・出どころ)
- 設計の本文の `@conv.msg.*` / `@conv.regex.*` / `@conv.limit.*` / `generic-definitions/<種類>/<名前>` の文字列参照 → メッセージ・正規表現・上限値・汎用定義

列で絞った影響分析は、1 段目を、その列に結び付いた参照 (画面項目の結び付き・帳票の出どころ・その列を指す外部キーの子テーブル) と、DB アクセスの SQL / 対象フィールドに列の物理名が含まれる処理に限る。

## 各分析の規則

- **未使用**: テーブルは、処理・画面項目・帳票から使われていなければ未使用 (他のテーブルの外部キーの参照先であるだけなら、その旨を添える)。画面は、遷移・業務フロー・帳票・処理の画面遷移のどれからも辿れないもの (その画面の処理 `meta.screenId` が結び付いているだけでは、使われているとは数えない。入口の画面なら問題ない)。**シーケンス・ビュー・ページレイアウトから使われているかは見ていない**ので、そこからだけ使われているテーブル・列も、未使用・使われていない列に出る (消す前に「参照元」で確かめる)。処理は、画面のイベント・業務フロー・共通処理・購読から呼ばれず、バッチ・定期・HTTP の契約を持つもの・画面に結び付くものでもないもの。汎用定義は、参照の形が決まっている種類 (component-definition / exception-type / global) だけ。
- **用語の揺れ**: テーブル・列・画面項目の (物理名, 表示名) で、同じ物理名 (snake_case と camelCase は同じ) で表示名が違うもの / 同じ表示名で物理名が違うもの。`id` `name` `code` など、文脈で意味が変わる汎用の名前は除く。統一の候補は、いちばん多く使われている表記。
- **命名規約**: 規約カタログの正規表現 `@conv.regex.namingTable` / `namingColumn` / `namingScreen` / `namingProcessFlow` / `namingScreenItem` に、物理名・ID が合わなければ要確認 (警告)。接頭辞の規約も正規表現 (`^m_`) で書く。明示の規約が無いテーブル・カラムの物理名には、DB 規約 (`@conv.db`) の `namingConvention` (snake_case / camelCase / PascalCase / UPPER_SNAKE_CASE / kebab-case) を既定として適用する。使えない正規表現 (繰り返しのグループ・後方参照・長すぎるなど。許す形は [design-check.md](design-check.md)) は、規約として使わず、その旨を警告する。
- **画面項目↔カラム**: 入力項目 (`isInputItem`) で結び付きが無いものを「保存先も受け渡し先も決まっていない」とする (フォーム・変数などへの結び付きは「列以外」)。存在しないテーブル・列を指すもの。列が使われているかは、画面項目の結び付き・処理の SQL / 対象フィールド・帳票の出どころで判断する (主キー・外部キー・DB 規約の更新日時・論理削除の列は除く。`SELECT *` や SQL の無いアクセスがあるテーブルは、列単位では判断しない)。
- **権限 (操作単位)**: 画面の `permissions` と、アクションの `requiredPermissions` の両方を満たす役割が、その操作を使える。更新を伴う (INSERT / UPDATE / DELETE の DB アクセス、または POST / PUT / PATCH / DELETE の HTTP) のに、画面にも操作にも権限が無いものは警告 (設計書の要確認にも出る)。人が呼ぶ入口 (画面・HTTP の契約) のあるものだけで、バッチ・イベントの購読・共通処理は、呼び出し元の権限で守られるものとして、指摘しない。役割・権限を一切使っていないプロジェクトでは、指摘しない。
- **メッセージ**: 使用箇所は参照のつながり。定義の無い `@conv.msg.*` の参照も出す。重複は、差し込み `{x}`・記号・空白をそろえた文面が同じもの (同じ文面) と、2 文字の組の Dice 係数が 0.85 以上のもの (似ている)。
- **SLA**: アクションの `sla`、なければ処理フロー全体の `meta.sla`。外部から呼ぶ API (HTTP の契約あり) とジョブに宣言が無いものを漏れとする。要件の一覧 (どの性能を満たすべきか) は、設計データに持つ場所が無いため扱わない。
- **ジョブ**: `flowType` が batch / scheduled の処理フロー。更新するテーブル・発行 / 購読するイベント・先に動くべきもの (購読するイベントの発行元・共通処理) を出す。実行の時刻・再実行の定義は、設計データに持つ場所が無いため扱わない。
- **外部システムの契約**: 処理フローのカタログ `externalSystems[].openApiSpec` が指す OpenAPI (ワークスペース内の JSON) と、`externalSystem` ステップの `httpCall` / `operationRef` / `operationId` を、メソッドとパス (`{id}` `:id` `${x}` はそろえる。`servers` の URL のパスと `baseUrl` のパスは足して試す) で突き合わせる。URL で指す定義は取りに行かない。YAML は読まない。ワークスペースの外のファイル (シンボリックリンクの先を含む)・通常のファイルでないもの・5 MB を超えるファイルは読まない (大きさは、申告を信じず、上限までしか読まない)。
- **完成度**: 画面 (部品画面を除く)・処理フロー・テーブル・業務フロー・帳票の `maturity` (draft / provisional / committed)。決まっていないものは下書き。推移は、画面を開いた日 (ダッシュボードのパネルの表示・進捗タブ) の記録を、`<ワークスペース>/.harmony-progress/history.json` に最大 366 日残して並べる (git には載らない。MCP の読み取りでは記録しない)。
- **テスト雛形**: テスト観点表 ([test-viewpoints.md](test-viewpoints.md)) の観点の ID を題名にした未実装のテスト (Vitest / Jest は `it.todo`、Playwright は `test.fixme`)。題名は JSON 文字列として、コメントは 1 行にして、コメントを閉じる文字列を無害化して出す。
- **テストデータ**: 型・長さ・NOT NULL・主キー・一意 (複合を含む)・外部キー (親を先に作り、親の行から選ぶ)・単純な CHECK (`col > n` / `col IN (...)` / `col BETWEEN a AND b`) に沿った行。seed と行数が同じなら同じデータ。1 テーブル 1000 行まで。読めない CHECK 式・外部キーの循環は警告。出力は INSERT 文 (標準 / MySQL / SQL Server の引用)・CSV・JSON。文字列の値の `\` は、MySQL では `\\` にして入れ、ほかの方言では除く (MySQL へ流し込まれても、引用符から抜けないように)。出力のコメント (`--`・`//`) に入れる設計の名前は、改行・U+2028・U+2029 などの行の終わりを空白にする。
- **OpenAPI**: アクションの `httpRoute` (メソッド・パス・認証)・`inputs`・`outputs`・`responses` から OpenAPI 3.0.3 (JSON)。GET / DELETE の入力はクエリ、そのほかはリクエストの本文、パスの `:id` は `{id}`。`operationId` は `<処理フロー ID>_<アクション ID>`。メソッドとパスが重複したら、先のものだけ。

## DDL (テーブル編集の「DDL プレビュー」)

- 方言に SQL Server を追加した (MySQL / PostgreSQL / Oracle / SQL Server / SQLite / 標準)。識別子は `[ ]`、型は NVARCHAR・BIT・DATETIME2 など、自動採番は `IDENTITY(1,1)`、説明は拡張プロパティ、トリガーは文単位 (BEFORE は INSTEAD OF にして注意を添える)。
- 「保存前の版との差分 (ALTER)」: テーブルの保存前の版 ([file-backup.md](file-backup.md)) を選ぶと、今の定義との差を ALTER 文にする (`frontend/src/utils/ddlAlter.ts`)。列は `id` で対応づける (物理名の変更は RENAME)。インデックス・制約は `id` で対応づけ、変わったものは作り直す。列の削除・長さを縮める変更は、データを失いうる変更として注意を添える。主キー・一意の指定の変更、SQLite の列の変更は、実行しない注意書きにする。**MCP の `designer__generate_ddl` は、従来の生成のままで、SQL Server・差分には対応していない。**

## MCP

読み取りのみ (`HARMONY_MCP_MODE=readonly` でも使える): `designer__analyze_design` / `designer__export_openapi` / `designer__generate_test_data`。`designer__get_test_viewpoints` は `scaffold` (vitest / jest / playwright) でテスト雛形を返す。`designer__check_design` は、抑制した件数 (`suppressed`) を返す。**要確認を抑制する tool は無い** (AI が、直さずに黙らせないため。抑制は画面か `design-check.json` で、人が理由を残して行う)。

## 扱わないもの (スキーマの追加が要る)

状態遷移の定義・初期データ (マスタデータ) の定義・非機能要件の一覧・ジョブの時刻と再実行の定義は、設計データに持つ場所が無く、拡張機構・既存項目では表せない。スキーマは設計者の専権なので、設計者の判断を待つ (ISSUE #1499。[schema-governance.md](schema-governance.md))。
