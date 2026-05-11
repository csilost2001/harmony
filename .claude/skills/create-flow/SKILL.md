---
name: create-flow
description: ProcessFlow JSON を品質ガード付きで新規作成する。/review-flow の 17 観点 + 33 ルールを作成前 self-check として組み込み、既知パターンの再発を抑制 + グローバル schema 変更禁止 (#511) + 画面項目連携整合性 (#621) + runtime 契約整合性 (#714) + retail dogfood 既知パターン (#740) + SQL alias 必須 (#775) + multi-store dogfood 観点 (#780)
argument-hint: <flowId> <業務概要> [namespace]
disable-model-invocation: true
---

<!--
  使い方:
    - `/create-flow ffffffff-0001-4000-8000-ffffffffffff "受注処理 → 在庫引当 → 出荷指示" logistics`
    - `/create-flow <flowId> <業務概要>` (namespace なしでもよい)

  目的:
    ProcessFlow JSON の作成時点で `/review-flow` の 17 観点を self-check として遵守させ、
    既知パターン (TX outputBinding ネスト参照 / branch return 後 fallthrough / 死コード rollbackOn /
    画面項目イベント argumentMapping 不整合 等) の再発を抑制する。完成後の `/review-flow` 検出件数を
    削減し、修正サイクル数を減らす。

  /review-flow との関係:
    - 本スキル = 作成支援 (作成前 self-check)
    - /review-flow = 最終防衛線 (作成後の独立検証)
    - **両者は併用前提**。本スキルだけでは Must-fix ゼロ達成は保証されない。

  発動制御:
    - `disable-model-invocation: true`: ユーザーが明示的に `/create-flow [args]` と打った時のみ起動
    - `/issues` オーケストレーターから委譲先 AI への briefing 経由でも参照される
-->

ProcessFlow `$ARGUMENTS` を品質ガード付きで作成します。

## 役割と前提

- **あなたは ProcessFlow 設計者**。`/review-flow` の 17 観点を**作成前** に遵守して JSON を組み立てる
- 出力: 処理フロー JSON 1 ファイル + (必要なら) 拡張定義の追加 + testScenarios 3 件以上
- 完成後は **必ず `/review-flow` で自己検証**してから PR / マージに進める
- 本スキルは spec の**索引 + 既知パターン要約**。詳細は `docs/spec/process-flow-*.md` を `Read` で参照

## Step 0: 引数解析

`$ARGUMENTS` を以下のように解析:

- 第1引数 `flowId` (必須): UUID v4 形式 (例: `ffffffff-0001-4000-8000-ffffffffffff`)
- 第2引数 `業務概要` (必須): 自然言語 (例: `"受注 → 在庫引当 → 出荷指示の業務フロー"`)
- 第3引数 `namespace` (任意): 業界拡張定義の namespace (例: `securities`, `manufacturing`, `logistics`)

引数が不足していれば「不足: ...」と報告して中止。

## Step 1: 参考資料の確認

実装前に以下を必ず読む (skim でよい):

1. `docs/spec/process-flow-transaction.md` の §8 (TX 制御フロー)
2. `docs/spec/process-flow-extensions.md` の §15 (拡張機構)
3. `docs/spec/process-flow-runtime-conventions.md` の §13 (runtime conventions)
4. 既存サンプル 1-2 件: `examples/retail/process-flows/` 配下の適切なシナリオと業務概要に近いシナリオ
5. namespace 指定があれば `examples/<project-id>/extensions/<namespace>.v3.json` を Read で確認 (既存拡張定義の把握)

## Step 2: 必須セクション チェックリスト

ProcessFlow JSON に含めるべき要素 (5/5 達成サンプル準拠):

| セクション | 要件 |
|---|---|
| `id` | UUID v4 |
| `name` | 業務名 (日本語、業界文脈含む) |
| `type` | `screen` / `system` / `batch` から選択 |
| `screenId` | UUID (画面実体不要なら任意の UUID で可) |
| `apiVersion` | `"v2"` 推奨 |
| `mode` | `"upstream"` (UI 起点) / `"downstream"` (内部呼出) |
| `maturity` | `"draft"` / `"provisional"` / `"committed"` |
| `description` | 短い業務説明 (推奨、`/review-flow` 厳格モード評価では無視される) |
| `eventsCatalog` | 業務イベント 4-6 件、各 description + payload schema (required + properties) |
| `glossary` | 業界用語 8 件以上、各 definition + aliases + domainRef |
| `decisions` | ADR 形式 3 件以上 (id / title / status / context / decision / consequences / date) |
| `ambientVariables` | requestId / sessionUserId 等の暗黙変数定義 |
| `errorCatalog` | 5 件以上、key + httpStatus + defaultMessage + responseRef |
| `externalSystemCatalog` (= `context.catalogs.externalSystems`) | 連携する外部システム (auth / baseUrl / timeoutMs / openApiSpec 任意) |
| `modelEndpointCatalog` (= `context.catalogs.modelEndpoints`) | AI モデルエンドポイント (provider / model / auth / defaults / fallback) — `aiCall` / `aiAgent` step から `modelRef` で参照 (#935) |
| `secretsCatalog` (= `context.catalogs.secrets`) | 各 API トークン (source / name / rotationDays) |
| `domainsCatalog` (= `context.catalogs.domains`) | ID 系・金額系等のドメイン型 (constraints 付き) |
| `functionsCatalog` (= `context.catalogs.functions`) | 業務固有関数のシグネチャ (signature / returnType / examples) — `aiCall.tools[].functionRef` から tool として再利用可 |
| `actions[]` | 1-3 アクション。各 trigger / inputs / outputs / responses / steps |
| `testScenarios` | 3 件以上 (happy path / validation error / 業務エッジケース)、各 SELECT 対象テーブルについて行ありパターン + 行なしパターン (新規ユーザー / 初回利用) を網羅 (#608) |

各セクション 0 件は許されない (eventsCatalog と decisions と testScenarios は特に必須)。

### testScenarios fixture バリエーション網羅 (#608)

testScenarios 設計時に、各 `dbAccess SELECT` で使用するテーブルについて、以下のバリエーションを最低 1 件ずつ含める:

- **テーブル行が存在するパターン** (典型的な happy-path)
- **テーブル行が存在しないパターン** (新規ユーザー / 初回利用 / 第 1 回目の処理)
- **テーブル行が境界条件にあるパターン** (累計が上限近傍 / 期限境界 / NULL 許容カラムが NULL の状態 等)

`dbAccess INSERT` の前に他テーブル行の存在を前提とする場合、testScenarios で「前提行が無い場合の挙動」を必ず確認する。特に NOT NULL カラムへの INSERT で他テーブル参照を持つ場合は、その前提テーブル行が無い fixture を 1 件追加し、「初回」「新規」「リセット後初回」のキーワードを意図的に使う。

## Step 3: 既知パターン回避 self-check (33 ルール、必須遵守)

`/review-flow` で検出される既知パターンを**作成中**に避けること。各 step を書くたびに以下を確認:

### Rule 1: 変数ライフサイクル

- 全 `@varName` 参照は実行順で先に設定済み (`inputs` / `outputBinding` / `ambientVariables` のいずれか)
- TX 内 step が **TX 外で設定される変数を前方参照しない**
- typo 注意: `@input.x` は誤り、`@inputs.x` が正しい

### Rule 2: TransactionScope 内外整合

- TX 内 step は TX **開始前**に設定された変数のみ参照
- TX 外 step が TX inner outputBinding を参照する場合の方針:
  - **方針 A (推奨、TX 成功後の再取得)**: TX 後に `dbAccess SELECT` で再取得する step を挟んで `@persistedX` 等にバインド
  - **方針 B (TX 結果の判別と分岐)**: `transactionScope` の `outputBinding: { name: "txResult" }` を使い、TX 外で `@txResult.committed` (boolean) と `@txResult.error.code` で TX 結果を判別する。エラー条件分岐は `condition.kind: "expression"` + `expression: "@txResult.error.code === '<rollbackOn のコード>'"` (rollbackOn 列挙外の汎用エラーは catch-all `'UNHANDLED'`)。spec `docs/spec/process-flow-transaction.md §8.5` 参照 (#782)
- TX 後の後続 step (TX 外) には **明示的 `runIf` ガード必須** (spec §8.3): `@txResult.committed == true` (commit 経路) / `@txResult.committed == false` (rollback 経路)。エンジン仕様で「自動 skip」は保証されない
- **外部呼び出し (`externalSystem` step) は TX 内に入れない** (anti-pattern、DB 接続長時間占有)

### Rule 3: runIf 連鎖の網羅性

- 冪等 UPSERT (`UPSERT_IDEMPOTENT` 等) 後に続く step **すべて**に同条件 runIf
- no-op パスにも対応する return step (典型: `{ status: 'ALREADY_PROCESSED' }`)
- TX rollback ガード: TX 後の step に `runIf: "@txResult.committed == true"` (もしくは `false` で rollback パス)

### Rule 4: branch / elseBranch 到達性

- 全 branch + elseBranch が return か後続 step に到達 (dead end 禁止)
- branch 内で return した後の共通 step に **fallthrough しない設計** にする
- BLOCK/REJECT パスで return した後に共通 step に流れる構造は避ける (#458/#478 で多発)

### Rule 5: compensatesFor 参照健全性

- `compensatesFor: "step-X"` の step-X が同じ action 内に実在
- 補償処理が補償対象の書き込みを正しく打ち消す内容になっているか

### Rule 6: eventsCatalog ⇄ eventPublish 双方向整合

- `eventsCatalog` で宣言した全イベントに対応する `eventPublish` step が存在
- `eventPublish.topic` (or `eventRef`) で参照する topic が `eventsCatalog` に登録済み
- payload が catalog の payload schema と整合 (required フィールド網羅、型整合)

### Rule 7: 外部呼び出しと TX 位置関係

- `type: "externalSystem"` step は `transactionScope` の inner にいないか確認
- TX 外なら `outcomes.failure: "compensate"` 等の補償処理を明記
- `fireAndForget: true` の場合は `outcomes.failure: "continue"` で整合

### Rule 8: rollbackOn 発火可能性

- `transactionScope.rollbackOn` には TX inner step から実際に発生しうるエラーコードのみ列挙
- `errorCatalog` に登録されたコードを使用
- **死コード rollbackOn 禁止** (#458/#478 で頻発): TX 外 step が返すエラーコードを書かない

### Rule 9: SQL SELECT カラム整合 (#486 で発覚)

- 後続 step で `@bind.column` を参照するすべてのカラムが、対応する `dbAccess` step の SELECT 句に含まれているか確認
- 典型ミス: `SELECT id, status FROM table` で取得後、後続で `@row.quantity` を参照 → 実行時 undefined
- 対処: SELECT 句に必要カラムを全列挙、または compute step で別途取得

**Step 5.2 で `validate:samples` により機械的に検出される**

### Rule 10: `@conv.*` 参照の catalog 整合 (#486 で発覚)

- フロー内で参照する全 `@conv.*` キーが `examples/<project-id>/conventions/catalog.json` に存在することを確認
- 典型ミス: ADR で `@conv.limit.maxDeliveryAttempts` を仕様化したが catalog 追加を忘れる → runtime で undefined 解決、condition が常に false
- 対処: 新規 `@conv.*` キーを使うときは必ず catalog にも追加 (本 PR で追加するか、別 ISSUE で先行追加)

**Step 5.2 で `validate:samples` により機械的に検出される**

### Rule 11: TX 内 branch return 後の制御 (#486 で発覚)

- Rule 4 (TX 外の branch fallthrough) の TX 内バージョン
- TX inner で `branch` step を使い branch 内で return する場合、後続 inner step に fallthrough しないか明示確認
- **推奨**: TX 内 branch を避け、`affectedRowsCheck.errorCode` で TX rollback を発火させる経路に統一
- 典型ミス: `step-tx-02` の branch A で `return 422` した後、`step-tx-03` が implicit に実行されて二重処理 / undefined 参照

### Rule 12: `affectedRowsCheck.operator` は `=` のみ受容 (schema 制約、#486 Opus 発見)

- 利用可能な operator: `>` / `>=` / `=` / `<` / `<=`
- **`==` は不可**、`!=` も不可
- 典型ミス: `"operator": "==", "expected": 1` を書く → schema 違反

### Rule 13: `affectedRowsCheck.expected` は integer リテラル必須 (schema 制約、#486 Opus 発見)

- 整数リテラル (`1` / `0` 等) のみ受容
- **式参照不可** (`@var` 不可)
- 「N 行更新」を式で表現できないため、複数行 affected の検証が必要なら別の方法 (compute step で count → branch 等)

### Rule 14: `OtherStep.outputSchema` 形式制約 (schema 制約、#486 Opus 発見)

- `{field: "string"}` 形式のみ受容 (フィールド名 → 型名の単純マッピング)
- **複雑な JSON Schema 不可**: nested object / required / additionalProperties / enum 等は使えない
- 参考: 拡張定義 (`extensions/<namespace>/steps.json`) の `schema` フィールドは別物 (こちらは JSON Schema 完全対応)
- 典型ミス: `"outputSchema": { "type": "object", "properties": {...}, "required": [...] }` を書く → schema 違反、Sonnet が #486 で実装中に修正

### Rule 15: グローバル schema 変更禁止 (#511 教訓、最重要)

- **`schemas/process-flow.schema.json` / `schemas/extensions-*.schema.json` / `schemas/conventions.schema.json` を変更しない**
- これらは **フレームワーク製作者 (設計者) の専権事項**、AI による変更は権限外行為
- 業務記述で表現できない場合の対処順序:
  1. **拡張機構 (namespace 拡張定義) で代替できないか確認** — `extensions/<namespace>/*.json` で field-types / triggers / db-operations / steps を追加
  2. **既存 schema フィールドで代替表現できないか確認** — description / note フィールドで意図を表現、`type: "other"` + outputSchema パターンを使う
  3. それでも無理なら、**ISSUE 起票して作業を一時停止** (例: `improve(schema): <フィールド名> 追加検討 — <経緯>`)、設計者承認待ち
- **絶対禁止**: テスト pass を理由に schema を勝手に拡張すること
- 参考: PR #508 で Sonnet が 6 フィールド勝手追加 → #511 でガバナンス導入の発端

### Rule 16: 画面項目イベント連携整合 (#619 / #621、Phase 3)

UI 起点フロー (`type: "screen"` / `mode: "upstream"`) を作成するときは、画面項目側との接続点を整合させる。`screenItemFlowValidator` が以下を機械検出する。

- **`meta.primaryInvoker` (任意、推奨)**: 主要起動元の画面項目イベントを `{kind: "screen-item-event", screenId, itemId, eventId, actionId?}` で宣言。`actionId` (#1019) は複数 action を持つフローで主要対象 action を指す (省略時 actions[0])。対応する `ScreenItem.events[]` 側に `handlerFlowId: <本フロー id>` + `handlerActionId: <該当 action id>` を載せると validator が双方向参照を確認する
- **1 画面 = 1 処理フロー + 複数アクション モデル (#1019)**: 画面項目イベントごとに別フローを作るのではなく、同画面の event を 1 フローの `actions[]` に集約する。各 event 側は `handlerActionId` で sub-action を指定する (省略時は actions が 1 件のみであることが前提、validator が単一 action 制約 `AMBIGUOUS_HANDLER_ACTION` で担保)
- **`actions[].inputs[]` の引数契約**: `name` / `type` / `required` を画面側 `argumentMapping` のキー集合と一致させる (action 単位、`handlerActionId` が指す action の inputs[] と突合される)
  - 必須引数 (`required: true`) を画面側 `argumentMapping` に含めない → `MISSING_REQUIRED_ARGUMENT`
  - 画面側 `argumentMapping` に inputs[] に無いキーがある → `EXTRA_ARGUMENT`
  - 同 (フロー, action) を複数画面項目イベントから呼ぶ場合の **キー集合統一** (異なると `INCONSISTENT_ARGUMENT_CONTRACT` warning)
- **典型ミス**:
  - inputs[] に `userId` を `required: true` で入れたが、ScreenItem.events[].argumentMapping を空にしている → MISSING
  - inputs[] には無い `extraInfo` を ScreenItem.events[].argumentMapping に書いている → EXTRA
  - 同じ flow を 「ボタンクリック」と「フォーム送信」両方から呼んでいて、片方は `customerId` を渡して片方は渡していない → INCONSISTENT (warning)
- **本ルールが対象外のシナリオ**: `type: "system"` / `type: "batch"` / `mode: "downstream"` 等、画面項目から起動されないフローは `meta.primaryInvoker` を省略してよい (validator はフロー側のみ検査するためエラーにならない)
- **Phase 3 補足**: 画面定義 (Screen / ScreenItem) は本スキルの作成範囲外 (ProcessFlow JSON のみ作成)。画面側の `events[]` 追加が必要な場合は、フロー作成と同 PR で画面側 JSON も整合させるか、別 ISSUE で先行整合する

**Step 5.2 で `validate:samples` の `screenItemFlowValidator` により機械的に検出される**

### Rule 17: 画面項目値レベル整合 (#631 / #627、Phase 3 evolved)

UI 起点フロー (`type: "screen"` / `mode: "upstream"`) を作成するときは、画面項目側 ScreenItem.type / options / validation と処理フロー inputs[].type / domain の **値レベル** で整合させる。`screenItemFieldTypeValidator` が以下を機械検出する。

| code | severity | 検出内容 |
|---|---|---|
| `OPTIONS_NOT_SUBSET_OF_ENUM` | error | 画面 ScreenItem.options[].value (selectbox / radio 等) ⊆ flow input domain.enum.values の包含検査。Phase 3 M2 (BenefitType enum 不一致) の構造的検出機構 |
| `DOMAIN_KEY_MISMATCH` | error | 画面 ScreenItem.type.domainKey と flow input type.domainKey の不一致 (両方 domainKey 形式時) |
| `TYPE_MISMATCH` | error | argumentMapping 値が `@self.<itemId>` 参照の場合、ScreenItem.type と inputs[].type の比較 (#627 吸収) |
| `PATTERN_DIVERGENCE` | warning | 画面 validation.pattern と flow input domain.pattern (regex) の不一致 (両方定義時) |
| `RANGE_DIVERGENCE` | warning | 画面 min/max と flow input domain.minimum/maximum の不一致 (両方定義時) |
| `LENGTH_DIVERGENCE` | warning | 画面 minLength/maxLength と flow input domain.minLength/maxLength の不一致 |

**Step 5.2 で `validate:samples` の `screenItemFieldTypeValidator` により機械的に検出される**ため、本ルールは「機械検出は事後で必ず行われる」前提で、設計時に options / type / domainKey の対応関係を意識すること。

業務文脈の妥当性 (例えば「BenefitType の意味的妥当性」「画面選択肢の業務命名」) は引き続き AI 目視で `/review-flow` 観点 10 で扱う。

### Rule 18: testScenarios fixture バリエーション網羅 (#608)

- 各 `dbAccess SELECT` 対象テーブルについて、行ありパターン + 行なしパターン (新規ユーザー / 初回利用) を testScenarios で網羅する
- NOT NULL カラムへの INSERT で他テーブル参照を持つ場合、前提行なしの fixture を必ず 1 件用意する
- 典型ミス: happy-path で全前提を pre-seed、edge は 400/403 系の検証に偏り、初回ユーザーパスが抜ける
- **補足**: 静的検出 `sqlOrderValidator` (#632) が導入されるまで本ルールが主要 catch 機構。導入後も「値レベル fixture 不足」など静的検出では届かない領域は本ルールで継続担保 (Step 5.2 validate:samples では機械検出されない、Step 3 self-check のみで担保)

### Rule 19: DB 制約 × INSERT / DELETE 操作順序 (#632 / #640 / #641)

- INSERT 文の VALUES で使う変数が INSERT 時点でバインド済みか確認 (NOT NULL カラムが対象)
  - 未バインド変数を NOT NULL カラムに入れている場合: 実行時 DB 制約違反 → Must-fix
  - NULL リテラルを NOT NULL カラムに挿入: 実行時 DB 制約違反 → Must-fix
  - autoIncrement / DEFAULT 付きカラムは省略可 (DB 側が値を補完)
- FK カラムに未バインド変数を INSERT する場合: 参照先テーブルの行が未確保 → Must-fix
  - SELECT で outputBinding された変数を FK に使う (= 既存行 ID 参照) は正常
  - inputs から来た変数を FK に使う (= 外部から受け取った ID) は正常
  - 全く出どころ不明の変数を FK カラムに使う場合のみ issue
- UNIQUE 制約のあるカラムへの INSERT で事前の重複チェックがない場合: Should-fix (warning) (#640)
  - 以下のいずれかがあれば OK (検出しない):
    1. INSERT 前に同テーブルへの SELECT WHERE で UNIQUE カラムを WHERE に含む (存在確認)
    2. INSERT step 自身の `affectedRowsCheck.errorCode` が UNIQUE/DUPLICATE/CONFLICT/ALREADY_EXISTS 系
    3. action 内に `branch.condition.kind: "tryCatch"` で UNIQUE_VIOLATION 系エラーをキャッチする step がある
  - 対象: `Table.constraints[].kind: "unique"` の columnIds および `Column.unique: true`
- 親テーブルへの DELETE 時、FK の onDelete が restrict / noAction (または未指定) の子テーブルが存在する場合: Must-fix (error) (#641)
  - 同 action 内の前段に子テーブルへの DELETE step が必要
  - onDelete = cascade: DB 側が子を自動削除 → 子 DELETE step 不要
  - onDelete = setNull / setDefault: DB 側が子の FK カラムを NULL / DEFAULT に更新 → 子 DELETE step 不要
  - onDelete = restrict / noAction (デフォルト): 子 DELETE step が前段になければ実行時 FK 制約違反
- `transactionScope` 内で双方向 FK 循環 (A→B かつ B→A) がある場合: Should-fix (warning) (#642)
  - 同一 TX で INSERT/UPDATE されるテーブル群の FK 有向グラフを DFS で検査し、back-edge を検出
  - 三角循環 (A→B→C→A) も検出
  - TX 外の双方向 FK は対象外 (TX スコープ内のみ)
  - DEFERRED constraint 検出は Phase 5 候補 (別 ISSUE)
  - 対処: 挿入順序の見直し / DEFERRED FK / FK 一時無効化 のいずれかを設計者が判断

**Step 5.2 で `validate:samples` の `sqlOrderValidator` により機械的に検出される**

| code | severity | 検出内容 |
|---|---|---|
| `NULL_NOT_ALLOWED_AT_INSERT` | error | NOT NULL カラムへの NULL または未バインド変数 INSERT |
| `FK_REFERENCE_NOT_INSERTED` | error | FK 参照先テーブルの先行 INSERT なし + FK カラム変数が未バインド |
| `UNIQUE_CHECK_MISSING` | warning | UNIQUE カラムへの INSERT で事前重複チェックなし (#640) |
| `CASCADE_DELETE_OMITTED` | error | FK onDelete=restrict/noAction の子テーブル行を先 DELETE せず親を DELETE (#641) |
| `TX_CIRCULAR_DEPENDENCY` | warning | transactionScope 内で INSERT/UPDATE テーブル間に双方向 FK 循環 (#642) |

### Rule 20: ViewDefinition 整合 (#649、Phase 4 子 1)

一覧系画面 (`list` / `search` 等) のフローを作成するとき、同プロジェクト内の ViewDefinition との整合を確認する。`viewDefinitionValidator` が以下を機械検出する。

| code | severity | 検出内容 |
|---|---|---|
| `UNKNOWN_SOURCE_TABLE` | error | sourceTableId / query.from.tableId / query.joins[].tableId が同プロジェクトのテーブルに実在しない |
| `UNKNOWN_TABLE_COLUMN_REF` | error | ViewColumn.tableColumnRef が指す {tableId, columnId} が実在しない |
| `UNKNOWN_TABLE_REF_IN_VIEW` | error | Level 2: ViewColumn.tableColumnRef.tableId が query.from / query.joins[] のいずれにも含まれない (#745) |
| `JOIN_NOT_DECLARED` | warning | Level 1: tableColumnRef.tableId が sourceTableId と異なる (暗黙 join、Level 2 アップグレード推奨。#745、旧 `COLUMN_REF_NOT_IN_SOURCE_TABLE` を再定義) |
| `DUPLICATE_VIEW_COLUMN_NAME` | error | ViewColumn.name が同 ViewDefinition 内で重複 |
| `FIELD_TYPE_INCOMPATIBLE` | warning | ViewColumn.type (FieldType) と DB Column.dataType が互換しない |
| `UNKNOWN_SORT_COLUMN` | error | sortDefaults[].columnName が columns[].name に存在しない |
| `UNKNOWN_FILTER_COLUMN` | error | filterDefaults[].columnName が columns[].name に存在しない |
| `FILTER_OPERATOR_TYPE_MISMATCH` | warning | filter operator が column type と不整合 (数値型に contains 等) |
| `UNKNOWN_GROUP_BY_COLUMN` | error | groupBy が columns[].name に存在しない |

フロー作成時のチェックポイント:
- `dbAccess` の対象テーブルが ViewDefinition.sourceTableId と一致しているか
- ViewColumn.name で参照している列が実際に SELECT 句に含まれているか
- Screen.viewDefinitionRefs[] が本フローで扱う ViewDefinition ID を正しく列挙しているか

**Step 5.2 で `validate:samples` の `viewDefinitionValidator` により機械的に検出される**

### Rule 21: 画面遷移三者整合 (#650、Phase 4 子 2)

画面遷移を含むフローを作成するとき、**画面フロー edges (`Project.screenTransitions[]`) × ProcessFlow の `ScreenTransitionStep.targetScreenId` × 画面の `path` (URL ルーティング)** の三者が整合していることを確認する。`screenNavigationValidator` が以下を機械検出する。

| code | severity | 検出内容 |
|---|---|---|
| `UNKNOWN_TARGET_SCREEN` | error | ScreenTransitionStep.targetScreenId が同プロジェクトの画面に実在しない |
| `MISSING_FLOW_EDGE` | warning | ScreenTransitionStep が遷移するが Project.screenTransitions[] に対応 edge が無い |
| `MISSING_FLOW_TRANSITION` | error | `kind: "flow-driven"` な edge に対応する ScreenTransitionStep が無い (#744、純 UI 遷移は `kind: "navigation"` で検出対象外) |
| `DEAD_END_SCREEN` | warning | 画面に遷移先 (forward / ScreenTransitionStep) が無い (login / error 等の固定終端は除外) |
| `AUTH_TRANSITION_VIOLATION` | error | `auth: optional / none` 画面から `auth: required` 画面への直接遷移 (kind=login/error は例外) |
| `PATH_PARAM_MISMATCH` | warning | source.path に対応する `:param` が無いまま target.path のパラメータを要求 (軽量判定) |
| `DUPLICATE_SCREEN_PATH` | error | 複数画面が同じ path を宣言 |

フロー作成時のチェックポイント:
- ScreenTransitionStep.targetScreenId が実在画面か
- 画面フロー edges (`Project.screenTransitions[]`) に同じ遷移を宣言しているか
- 遷移先画面の `auth` 要件と遷移元の `auth` が整合しているか (login 後画面への bypass を作っていないか)
- 画面の `path` が一意か / `:param` の整合があるか

**Step 5.2 で `validate:samples` の `screenNavigationValidator` により機械的に検出される**

### Rule 22: 画面項目 refKey 横断整合 (#651、Phase 4 子 3)

このルールはフロー作成時の **画面 JSON 整備** を対象とする (ProcessFlow JSON ではなく Screen JSON の品質)。

- フロー作成前に、関連する画面項目に `refKey` を設定する (論理的に同じフィールドなら同一 refKey)
  - 例: 振込実行画面の `fromAccountNumber` と振込履歴照会の `searchAccountNumber` は同じ「口座番号」 → `refKey: "accountNumber"`
- `refKey` を設定したら `conventions.fieldKeys[<refKey>]` に宣言を追加する
  - 宣言は `type` (任意) + `displayName` + `description` が推奨
  - `type` を宣言した場合、全画面の同 `refKey` 項目と型が一致していること
- 同一 `refKey` を持つ ScreenItem 間で `type` が不整合な場合は実装時の型バグ → Must-fix
- `pattern` / `displayFormat` の不整合は UI 一貫性問題 → Should-fix
- `min` / `max` / `minLength` / `maxLength` の不整合は業務的に合理的な場合もある → warning 受容可
- `handlerFlowId` の発散: 両側に `events` がある場合のみ発報。一方が出力専用なら片側 events なしで正常

**Step 5.2 で `validate:samples` の `screenItemRefKeyValidator` により機械的に検出される**

### Rule 23: 画面項目 embed + design ファイル配置 (#714)

このルールはフロー作成時の **画面 JSON 整備** を対象とする (ProcessFlow JSON ではなく Screen JSON の品質)。

- **画面項目は `screens/<id>.json#items` 配列に embed する**: `screen-items/` 別ディレクトリは runtime が読まない
  - `screen-items/<id>.json` として別ファイルに切り出しているデータは `screens/<id>.json#items` に移動すること
  - `EMPTY_SCREEN_ITEMS` warning が出ている場合: items が空 → UI 上でフォームが空表示になる
  - `LEGACY_SCREEN_ITEMS_DIR` error が出ている場合: screen-items/ ディレクトリに残存ファイルがある → 削除 or embed が必要
- **GrapesJS デザインファイルは `screens/<id>.design.json` に配置する**: hard-coded path のみ参照される
  - `screen.design.designFileRef` を設定する場合は basename が `<id>.design.json` と一致すること (basename のみ比較)
  - `designs/foo.html` 等の外部パスは runtime が無視する → `EXTERNAL_DESIGN_REF` error
  - ファイル自体が存在しなくても recoverable (空キャンバス) → `MISSING_DESIGN_FILE` warning として報告

**Step 5.2 で `validate:samples` の `runtimeContractValidator` により機械的に検出される**

### Rule 24: `'@conv.*'` シングルクォート内リテラル化禁止 (#740 / retail 落とし穴 16)

- `'@conv.msg.X'.replace(...)` のように `@conv.*` をシングルクォート (またはダブルクォート) 文字列で囲むと、評価エンジンがリテラル文字列扱いするため **conv 解決が起きない**
- 結果: レスポンス message に `"@conv.msg.productNotFound"` という生の文字列が露出する
- 正しい形: `@conv.msg.X.replace(...)` (クォート除去)
- 典型ミス: `'@conv.msg.productNotFound'.replace('{x}', @inputs.y)` → `@conv.msg.productNotFound.replace('{x}', @inputs.y)` に修正

**Step 5.2 で `validate:samples` の `processFlowAntipatternValidator` (`LITERAL_CONV_REFERENCE`) により機械的に検出される**

### Rule 25: JSON 重複 `kind` キー禁止 (#740 / retail 落とし穴 17)

- 同 step オブジェクト内で `kind` フィールドを **2 つ並存させない** (例: `"kind": "ExtensionStep"` と `"kind": "retail:DispatchShipment"` の両方を書く誤り)
- JSON 仕様 (RFC 8259) では後者で前者を上書きするが、フレームワーク前読み validator が前者を採用する場合に不整合発生
- 正しい形: schemas/v3 で許容される **kind 値を 1 つだけ** 書く:
  - **builtin step**: lowercase camelCase の const (例: `"kind": "dbAccess"` / `"compute"` / `"branch"` / `"transactionScope"` 等。完全な一覧は `schemas/v3/process-flow.v3.schema.json` の Step union 参照)
  - **拡張 step (ExtensionStep)**: `<namespace>:<StepName>` パターン (例: `"kind": "retail:DispatchShipment"`)
  - 注意: `"kind": "extensionStep"` という const は schemas/v3 に存在しない (拡張 step の正規形は `<namespace>:<StepName>` 形式のみ)
- 検出: 単純な `JSON.parse` では検出不能 (重複キー許容)、raw 文字列 scan が必要

**Step 5.2 で `validate:samples` の `processFlowAntipatternValidator` (`DUPLICATE_KIND_KEY`) により機械的に検出される**

### Rule 26: `httpRoute` API への `screenTransition` step 混入禁止 (#740 / retail 落とし穴 18)

- action が `httpRoute: { method: "POST", path: "/api/..." }` で **API として定義** されているのに step に `kind: "screenTransition"` を含めない (意味論衝突)
- API はレスポンスを返すだけで画面遷移はできない:
  - `screenTransition` が return より前 → 「レスポンス前に画面遷移命令」で実行不能
  - `screenTransition` が return の後 → dead code
- 正しい形:
  - API フローには `screenTransition` を入れない
  - 画面遷移は呼び出し側 (画面項目の event ハンドラ) で行う
  - `tr-*` は project.json に残し `kind: "navigation"` で純 UI 遷移として宣言する (#744、warning 出さず)
- 検出: action.httpRoute が存在 + step に kind: screenTransition がある組合せ (機械検出可能だが意味論判断を含むため AI 目視も併用)

### Rule 27: `@conv.numbering.X.nextSeq()` 構文禁止 → DB sequence 利用 (#740 / retail 落とし穴 19)

- `compute` step の expression に `String(@conv.numbering.orderNumber.nextSeq()).padStart(6, '0')` のような呼び出し構文を書かない
- conventions catalog のオブジェクトはメソッドを持たないため **実行不能**
- 正しい形: シーケンスは DB の sequence object を `dbAccess` step + `SELECT nextval('seq_X')` で取得する。例:

```sql
SELECT 'ORD-' || EXTRACT(YEAR FROM CURRENT_DATE)::text || '-' || LPAD(nextval('seq_order_number')::text, 6, '0') AS order_number
```

**Step 5.2 で `validate:samples` の `processFlowAntipatternValidator` (`INVALID_SEQUENCE_CALL_SYNTAX`) により機械的に検出される**

### Rule 28: `rollbackOn` 発火可能性 + `lineage.writes.purpose` 整合 (#740 / retail 落とし穴 20 + 21)

#### Rule 28a: rollbackOn 欠落禁止 (落とし穴 20)

- TX 内 step の `affectedRowsCheck.errorCode` / `inlineBranch.errorCode` で発火する **全 errorCode** を `transactionScope.rollbackOn` に列挙
- 欠落していると TX rollback がトリガーされず、catch-all (例: `ORDER_CONFIRM_FAILED`) に吸収されるか unhandled exception で 500 になる
- Rule 8 (死コード rollbackOn 禁止) と対をなす — 「足りない」「余分」両方 NG
- 検出: `grep -P '"errorCode"\s*:\s*"' flow.json` で抽出した errorCode 集合と `rollbackOn` の集合を比較し差分を確認 (Phase 2 で機械検出候補)

#### Rule 28b: lineage.writes.purpose と実操作の整合 (落とし穴 21)

- `lineage.writes[0].purpose` は SQL 操作種別と一致させる:
  - `"insert"` / `"update"` / `"statusUpdate"` / `"delete"` / `"upsert"`
- `"lookup"` は SELECT (`lineage.reads`) 専用。INSERT / UPDATE 操作の `purpose` を `"lookup"` にしない
- 誤値だとドキュメント生成・依存分析が壊れる
- 検出: SQL 構文解析が必要なため Phase 2 で機械検出候補

### Rule 29: 単一 `dbAccess.sql` への複数文 SQL 詰め込み禁止 (#740 / retail 落とし穴 23)

- `"sql": "DELETE FROM cart_items WHERE ...; UPDATE carts SET status = 'ordered' WHERE ..."` のように セミコロン区切りで 2 文を 1 step の sql に書かない
- PostgreSQL は許容するが多くの ORM / DB ライブラリが **単一文しか実行しない** ため、2 文目が silent skip されるリスク
- 正しい形: 1 step = 1 SQL 文。複数操作は step を分ける (`step-04-a` で DELETE、`step-04-b` で UPDATE)

**Step 5.2 で `validate:samples` の `processFlowAntipatternValidator` (`MULTIPLE_STATEMENTS_IN_SQL` warning) により機械的に検出される**

### Rule 30: SQL SELECT 句で camelCase 化が必要な列は `AS "<camelCase>"` alias 必須 (#775)

- `dbAccess.sql` の SELECT 結果が ViewDefinition `columns[].name` (camelCase) へ直接バインドされる場合、**SQL 内で `AS "<camelCase>"` alias を明示する**
- 例: `SELECT p.unit_price AS "unitPrice", p.product_code AS "productCode" FROM products p`
- snake_case 物理名 (`unit_price`) と Identifier (`unitPrice`) の変換を runtime の暗黙変換に依存しない
- alias 追加後は alias の camelCase キーで変数を参照する (`@rows[0].unitPrice` 等)。旧 snake_case 参照 (`@rows[0].unit_price`) は全て更新すること
- 詳細: `docs/spec/view-definition.md § (D-5)` / `docs/spec/process-flow-runtime-conventions.md §1.4`

### Rule 31: 業務上存在しない値 (架空値) の WHERE 句 hardcode 禁止 (#780 / retail 落とし穴 24)

- `WHERE store_code = 'DEFAULT'` のように、サンプル data に seed されていない値を SQL に hardcode しない
- multi-* dimension (multi-store / multi-tenant / multi-region) を持つサンプルでは特に発生しやすい
- 必要な context は schema レベルで持たせる: 例えば cart で店舗を扱うなら `cart_items.store_id` (NOT NULL FK) を追加し、WHERE 句は `@cartItem.storeId` のような変数参照にする
- 検出: 全 caps の literal (`'DEFAULT'` 等) は要警戒。サンプル data / schema enum / 業務 glossary で実在を確認
- 対応する `/review-flow` 観点: 15

### Rule 32: SQL alias で同名異物理列を取得し event payload で誤参照しない (#780 / retail 落とし穴 25)

- `SELECT i.id, p.id AS "productId", ...` のように unaliased な `id` (= 別テーブルの主キー) と aliased な `... AS "<entityId>"` を同一 SELECT で取得すると、後続 step の eventPublish payload / outputBinding で `@row.id` を `productId` に bind してしまう誤りが起こりやすい
- 正しい形: event payload は **alias 後のフィールド名** で明示参照する (`@row.productId`)。または SQL で `i.id AS "inventoryId"` のように全 column に alias を付ける
- 検出: `grep -P "@\\w+\\.id\\b"` で `.id` 参照を抽出 → 直前の SELECT が複数テーブルから id を取得していないか確認
- 対応する `/review-flow` 観点: 16

### Rule 33: PostgreSQL aggregate (COUNT/SUM/AVG/DATE_PART 等) の型変換は outputBinding.transformations で吸収 (#781 / retail 落とし穴 26)

- pg クライアント (node-postgres) は bigint / decimal を **文字列として** JS に渡すため、後続 step で数値比較する際 `"10" >= 20` の暗黙変換に依存して特定 input でバグる
- **SQL 側で `CAST(...)` を書かず**、`outputBinding.transformations` で runtime に型変換を吸収させる (DB 中立性を保つ。spec `docs/spec/process-flow-variables.md §3.2` 参照)
- 例:
  ```json
  {
    "kind": "dbAccess",
    "operation": "SELECT",
    "sql": "SELECT COUNT(*) AS \"itemCount\" FROM cart_items WHERE cart_id = @cart.id",
    "outputBinding": {
      "name": "cartItemCount",
      "transformations": [{ "field": "itemCount", "type": "integer" }]
    }
  }
  ```
- 型は `integer` / `float` / `boolean` / `date` / `json` の 5 種から選択 (`COUNT` → integer、`SUM`/`AVG` (decimal) → float、`DATE_PART`/`EXTRACT` → integer or float、`now()` 等 → date)
- 既存サンプルが `CAST(... AS INTEGER)` で書かれている場合、SQL から CAST を解除し `transformations` に置き換える migration が望ましい
- 対応する `/review-flow` 観点: 17

## Step 4: 拡張定義の使い方

### 既存 namespace を使う場合

- `examples/<project-id>/extensions/<namespace>/*.json` を `Read` で確認
- 既定義の field-types / triggers / db-operations / steps を流用する
- 新規追加が必要な場合は同ファイルに追記 (シナリオ #2 以降のパターン参考)

### 新規 namespace を作る場合

- `examples/<project-id>/extensions/<新namespace>/` ディレクトリ作成
- 必要なファイルだけ追加: `field-types.json` / `triggers.json` / `db-operations.json` / `steps.json` / `README.md`
- 各ファイルは `{namespace, fieldTypes/triggers/dbOperations/steps}` の構造に従う

### 重要原則 (`docs/spec/process-flow-extensions.md` §15)

- **拡張定義の実利用必須** (§15.3): 定義した拡張は**同 PR 内**で実フローから実体使用する。「定義したが未使用」は禁止
- **拡張 step の参照形式** (#492 / PR #494 で schema 改修済):
  - **推奨**: `type: "namespace:StepName"` (例: `"securities:TradeMatchStep"`) — 現行 schema 受容済
  - **後方互換**: `type: "other"` + `outputSchema` + description 注記の旧形式も引き続き valid
  - 旧版の `/create-flow` SKILL では `type: "other"` workaround を強制していたが、#492 で解消
- **fieldType vs domainsCatalog 使い分け** (§15.1):
  - 拡張 fieldType (`{kind: "orderId"}`): 業界固有の**型自体**を追加
  - domainsCatalog (`OrderId: {type: "string", constraints: ...}`): ドメイン**制約付き**の型エイリアス

## Step 5: 完成後の自己検証 (必須)

### 5.1 構造検証

```bash
cd frontend
npx vitest run src/schemas/v3-samples.test.ts src/schemas/loadExtensions.test.ts
npm run build
```

### 5.2 バリデータ横断検証 (機械的検出、Rule 18 / 26 / 28 のみ AI 目視)

作成したフローの配置先で実行コマンドが分かれる:

- `examples/<projectId>/` 配置 → `npm run validate:samples -- ../examples/<projectId>` (`runtimeContractValidator` / `processFlowAntipatternValidator` も実行)

```bash
cd frontend
npm run validate:samples -- ../examples/<projectId>
```

これにより以下を機械的に検出する:

| バリデータ | 検出内容 | 対応 Rule |
|---|---|---|
| sqlColumnValidator | SQL 内で参照したカラムがテーブル定義に存在しない | Rule 9 |
| conventionsValidator | `@conv.*` 参照が conventions-catalog.json 未登録 | Rule 10 |
| referentialIntegrity | responseRef / errorCode / systemRef / compensatesFor の不整合 | Rule 5 / Rule 8 補強 |
| identifierScope | 識別子スコープ違反 (root レベル) | Rule 1 補強 |
| screenItemFlowValidator | 画面項目イベント ↔ 処理フロー連携の整合 (handlerFlowId 実在 / argumentMapping 整合 / primaryInvoker 双方向) | Rule 16 |
| screenItemFieldTypeValidator | 画面項目 ↔ 処理フロー 値レベル整合 (options 包含 / domainKey / 型 / pattern / range / length) | Rule 17 |
| sqlOrderValidator | NOT NULL × INSERT 順序 (NULL_NOT_ALLOWED_AT_INSERT) / FK × INSERT 順序 (FK_REFERENCE_NOT_INSERTED) / UNIQUE / CASCADE / TX 循環 | Rule 19 |
| viewDefinitionValidator | ViewDefinition 整合 (sourceTableId / tableColumnRef / sortDefaults / filterDefaults 等) | Rule 20 |
| screenNavigationValidator | 画面遷移三者整合 (targetScreenId / forward edges / auth 整合 / path) | Rule 21 |
| screenItemRefKeyValidator | ScreenItem.refKey 横断整合 (型一致 / conventions.fieldKeys 宣言 / ORPHAN 検出) | Rule 22 |
| runtimeContractValidator (validate:samples 専用) | 画面項目 embed (`EMPTY_SCREEN_ITEMS` / `LEGACY_SCREEN_ITEMS_DIR`) + design ファイル配置 (`MISSING_DESIGN_FILE` / `EXTERNAL_DESIGN_REF`) | Rule 23 |
| processFlowAntipatternValidator (validate:samples 専用) | retail dogfood 既知パターン (`LITERAL_CONV_REFERENCE` / `DUPLICATE_KIND_KEY` / `INVALID_SEQUENCE_CALL_SYNTAX` / `MULTIPLE_STATEMENTS_IN_SQL`) | Rule 24 / 25 / 27 / 29 |

**fail した場合の対処**:
- `UNKNOWN_COLUMN` → SELECT 句を見直す or テーブル定義を更新
- `UNKNOWN_CONV_LIMIT` 等 → `examples/<project-id>/conventions/catalog.json` に追加 or 既存キーへ修正
- `UNKNOWN_HANDLER_FLOW` → 画面項目側 `handlerFlowId` を本フロー id に修正 (画面側 JSON 編集が必要なら同 PR or 別 ISSUE で整合)
- `UNKNOWN_HANDLER_ACTION` (#1019) → 画面項目側 `handlerActionId` を本フローの `actions[].id` に修正
- `AMBIGUOUS_HANDLER_ACTION` (#1019) → 複数 action を持つフローを呼ぶ event は `handlerActionId` を必須化 (省略不可)
- `MISSING_REQUIRED_ARGUMENT` / `EXTRA_ARGUMENT` → 該当 action の `inputs[]` (handlerActionId が指す action) と画面側 `argumentMapping` の **キー集合 + required** を一致させる
- `PRIMARY_INVOKER_MISMATCH` → `meta.primaryInvoker` の (screenId, itemId, eventId, actionId) と画面項目側 (handlerFlowId, handlerActionId) が双方向で一致するよう整える
- `INCONSISTENT_ARGUMENT_CONTRACT` (warning) → 同 (フロー, action) を呼ぶ複数イベントの `argumentMapping` キー集合を統一 (意図的に異なるなら warning 受容可)
- 構造的に解消できない場合は ISSUE 起票して停止 (グローバル schema 変更は禁止 — Rule 15)

### 5.3 単一フロー検証 (任意)

`validate:samples` は対象プロジェクト全件対象のため、作成中フロー 1 件のみを検証したい場合:

```bash
cd frontend
npx vitest run src/schemas/validateDogfood.test.ts -t "<flowId の一部>"
```

または `validateDogfood.test.ts` のパターンを参考にインライン実行 (詳細は同テストを参照)。

### 5.4 /review-flow による最終検証

5.1 / 5.2 が pass したら、**強く推奨**:

```
/review-flow <flowId>
```

`/review-flow` 検出 Must-fix が 0 件になるまで自己修正してから出力 / PR 作成へ進む。

## Step 6: 出力フォーマット

ユーザーに渡すもの:

```markdown
## 作成完了: <name>

### 出力ファイル
- `examples/<project-id>/actions/<flowId>.json` (新規)
- (新規拡張がある場合) `examples/<project-id>/extensions/<namespace>/*.json`

### 統計
- アクション数: N
- step 総数: M
- testScenarios: K 件
- decisions (ADR): 件数
- 拡張利用: 既存 namespace から N 件 / 新規定義 M 件 (実利用済み)

### Step 3 self-check 結果

| Rule | 状態 |
|---|---|
| 1. 変数ライフサイクル | ✓ / ❌ (問題があれば詳細) |
| 2. TransactionScope 内外整合 | ✓ / ❌ |
| 3. runIf 連鎖の網羅性 | ✓ / ❌ |
| 4. branch / elseBranch 到達性 (TX 外) | ✓ / ❌ |
| 5. compensatesFor 参照健全性 | ✓ / 該当なし |
| 6. eventsCatalog ⇄ eventPublish | ✓ / ❌ |
| 7. 外部呼び出しと TX 位置関係 | ✓ / ❌ |
| 8. rollbackOn 発火可能性 (死コード禁止) | ✓ / 該当なし |
| 9. SQL SELECT カラム整合 | ✓ / ❌ (参照しているのに SELECT に無いカラム) |
| 10. `@conv.*` 参照の catalog 整合 | ✓ / ❌ (catalog 未登録キーがあれば list) |
| 11. TX 内 branch return 後制御 | ✓ / 該当なし (TX 内 branch を使っていない) |
| 12. `affectedRowsCheck.operator` (`=` のみ) | ✓ / 該当なし |
| 13. `affectedRowsCheck.expected` (integer リテラル) | ✓ / 該当なし |
| 14. `OtherStep.outputSchema` 形式 | ✓ / 該当なし |
| 15. グローバル schema 変更禁止 | ✓ (`schemas/*.json` 未変更) / ❌ |
| 16. 画面項目イベント連携整合 | ✓ / 該当なし (画面起点でない) / ❌ |
| 17. 画面項目値レベル整合 | ✓ / 該当なし (画面起点でない) / ❌ (options / domainKey / 型 / pattern / range / length 不一致) |
| 18. testScenarios fixture バリエーション網羅 | ✓ / 該当なし (DB 操作なし) / ❌ (行ありのみで行なしパターン未網羅) |
| 19. DB 制約 × INSERT/DELETE 操作順序 | ✓ / 該当なし (DB 操作なし) / ❌ |
| 20. ViewDefinition 整合 | ✓ / 該当なし (一覧系画面でない) / ❌ |
| 21. 画面遷移三者整合 | ✓ / 該当なし (画面遷移なし) / ❌ |
| 22. 画面項目 refKey 横断整合 | ✓ / 該当なし (refKey 未使用) / ❌ |
| 23. 画面項目 embed + design ファイル配置 | ✓ / 該当なし (画面 JSON 不変更) / ❌ |
| 24. `'@conv.*'` シングルクォート内リテラル化禁止 | ✓ / 該当なし |
| 25. JSON 重複 `kind` キー禁止 | ✓ / 該当なし |
| 26. `httpRoute` API への `screenTransition` 混入禁止 | ✓ / 該当なし (httpRoute なし) |
| 27. `@conv.numbering.X.nextSeq()` 構文禁止 → DB sequence | ✓ / 該当なし (採番なし) |
| 28. rollbackOn 発火可能性 (欠落検査) + lineage.writes.purpose 整合 | ✓ / 該当なし (TX なし / lineage なし) |
| 29. `dbAccess.sql` への複数文 SQL 詰め込み禁止 | ✓ / 該当なし (DB 操作なし) |
| 30. SQL SELECT 列の `AS "<camelCase>"` alias (#775) | ✓ / 該当なし (VD binding なし) / ❌ |

### 検証結果
- vitest: <pass/fail 件数>
- build: <pass/fail>
- validate:samples: <pass/fail 件数> (sqlColumnValidator / conventionsValidator / referentialIntegrity / identifierScope / screenItemFlowValidator / screenItemFieldTypeValidator / sqlOrderValidator / viewDefinitionValidator / screenNavigationValidator / screenItemRefKeyValidator / runtimeContractValidator / processFlowAntipatternValidator)
- /review-flow: <Must-fix 件数 / Should-fix 件数>

### 推奨: 次の手順
- /review-flow を未実施なら実施
- PR 作成へ
```

## マルチエディタ対応 (#806)

フロー作成前に **関連する画面の `editorKind` / `cssFramework`** を確認する。

### 画面ロード時の解決順序

1. `screen.design.editorKind` / `screen.design.cssFramework` (画面個別指定)
2. `project.techStack.designer.editorKind` / `project.techStack.designer.cssFramework` (project default、#826 で `project.design` から移行)
3. 最終 default (`"grapesjs"` / `"bootstrap"`)

### editorKind 別のデザインファイル参照

- `editorKind: "grapesjs"` → `screens/<id>/design.json` を読む (GrapesJS 形式、HTML+CSS+components)
- `editorKind: "puck"` → `screens/<id>/puck-data.json` を読む (Puck Data tree、semantic props)

### Thymeleaf / React 出力スクリプトの注意

- **Thymeleaf 出力を生成するスクリプトは Puck 画面 (`editorKind: "puck"`) を明示スキップしてレポートに記録すること**
  - Puck 画面の出力は React コンポーネントが前提 (Thymeleaf 非対応)
  - 誤って Puck data を Thymeleaf テンプレートに渡すと broken HTML が生成される
  - スキップ判定: `screen.design.editorKind === "puck"` または解決後の editorKind が "puck" であること

詳細仕様: `docs/spec/multi-editor-puck.md` § 2.3

## 制約 (必守)

- **`/review-flow` を最終防衛線として併用**: 本スキルだけでは Must-fix ゼロ達成は保証されない
- **spec の正本性**: 本スキルは要約。詳細は `docs/spec/process-flow-*.md` を `Read`
- **拡張定義は実利用必須**: 定義のみで未使用は禁止 (spec §15.3)
- **schema を尊重**: `type: "manufacturing:StepName"` のような未対応形式は使わない (`type: "other"` + outputSchema が正解)
- **データファイル (`data/`) は触らない** (gitignore 対象)
- **30 ルールすべて作成中に意識する**: 1 つでも無視するとレビューで detect される

## 注意事項

- スキル肥大化を避けるため、spec 本文は転記しない (要約のみ)
- 業務概要が短すぎて不明瞭な場合は、ユーザーに「もう少し詳しく」と聞き返すのも可
- 既存サンプル (`dddddddd-0001-*` / `eeeeeeee-0001-*` / `ffffffff-0001-*` 等) は 5/5 達成済の良サンプル、構造を参考にする
- `/issues` オーケストレーターから委譲される場合、briefing に「`/create-flow` の 29 ルールを遵守すること」が含まれているはず
