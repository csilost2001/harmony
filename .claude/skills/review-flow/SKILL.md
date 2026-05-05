---
name: review-flow
description: ProcessFlow JSON の実行セマンティクスを専門レビュー (変数ライフサイクル / TX スコープ / runIf 連鎖 / 補償整合 / event 双方向 / 画面項目連携 / SQL alias 整合 / 業務 semantic gap)。Step 0.5 で 12 バリデータを機械実行 (#599 / #621)、Step 1 で 17 観点を AI レビュー。設計フェーズから使える
argument-hint: <flowId | path | --all | (空 = MCP アクティブタブ)>
disable-model-invocation: true
---

<!--
  使い方:
    - `/review-flow dddddddd-0001-4000-8000-dddddddddddd` — UUID 指定
    - `/review-flow dddddddd-0001` — prefix 指定 (glob で resolve)
    - `/review-flow path/to/flow.json` — ファイルパス直接
    - `/review-flow` — 引数なし: MCP アクティブタブを取得
    - `/review-flow --all` — 全件並列レビュー

  目的:
    一般 PR レビュー (`/review-pr`) では追わない **ProcessFlow JSON の実行セマンティクス** を専門に検証する。
    JSON Schema valid だが実行時にバグるタイプの問題 (変数前方参照・TX 内外の不整合・runIf 抜け・branch dead-end・
    死コード rollbackOn・event の片側登録) を体系的に検出する。

  発動制御:
    - `disable-model-invocation: true`: ユーザーが明示的に `/review-flow [args]` と打った時のみ起動
    - 自動起動はしない (誤起動防止)。Opus オーケストレーター (`/issues`) からは Skill ツール経由で明示的に呼ぶ

  PR / git 非依存:
    - 設計フェーズ (まだコミットしていないフロー) でも使える
    - 結果は標準出力に出す (PR コメント投稿は行わない)。`/issues` から呼ばれた場合は Opus 側が結果を集約
-->

ProcessFlow `$ARGUMENTS` の **実行セマンティクス**を専門レビューします。

## 役割と前提

- **あなたは ProcessFlow 実行可能性レビュアー専任**。spec 準拠やコード品質一般は対象外 (それは `/review-pr` 担当)
- 検証対象は **「JSON Schema valid だが実行時にバグる」** タイプの問題
- 実装コミットは作らない。レビュー報告のみ
- PR / git 状態に依存しない (設計フェーズから使える)

## Step 0: 引数解決

`$ARGUMENTS` を以下の優先順で解決:

1. **`--all`** → `examples/retail/process-flows/*.json` + `data/process-flows/*.json` (存在すれば) を全件並列レビュー
2. **ファイルパス (`/` か `\` を含む / `.json` で終わる)** → そのまま読む
3. **UUID 形式 (8-4-4-12 hex)** → 以下の優先順でファイルを探す:
   - `data/process-flows/<id>.json`
   - `examples/retail/process-flows/<id>.json`
   - `examples/retail/process-flows/<id>*.json` (glob)
4. **prefix (例: `dddddddd-0001`)** → glob で resolve、複数マッチなら全件レビュー
5. **空 (引数なし)** → designer-mcp の `list_tabs` を呼びアクティブな ProcessFlowEditor のフロー ID を取得 → 1 で resolve

resolve 結果を最初に明示:

```
対象フロー: <絶対パス>
ID: <id>
name: <name>
maturity: <maturity>
```

複数件なら一覧表示してから順次処理。

## Step 0.5: 機械的バリデータ実行 (#599 / #621)

Step 1 の AI 目視レビューに入る前に、実装済みの 12 バリデータを CLI 経由で実行して、機械的に検出可能な参照整合・識別子スコープ・SQL カラム・@conv.* 参照・画面項目イベント連携・画面項目値レベル整合・viewDefinition・画面遷移・設計コントラクト・アンチパターンの問題を先に拾う。

### 実行コマンド

対象フローが属するプロジェクトディレクトリを渡す:

```bash
cd designer
npm run validate:samples -- ../examples/<project-id>
```

### 何が動くか (12 バリデータ)

| # | バリデータ | 検出内容 | 入力 |
|---|---|---|---|
| 1 | referentialIntegrity | responseRef / errorCode / systemRef / compensatesFor 等の不整合 | 常時動作 |
| 2 | identifierScope | 識別子スコープ違反 (root レベル `@var` 未宣言) | 常時動作 |
| 3 | sqlColumnValidator | SQL 内で参照したカラムがテーブル定義に存在しない | `examples/<project-id>/tables/` 経由で自動ロード |
| 4 | conventionsValidator | `@conv.*` 参照が catalog 未登録 | `examples/<project-id>/conventions/catalog.json` を自動ロード |
| 5 | screenItemFlowValidator | 画面項目イベント ↔ 処理フロー連携 (handlerFlowId 実在 / argumentMapping 整合 / primaryInvoker 双方向 / events[].id ユニーク) | 各プロジェクトの `screens/` を per-project でロード (project-level 検査、#619/#621) |
| 6 | screenItemFieldTypeValidator | 画面項目 ↔ フロー 値レベル整合 | 画面項目定義ファイル + 処理フロー JSON |
| 7 | sqlOrderValidator | DB 制約 × 操作順序 (NOT NULL × INSERT / FK × INSERT 順序) | テーブル定義 (v3 形式) を自動ロード (#632) |
| 8 | viewDefinitionValidator | ViewDefinition 整合 (sourceTableId 実在 / columnRef 実在 / 重複列名 / sort/filter/groupBy 列参照 / FieldType 互換) | 各プロジェクトの `view-definitions/` を per-project でロード (project-level 検査、#649) |
| 9 | screenItemRefKeyValidator | 画面項目の refKey が conventions catalog の domainKey と整合 | `screens/` + `conventions/catalog.json` |
| 10 | screenNavigationValidator | 処理フローの画面遷移 step が project.json の screenTransitions 定義と整合 | `project.json` の entities.screenTransitions |
| 11 | runtimeContractValidator | Screen.items embed 検証 (legacy screen-items/ 残存 / kind 別 items 空) | `screens/` ディレクトリ |
| 12 | processFlowAntipatternValidator | 既知アンチパターン検出 (18 ルール) | 処理フロー JSON 直接解析 |

### 結果の取り扱い

- バリデータが検出した issue は **Step 1 のレビュー入力**として活用 (重複説明はしない)
- 結果は Step 2 の「17 観点別カバレッジ」表に **「validator 検出済」** カラムとして記録
- Must-fix 候補: `UNKNOWN_RESPONSE_REF` / `UNKNOWN_ERROR_CODE` / `UNKNOWN_IDENTIFIER` / `UNKNOWN_COLUMN` / `UNKNOWN_CONV_*` / `UNKNOWN_HANDLER_FLOW` / `MISSING_REQUIRED_ARGUMENT` / `EXTRA_ARGUMENT` / `PRIMARY_INVOKER_MISMATCH` / `DUPLICATE_EVENT_ID` / `NULL_NOT_ALLOWED_AT_INSERT` / `FK_REFERENCE_NOT_INSERTED` / `CASCADE_DELETE_OMITTED` 等
- Should-fix 候補 (warning): `INCONSISTENT_ARGUMENT_CONTRACT` (1 フローを呼ぶ複数イベント間で argumentMapping キー集合が異なる) / `UNIQUE_CHECK_MISSING` (UNIQUE カラムへの INSERT で事前重複チェックなし、#640) / `TX_CIRCULAR_DEPENDENCY` (transactionScope 内で INSERT/UPDATE テーブル間に双方向 FK 循環、#642)
- 終了コード 1 (1 件以上 fail) でも Step 1 を中止せず実施する (実行セマンティクス観点が AI 目視のみで残るため)

### 観点 ⇄ バリデータ対応表 (担当領域)

| 観点 | バリデータでカバー | AI 目視のみ |
|---|---|---|
| 1. 変数ライフサイクル | identifierScope (root 識別子の未宣言) / sqlOrderValidator (INSERT 時点の未バインド変数) | TX 順序 / property path / 前方参照は AI |
| 2. TX スコープ整合 | (なし) | AI |
| 3. runIf 連鎖の網羅性 | (なし) | AI |
| 4. branch / elseBranch 到達性 | (なし) | AI |
| 5. compensatesFor 健全性 | referentialIntegrity (compensatesFor 対象の実在チェック) | 補償内容の妥当性は AI |
| 6. eventsCatalog ⇄ eventPublish | (なし、referentialIntegrity 対象外) | AI |
| 7. 外部呼び出しと TX 位置 | referentialIntegrity (systemRef 実在) | TX 内外の位置関係は AI |
| 8. rollbackOn 発火可能性 | referentialIntegrity (UNKNOWN_ERROR_CODE) | TX inner からの実発火可能性は AI |
| 9. 画面項目イベント連携整合 | screenItemFlowValidator (handlerFlowId / argumentMapping / primaryInvoker / events[].id ユニーク) | 業務文脈での argumentMapping 値の妥当性 (UI 入力 → フロー入力の意味的整合) は AI |
| 10. 画面項目値レベル整合 | screenItemFieldTypeValidator (options 包含 / domainKey / 型 / pattern / range / length) | 業務文脈の妥当性 (選択肢命名の業務適切性 / domain 設計妥当性) は AI |
| 11. DB 制約 × INSERT / DELETE 順序 (#632 / #640 / #641 / #642) | sqlOrderValidator (NULL_NOT_ALLOWED_AT_INSERT / FK_REFERENCE_NOT_INSERTED / UNIQUE_CHECK_MISSING / CASCADE_DELETE_OMITTED / TX_CIRCULAR_DEPENDENCY) | 複雑な条件分岐での可能性の有無は AI / UNIQUE チェック抑止パターンの業務妥当性は AI / onDelete 設定が業務要件として適切かは AI / TX 循環の DEFERRED 検出は Phase 5 候補 (別 ISSUE) |
| 12. ViewDefinition 整合 (#649) | viewDefinitionValidator (UNKNOWN_SOURCE_TABLE / UNKNOWN_TABLE_COLUMN_REF / DUPLICATE_VIEW_COLUMN_NAME / UNKNOWN_SORT_COLUMN / UNKNOWN_FILTER_COLUMN / UNKNOWN_GROUP_BY_COLUMN) | sourceTableId ↔ dbAccess テーブルの業務的整合 / FIELD_TYPE_INCOMPATIBLE の業務妥当性は AI |
| 13. SQL SELECT ↔ ViewDefinition alias 整合 (#775) | (なし、目視のみ) | SELECT 結果が viewer VD `columns[].name` と直接バインドする場合に `AS "<camelCase>"` alias があるか / alias 後の camelCase キーで変数参照が一致しているか |
| 15. 業務 semantic 架空値検出 (#780) | (なし、機械検出困難) | WHERE 句 / JOIN 条件のリテラル (`= 'DEFAULT'` 等) がサンプル data に存在するか / 業務概念として意味があるか / multi-* dimension との整合 |
| 16. SQL alias 同名異物理列の event 整合 (#780) | (なし、機械検出困難) | unaliased `i.id` と aliased `p.id AS "productId"` を混在させた SELECT で event payload / outputBinding が誤参照していないか |
| 17. PostgreSQL aggregate 型変換 (#781) | (なし、機械検出困難) | `COUNT(*)` / `SUM(...)` / `AVG(...)` / `DATE_PART(...)` 等の SQL 結果を後続 step で数値比較する場合、`outputBinding.transformations: [{ field, type: "integer" \| "float" \| ... }]` で型変換が宣言されているか。SQL 側で `CAST(...)` を書く形式は anti-pattern (DB 方言を吸収しない) → `transformations` への migration を提案 |

監査根拠: `docs/spec/dogfood-2026-04-29-phase2-validator-audit.md` §3 / §4 + Phase 3 子 1 #619 (PR #626)。

### 終了コードの扱い

- **exit 0**: 8 バリデータ全 pass → Step 1 へ進む
- **exit 1**: 1 件以上の validator issue 検出 → Step 1 を中止せず、issue 内容を Step 2 のカバレッジ表に「validator 検出済」として記録して進む (実行セマンティクス観点が AI 目視のみで残るため)
- **ViewDefinition 関連 Must-fix 候補**: `UNKNOWN_SOURCE_TABLE` / `UNKNOWN_TABLE_COLUMN_REF` / `UNKNOWN_TABLE_REF_IN_VIEW` (#745) / `DUPLICATE_VIEW_COLUMN_NAME` / `UNKNOWN_SORT_COLUMN` / `UNKNOWN_FILTER_COLUMN` / `UNKNOWN_GROUP_BY_COLUMN`
- **ViewDefinition 関連 Should-fix (warning)**: `JOIN_NOT_DECLARED` (Level 2 アップグレード推奨、#745) / `FIELD_TYPE_INCOMPATIBLE` / `FILTER_OPERATOR_TYPE_MISMATCH`
- **exit 2**: 引数異常 / ファイル不在 / JSON parse 失敗 → エラーメッセージを報告し AI 目視のみで Step 1 に進む

### バリデータが動かない場合

- 引数のプロジェクトディレクトリが存在しない / JSON parse 失敗 (= exit 2) → エラーメッセージを報告し Step 1 に進む (AI 目視のみで継続)
- `npm run validate:samples` 自体が失敗 (依存解決等) → 同上、Step 1 に進む
- バリデータ未呼び出しは **Step 2 の「validator 検出済」欄を「未実行」と明記** (隠さない)

## Step 1: 検証項目 (17 観点)

各観点を **必ず実施**。「該当なし」の場合もその旨を明記する。
観点 11 / 12 は機械検出が主 (Step 0.5) で AI 目視は業務文脈の妥当性のみ担当する。観点 15 / 16 / 17 は PR #780 retail audit (段階 4 dogfood) で確立した新規観点で、AI 目視のみ。

### 1. 変数ライフサイクル (Variable Lifecycle)

すべての `@varName` 参照を抽出し、**実行順**に追跡:

- 定義源: `inputs[].name` / `outputs[].name` / `outputBinding` / `ambientVariables[].name` / `domainsCatalog` (型定義のみで実体ではないので除外) / 各 step の `outputBinding`
- 参照箇所: `condition` / `expression` / `bodyExpression` / `sql` / `httpCall.body` / `payload` / `runIf` 等

**検出対象**:
- **前方参照バグ** (今回 PR #460 Must-fix #1 のパターン): step-N が step-M (M > N) で設定される変数を参照している
- **未定義参照**: 一度も設定されない `@var` を参照
- **誤字**: `@input.x` (s 抜け、正しくは `@inputs.x`) 等の typo

報告形式:
```
@<varName>:
  set at: step-X (line Y) [outputBinding | inputs | ambientVariables]
  used at: step-A (line B) <expression>, step-C (line D) ...
  status: ✓ OK / ❌ 前方参照 (set at step-X but used at step-Y where Y < X) / ❌ 未定義
```

### 2. TransactionScope 内外整合 (TX Scope Integrity)

`type: "transactionScope"` の step を全列挙し、各 TX について:

- **inner steps が参照する変数は TX 開始前に設定済みか**
- **inner steps が outputBinding する変数を TX 外で参照する場合、TX commit 前提で安全か** (RETURNING 系は OK だが、TX rollback 時に未定義になる可能性を考慮)
- **inner steps に external system call が含まれていないか** (anti-pattern: TX 中の外部待機が DB 接続を長時間占有)
- **`rollbackOn` のエラーコードが inner steps から実際に発生しうるか** (TX 外 step のエラーで指定すると死コード)
- **`onRollback` の補償 step が inner で書き込んだテーブルを正しく扱っているか**

### 3. runIf 連鎖の網羅性 (runIf Coverage)

冪等 UPSERT (`UPSERT_IDEMPOTENT` operation 使用) の後続 step 群について:

- **UPSERT no-op 時にスキップすべき step すべてに同条件 runIf が付いているか**
- **no-op パスに対応する return step が存在するか** (二項分岐: 通常パス return + no-op パス return)
- **runIf 条件式が UPSERT の outputBinding 結果と整合しているか** (例: `@upsertedTrade.trade_id != null` か `IS NOT NULL` か。式言語の整合)

### 4. branch / elseBranch のパス到達性 (Branch Reachability)

各 `type: "branch"` step について:

- **全 branch + elseBranch が return か後続 step に到達するか** (dead end 検出)
- **共通の return がある場合、両 branch で同じレスポンスが返ってよいか** (誤って早期 return 漏れ)
- **`condition` 式が変数ライフサイクル上有効か** (ライフサイクル分析と連動)

### 5. compensatesFor の参照健全性 (Compensation Integrity)

`compensatesFor: "step-X"` を持つ step すべてについて:

- **対象 step ID が同じ action 内 (または TransactionScope 内) に実在するか**
- **補償 step が補償対象の書き込みを正しく打ち消すか** (例: INSERT に対して REJECTED UPDATE は OK、DELETE はやり過ぎ)

### 6. eventsCatalog ⇄ eventPublish の双方向整合 (Event Symmetry)

- **eventsCatalog で宣言された全イベントについて、いずれかの action で `eventPublish` step が存在するか**
- **`eventPublish.topic` (or `eventRef`) で参照する topic が eventsCatalog に登録されているか**
- **`payload` が catalog の payload schema と整合しているか** (フィールド名・必須項目)

### 7. 外部呼び出しと TX の位置関係 (External Call Placement)

`type: "externalSystem"` step すべてについて:

- **TransactionScope の inner にいないか** (anti-pattern)
- **TX 外なら、`outcomes.failure: "compensate"` 等の補償処理が正しく書かれているか**
- **`fireAndForget: true` の場合、`outcomes.failure: "continue"` になっているか** (発火しっぱなしと整合)

### 8. rollbackOn の発火可能性 (rollbackOn Liveness)

TransactionScope の `rollbackOn: [...]` で指定したエラーコードについて:

- **TX inner steps から実際にこのエラーコードが発生しうるか** (例: TX 外 step が返すエラーを rollbackOn に書いても死コード)
- **対応する `errorCatalog` エントリが存在するか**

### 9. 画面項目イベント連携整合性 (Screen-Item Event Integration)

UI 起点フロー (`type: "screen"` / `mode: "upstream"`) について、画面項目側との接続点を検証。**機械検出の大半は Step 0.5 の `screenItemFlowValidator` でカバー** されるため、AI 目視は **「validator では届かない業務文脈の妥当性」** に絞る。

- **`meta.primaryInvoker` の業務妥当性**: 双方向参照は validator が確認するが、宣言された ScreenItem.events[] が**業務上の主要起動元**として妥当か (例: 「保存」フローの primaryInvoker が「ヘルプリンク」になっていないか)
- **argumentMapping の意味的整合**: validator はキー集合のみを見る。`argumentMapping.amount` に画面側 `@self.priceJpy` を渡しているが、フロー側 `inputs.amount` のドメイン (例: 通貨単位) と一致するかは AI 判断
- **必須/任意の意図整合**: `inputs[].required: true` だが画面側で空文字を渡しうる UI なら、フロー側の入力検証 step (`type: "validate"`) が catch しているか
- **複数イベント呼び出しの設計妥当性**: 同フローを複数イベントから呼ぶ場合、引数の差分が**業務上意図的**か (validator は warning を出すだけで、合理性は AI 判断)
- **画面起点でないフローでの primaryInvoker 設定**: `type: "system"` / `type: "batch"` / `mode: "downstream"` で `meta.primaryInvoker` を設定しているのは設計ミス候補
- **該当なし条件**: `type: "system"` / `type: "batch"` フローで `meta.primaryInvoker` 未設定 + 同プロジェクト内のどの ScreenItem.events[] からも呼ばれていない場合 (validator も起動しない)

報告形式:
```
@<flowId> primaryInvoker: <screenId>.<itemId>.<eventId>
  validator 検出: <validator が出した issue 一覧>
  業務妥当性: ✓ OK / ⚠ 業務文脈で argumentMapping が型整合しない / ❌ primaryInvoker が業務上の主要起動元と異なる
```

#### 観点 10: 画面項目値レベル整合 (#631 / #627、Phase 3 evolved)

UI 起点フロー (`type: "screen"` / `mode: "upstream"`) について、画面項目側との **値レベル** での整合を検証。**機械検出の大半は Step 0.5 の `screenItemFieldTypeValidator` でカバー** されるため、AI 目視は **「validator では届かない業務文脈の妥当性」** に絞る:

- 画面 selectbox / radio の `options[].value` 自体は flow domain enum と一致していても、**選択肢命名が業務として適切か** (例: `label` vs `value` の表示ラベル整合)
- domainKey 設計の業務妥当性 (例: `BenefitType` を多業務で再利用するか専用に閉じるか)
- pattern / range / length の業務上の正当性 (validator は 一致 / 不一致のみ検出、業務として妥当な範囲かは AI 判断)

#### 観点 13: 画面遷移三者整合 (#650、Phase 4 子 2)

画面遷移を含むフローについて、**画面フロー edges × ProcessFlow の `ScreenTransitionStep.targetScreenId` × 画面 path (URL ルーティング)** の三者整合を検証する。**機械検出は Step 0.5 の `screenNavigationValidator` でカバー** されるため、AI 目視は **「validator では届かない業務文脈の妥当性」** に絞る:

- `MISSING_FLOW_EDGE` warning は **業務遷移として意図的か再確認** (画面フロー edges を後で追加すべき遷移か、単に不要なら ScreenTransitionStep 側を削除)
- `MISSING_FLOW_TRANSITION` error (#744) は **edge が `kind: "flow-driven"` なのに対応 ScreenTransitionStep が無い**。純 UI 遷移なら `kind: "navigation"` に修正、処理を伴うなら ProcessFlow に ScreenTransitionStep を追加 (Must-fix 候補)
- `AUTH_TRANSITION_VIOLATION` の例外運用 (login / error 画面以外で auth 不一致を許容するべき業務シナリオが妥当か)
- `DEAD_END_SCREEN` warning が **業務として終端でよい画面か** (確認画面 / 完了画面は終端で正当、それ以外は遷移欠落の可能性)
- `PATH_PARAM_MISMATCH` warning は path 設計の業務的整合性を再確認 (param 名の業務表現が source / target で一致しているか)
- Must-fix 候補: `UNKNOWN_TARGET_SCREEN` (実在しない画面への遷移) / `DUPLICATE_SCREEN_PATH` (path 衝突) / `AUTH_TRANSITION_VIOLATION` (認証 bypass)
- Should-fix 候補: 上記 warning 4 観点

#### 観点 14: 画面項目 refKey 横断整合 (#651、Phase 4 子 3)

このフローに紐付く画面項目の `refKey` 設定と `conventions.fieldKeys` 宣言の整合性を確認する。**機械検出は Step 0.5 の `screenItemRefKeyValidator` でカバー** されるため、AI 目視は **「validator では届かない業務文脈の妥当性」** に絞る:

- 同一 `refKey` の画面項目間で **UI 制約の業務上の差異が正当か** (例: 振込実行は required=true、履歴照会は required=false — 画面 role の違いとして正当)
- `conventions.fieldKeys` の `displayName` / `description` が業務の実態を正確に表しているか
- 未来の画面追加で再利用されるべき共通フィールドに `refKey` が付与されているか (付与漏れは warning 受容可だが将来の整合性リスク)
- `refKey` は `UNDECLARED_REF_KEY` / `INCONSISTENT_TYPE_BY_REF_KEY` は Must-fix 相当 (validator が検出)、それ以外の warning 観点 (INCONSISTENT_FORMAT / VALIDATION / HANDLER_FLOW / ORPHAN / DECLARED_TYPE_MISMATCH) は business context で判断

#### 観点 15: 業務 semantic 架空値検出 (#780 / 落とし穴 24)

業務上意味のないリテラル値が WHERE 句や JOIN 条件に hardcode されていないか検証する。**機械検出は困難**な業務 semantic 領域の AI 目視観点。

- SQL 内で `WHERE <column> = '<LITERAL>'` のようにリテラルが現れる場合、その値が:
  - サンプル data (test scenarios の dbState / examples の seed) に存在するか
  - schema の enum / check constraint で許容されているか
  - 業務概念として意味があるか (例: `'DEFAULT'` 'CENTRAL' のような汎用語は要警戒)
- **multi-* dimension** (multi-store / multi-tenant / multi-region) を持つサンプルでは特に発生しやすい。例: cart に store 概念がないのに inventory 減算で `store_code = 'DEFAULT'` を hardcode して multi-store 設計と矛盾するパターン (PR #780 の M-1)
- 検出手順:
  1. `grep -P "= '[A-Z_]+'"` で全 caps の literal を抽出
  2. 各 literal について、サンプル data / schema enum / 業務 glossary に存在するか確認
  3. 存在しない / 意味不明な場合は Must-fix (実機で必ず破綻)
- 修正方針: WHERE 句を変数参照 (`@cartItem.storeId` 等) に置き換え、必要なら schema レベルで context (例: `cart_items.store_id`) を持たせる

#### 観点 16: SQL alias 同名異物理列の event payload 整合 (#780 / 落とし穴 25)

SELECT で複数テーブルの primary key を取得する場合、unaliased な `id` と aliased な `... AS "<entityId>"` が共存し、後続 step で誤参照するリスクを検証する。

- `SELECT i.id, p.id AS "productId", ...` のように、複数の `.id` を取得していないか
- eventPublish.payload / bodyExpression / outputBinding で `@row.id` と書いている箇所が、SQL の `i.id` (= 別テーブルの主キー) を意味してしまっていないか
- event consumer (eventsCatalog.payload schema) は alias 後のフィールド名 (例: `productId`) を期待しているが、`@row.id` では unaliased な inventory.id が流れる
- 検出手順:
  1. `grep -P "@\\w+\\.id\\b"` で `.id` 参照を抽出
  2. 直前の SELECT で `i.id, p.id AS "productId"` のような複数 id 取得をしている場合は誤参照疑い
  3. event payload / outputBinding で id を期待される field 名に明示参照 (`@row.productId`) しているか確認
- 修正方針: alias 後のフィールド名で明示参照する。または SQL 側で `i.id AS "inventoryId"` と全 column に alias を付ける

#### 観点 17: PostgreSQL aggregate 型変換 (#781 / 落とし穴 26)

`COUNT(*)` / `SUM(...)` 等の戻り値型が PG では bigint / decimal で pg クライアント経由で文字列化される問題を検証する。

- `SELECT COUNT(*) AS "<name>" FROM ...` / `SELECT SUM(<col>) AS "<name>" ...` で取得した値を後続 step で数値比較しているか確認
- pg クライアント (node-postgres) は bigint / decimal を **文字列として** JS に渡すため、`"10" >= 20` の暗黙変換に依存する形になる
- 修正方針: `outputBinding.transformations: [{ field: "<alias>", type: "integer" \| "float" \| ... }]` で runtime に型変換を吸収させる (推奨、#781 で導入済み、`transactionScope` の outputBinding には不適用)。SQL 側で `CAST(...)` を書く形式は DB 方言が SQL に染み出す anti-pattern → `transformations` への migration を提案する
- 検出手順:
  1. `grep -P "COUNT\\(|SUM\\(|AVG\\(|DATE_PART\\(" flow.json` で aggregate を抽出
  2. 該当 step の `outputBinding.transformations` に対応 field の型変換が宣言されているか確認 (なければ Should-fix)
  3. `transformations` の代わりに `CAST(...)` を SQL に書いている場合は anti-pattern として transformations への置き換えを Should-fix で提案
  4. 後続 step での数値比較 (`>=` / `<` / arithmetic) があるかも合わせて確認

## Step 2: 報告フォーマット

結果を **標準出力** に Markdown で出す (PR コメント投稿はしない、設計フェーズで使えるため)。

```markdown
## /review-flow 結果 — <YYYY-MM-DD HH:MM>

**対象**: <絶対パス>
**ID**: <id>
**name**: <name>
**maturity**: <maturity>

---

### 総合判定

**Must-fix: N 件 / Should-fix: M 件 / Nit: K 件**

---

### Must-fix (実行時バグ確実)

#### 1. <観点名>: <一行要約>

- 場所: `<file>:<line>` step-X (`type: <type>`)
- 詳細: ...
- 推奨修正: ...

### Should-fix (実行時の品質劣化リスク)

...

### Nit (任意改善)

...

---

### 17 観点別カバレッジ

`validator 検出済` 欄には Step 0.5 で動作したバリデータの issue 件数を、`AI 目視` 欄には Step 1 で AI が検出した件数 (validator 重複は除外) を記入する。

| 観点 | validator 検出済 | AI 目視 (M / S / N) | 状態 |
|---|---|---|---|
| 1. 変数ライフサイクル | identifierScope: N 件 | M:0 / S:0 / N:0 | ✓ 問題なし / ❌ Must-fix あり |
| 2. TransactionScope 内外整合 | (validator 対象外) | ... | ... |
| 3. runIf 連鎖の網羅性 | (validator 対象外) | ... | ... |
| 4. branch 到達性 | (validator 対象外) | ... | ... |
| 5. compensatesFor | referentialIntegrity: N 件 | ... | ... |
| 6. eventsCatalog ⇄ eventPublish | (validator 対象外) | ... | ... |
| 7. 外部呼び出しと TX | referentialIntegrity (systemRef): N 件 | ... | ... |
| 8. rollbackOn 発火可能性 | referentialIntegrity (UNKNOWN_ERROR_CODE): N 件 | ... | ... |
| 9. 画面項目イベント連携整合性 | screenItemFlowValidator: N 件 (UNKNOWN_HANDLER_FLOW / MISSING_REQUIRED_ARGUMENT / EXTRA_ARGUMENT / PRIMARY_INVOKER_MISMATCH / DUPLICATE_EVENT_ID / INCONSISTENT_ARGUMENT_CONTRACT 内訳) | 業務妥当性 (型整合 / 主要起動元妥当性) は AI | ... |
| 10. 画面項目値レベル整合 | screenItemFieldTypeValidator: N 件 (OPTIONS_NOT_SUBSET_OF_ENUM / DOMAIN_KEY_MISMATCH / TYPE_MISMATCH / PATTERN_DIVERGENCE / RANGE_DIVERGENCE / LENGTH_DIVERGENCE 内訳) | 業務妥当性 (選択肢命名 / domain 設計) は AI | ... |
| 14. 画面項目 refKey 横断整合 | screenItemRefKeyValidator: N 件 (UNDECLARED_REF_KEY / INCONSISTENT_TYPE_BY_REF_KEY / INCONSISTENT_FORMAT_BY_REF_KEY / INCONSISTENT_VALIDATION_BY_REF_KEY / INCONSISTENT_HANDLER_FLOW_BY_REF_KEY / ORPHAN_FIELD_KEY / DECLARED_TYPE_MISMATCH 内訳) | 業務文脈での warning 判断は AI | ... |
| 15. 業務 semantic 架空値検出 (#780) | (validator 対象外) | M:0 / S:0 / N:0 | ✓ 問題なし / ❌ Must-fix あり |
| 16. SQL alias 同名異物理列の event 整合 (#780) | (validator 対象外) | M:0 / S:0 / N:0 | ✓ 問題なし / ❌ Must-fix あり |
| 17. PostgreSQL aggregate 型変換 (#780) | (validator 対象外) | M:0 / S:0 / N:0 | ✓ 問題なし / ⚠ Should-fix あり |

Step 0.5 をスキップした場合は `validator 検出済` 列を全行 `未実行` と記載する。

---

### 変数ライフサイクル詳細 (参考)

| 変数 | 設定 step | 参照 step | 状態 |
|---|---|---|---|
| @inputs.foo | inputs | step-01, step-05 | ✓ |
| @bar | step-02 outputBinding | step-04, step-06 | ✓ |
| @baz | step-08 outputBinding | step-05 | ❌ 前方参照 |

---

### 検証方法

- Step 0.5: `npm run validate:samples -- ../examples/<project-id>` で 12 バリデータ実行
- 対象ファイル全文読み込み: <パス>
- 17 観点を順に手動で grep + ライフサイクル追跡 (validator 検出済の問題は重複説明しない)
- 必要に応じて `schemas/v3/process-flow.v3.schema.json` の TransactionScopeStep 定義も参照
```

## Step 3: 完了報告

ユーザーに短く 1-3 行で:

- 対象フロー (id / name)
- Must-fix / Should-fix / Nit の件数
- 詳細結果は標準出力済 (再表示はしない)

複数プロジェクト検証の場合: 全件サマリ表 (フロー ID × Must-fix 件数) を最後に追加。

## マルチエディタ対応 (#806)

フローレビュー開始前に **関連する画面の `editorKind` / `cssFramework`** を確認する。

### 画面ロード時の解決順序

1. `screen.design.editorKind` / `screen.design.cssFramework` (画面個別指定)
2. `project.techStack.designer.editorKind` / `project.techStack.designer.cssFramework` (project default、#826 で `project.design` から移行)
3. 最終 default (`"grapesjs"` / `"bootstrap"`)

### editorKind 別のデザインファイル参照

- `editorKind: "grapesjs"` → `screens/<id>/design.json` を読む (GrapesJS 形式)
- `editorKind: "puck"` → `screens/<id>/puck-data.json` を読む (Puck Data tree)

### Thymeleaf / React 出力スクリプトの注意

- **Thymeleaf 出力スクリプトは Puck 画面 (`editorKind: "puck"`) を明示スキップしてレポートに記録すること**
- スキップ判定: `screen.design.editorKind === "puck"` または解決後の editorKind が "puck" であること

詳細仕様: `docs/spec/multi-editor-puck.md` § 2.3

## 制約 (必守)

- **マージしない / push しない / PR コメントしない** (設計フェーズでも使える skill のため)
- **対象 JSON ファイルを書き換えない** (レビュー専任、修正は別ワークフロー)
- **検証は read-only** (フロー JSON の Read + schema/spec の Read + Step 0.5 の `npm run validate:samples` 実行のみ)
- **Step 0.5 は必ず試行する** (失敗時は「未実行」と明記して Step 1 に進める)
- **17 観点すべて実施**。「省略」は禁止。該当ゼロ件でもその旨明記
- **JSON Schema 検証は対象外** (vitest や ajv にやらせる責務)。あくまで実行時セマンティクスを見る
- **MCP `designer-mcp` が起動していなくても動く** (引数なし時のみ MCP 利用、明示指定時は不要)

## 注意事項

- 「Must-fix vs Should-fix」基準: 確実に実行時バグ → Must-fix。条件次第でバグる/品質劣化 → Should-fix
- 同種の問題が複数 step に跨る場合は **代表 1 件 + 同種の他箇所列挙** で報告 (重複指摘で報告が膨れない)
- フローが大きい (200 行超) 場合も 17 観点全部を必ず実施。観点ごとにセクション分けて読む
- **`/issues` オーケストレーターから Skill ツール経由で呼ばれた場合**: 結果は標準出力に出す (Opus が読み取る)。ユーザー報告の役割は呼び出し元
