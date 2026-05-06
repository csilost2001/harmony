# Phase 2 子 1 — バリデータ活用度監査 (2026-04-29)

## Executive Summary

4 バリデータ (`sqlColumnValidator` / `conventionsValidator` / `referentialIntegrity` / `identifierScope`) は production UI と `validate:dogfood` CLI の両方で呼ばれており、**集約層 `aggregateValidation` 経由でまとめて動く設計は機能している**。ただし (1) SQL カラム整合と `@conv.*` 参照整合は「テーブル/規約データを渡した場合のみ」オプション実行という構造上の制約があり、(2) 全バリデータが **v1 形式 (`ProcessFlow` 型 `../types/action`) を前提**としており v3 移行が明示的に「TS 型同期後の次着手」として後回しになっている。(3) Skill 統合は **AI 判断ベースのチェックリスト** になっており、バリデータを実際に呼び出す手順が存在しない。Phase 1 ドッグフードの Must-fix 原因を逆引きすると、SQL カラム整合と `@conv.*` catalog 整合の 2 点は「validator が実装されていたが AI が呼んでいなかった」ケースであり、Skill に組み込むことで再発を防げる。

---

## 1. 活用マトリクス

| バリデータ | 関数名 | production UI | aggregator | Vitest | validate:dogfood CLI | Skill |
|---|---|---|---|---|---|---|
| sqlColumnValidator | `checkSqlColumns` | ProcessFlowEditor / ProcessFlowListView (tables 提供時のみ) | aggregateValidation 層 4 経由 | `sqlColumnValidator.test.ts` / `validateDogfood.test.ts` | `validate-dogfood.ts` | なし (Rule 9 に textual checklist のみ) |
| conventionsValidator | `checkConventionReferences` | ProcessFlowEditor / ProcessFlowListView (catalog 提供時のみ) | aggregateValidation 層 5 経由 | `conventionsValidator.test.ts` / `validateDogfood.test.ts` | `validate-dogfood.ts` | なし (Rule 10 に textual checklist のみ) |
| conventionsValidator | `checkConventionsCatalogIntegrity` | ConventionsCatalogView (catalog 自体の整合) | 集約外 (別用途) | `conventionsValidator.test.ts` | なし | なし |
| conventionsValidator | `checkScreenItemConventionReferences` | ScreenItemsView (画面項目定義の @conv 参照) | 集約外 (画面項目専用) | `conventionsValidator.test.ts` | なし | なし |
| referentialIntegrity | `checkReferentialIntegrity` | ProcessFlowEditor / ProcessFlowListView | aggregateValidation 層 2 経由 | `referentialIntegrity.test.ts` / `validateDogfood.test.ts` | `validate-dogfood.ts` | なし |
| identifierScope | `checkIdentifierScopes` | ProcessFlowEditor / ProcessFlowListView | aggregateValidation 層 3 経由 | `identifierScope.test.ts` / `validateDogfood.test.ts` | `validate-dogfood.ts` | なし |

### AJV スキーマ層との役割分担

| 種別 | AJV (JSON Schema) が拾う | バリデータが拾う | どちらも拾わない |
|---|---|---|---|
| 構造的型違反 (required / format / enum 等) | はい | いいえ | — |
| responseRef / errorCode / systemRef など内部 ID 参照の存在 | いいえ | referentialIntegrity ✅ | — |
| @identifier のスコープ宣言 | いいえ | identifierScope ✅ | — |
| SQL 内のカラム名とテーブル定義の突合 | いいえ | sqlColumnValidator ✅ (tables 渡し時) | テーブル定義なし時はどちらも検出不可 |
| @conv.category.key が catalog に存在するか | いいえ | conventionsValidator ✅ (catalog 渡し時) | catalog なし時はどちらも検出不可 |
| TX 外変数の前方参照 / branch fallthrough 等の実行セマンティクス | いいえ | いいえ | /review-flow Skill (AI 目視) |

---

## 2. v3 readiness

### 現状

全バリデータ (`sqlColumnValidator.ts` / `conventionsValidator.ts` / `referentialIntegrity.ts` / `identifierScope.ts`) は `@ts-nocheck` が付いており、`../types/action` (v1/v2 型) を import している。v3 型 (`frontend/src/types/v3/`) は import していない。

`conventionsValidator.ts` のみ `Conventions` (v3 型) を `ConventionsCatalog` として re-export するエイリアスを持つが、これは後方互換のための型付け変換であり実装は v1 ProcessFlow 形式のまま動作している。

| バリデータ | v3 ProcessFlow 直接処理 | v3 型 import | `@ts-nocheck` |
|---|---|---|---|
| sqlColumnValidator | 不可 (v1 `ProcessFlow` / `DbAccessStep` 型を前提) | なし | あり |
| conventionsValidator | 不可 (`ProcessFlow` / `Step` / `ActionDefinition` v1 型を前提) | Conventions 型のみ (re-export) | あり |
| referentialIntegrity | 不可 (v1 `ProcessFlow` / `Step` 型を前提) | なし | あり |
| identifierScope | 不可 (v1 `ProcessFlow` / `Step` / `LoopStep` 等を前提) | なし | あり |

### dogfood v3 報告で挙がっていた「validator 切替」の進捗

`dogfood-2026-04-27-schema-v3.md` の S-1 で「AJV (構造) は pass、`referentialIntegrity.ts` (対参照) は別途 v3 化が必要」と記録されており、`dogfood-2026-04-28-schema-v3-public-service.md` の後続 ISSUE 優先順位でも「**TS 後**」すなわち TS 型同期完了後のタスクとして明示されている。

**現時点では v3 validator 切替は未着手**。`validator 切替` は v3 TS 型同期 ISSUE の後続として起票が予定されているが、2026-04-29 時点で当該 ISSUE は存在しない。

---

## 3. Skill 統合状況

### `/create-flow` SKILL (`.claude/skills/create-flow/SKILL.md`)

15 ルールのうち Rule 9 (SQL SELECT カラム整合) と Rule 10 (`@conv.*` 参照の catalog 整合) はバリデータが直接検出できる領域だが、Skill の手順は「AI が自分で SQL を読んで確認する」テキストチェックリストであり、`checkSqlColumns` / `checkConventionReferences` を呼び出すコマンドや自動化ステップは存在しない。

Step 5 の完成後検証コマンドは以下:

```bash
cd frontend
npx vitest run src/schemas/extensions-samples.test.ts src/schemas/process-flow.schema.test.ts
npm run build
```

`validate:dogfood` (`npm run validate:dogfood`) は呼んでいない。これは `validate-dogfood.ts` が `docs/sample-project/` サンプルの横断検証を目的とするスクリプトであり、個別フロー 1 件への実行を想定していないという設計上の理由による。

### `/review-flow` SKILL (`.claude/skills/review-flow/SKILL.md`)

8 観点はすべて AI による手動読み取り + ライフサイクル追跡であり、バリデータ呼び出しステップは存在しない。Step 1 では「8 観点を順に手動で grep + ライフサイクル追跡」と明記されている。

`referentialIntegrity` / `identifierScope` が機械的に検出できる responseRef や識別子スコープ問題を AI が見逃す可能性があるが、現行 Skill はこれを補う仕組みを持たない。

### ギャップのまとめ

| ギャップ | 対象 Skill | 影響 |
|---|---|---|
| SQL カラム整合をバリデータで自動チェックしない | /create-flow Rule 9 | AI が SELECT 漏れを見落とす (実際に #486 で発生) |
| @conv.* 整合をバリデータで自動チェックしない | /create-flow Rule 10 | AI が catalog 未登録キーを見落とす (実際に #486 で発生) |
| validate:dogfood を Step 5 で呼ばない | /create-flow Step 5 | サンプルへの drift が即座に検出されない |
| referentialIntegrity 結果を review-flow で参照しない | /review-flow | 機械的に検出可能な参照問題をレビュアー任せにしている |
| identifierScope 結果を review-flow で参照しない | /review-flow | 識別子スコープ問題を AI 目視に依存 |

---

## 4. Phase 1 retrospective

Phase 1 ドッグフード報告で記録された Must-fix を各バリデータとの対応で分析する。

### 4.1 #486 物流ドッグフード (`dogfood-2026-04-27-logistics-create-flow-validation.md`)

| Must-fix | 本来 catch すべきバリデータ | catch できなかった理由 |
|---|---|---|
| SELECT カラム漏れ (`@shipment.quantity` を SELECT していないのに参照) | `sqlColumnValidator` (UNKNOWN_COLUMN) | Skill の Step 5 で `checkSqlColumns` を呼ぶステップがない。バリデータ実装は存在するが AI が呼んでいなかった |
| `@conv.limit.maxDeliveryAttempts` が conventions-catalog.json 未登録 | `conventionsValidator` (UNKNOWN_CONV_LIMIT) | 同上。`checkConventionReferences` を呼ぶステップが Skill にない |
| TX inner branch return 後の制御不明 | どのバリデータも対象外 (実行セマンティクス) | /review-flow の観点 2/4 の AI 目視のみ。機械的検出不可 |

### 4.2 #458/#478 金融・製造ドッグフード

| 代表 Must-fix パターン | 本来 catch すべきバリデータ | catch できなかった理由 |
|---|---|---|
| TX 内 step が TX 外設定変数を前方参照 | `identifierScope` の変数ライフサイクル追跡 (部分的に検出可能) | identifierScope は TX スコープを考慮せず実行順の前方参照は未検出。/review-flow の観点 1/2 の AI 目視が担当 |
| 死コード rollbackOn (TX 外エラーコードを rollbackOn に指定) | `referentialIntegrity` (UNKNOWN_ERROR_CODE) | エラーコード自体は存在するため UNKNOWN_ERROR_CODE は発生しない。発火可能性 (TX inner から実際に throw されるか) は AI 目視のみ |
| inlineBranch.ng 欠落 | 構造バリデータ `validateProcessFlow` で検出可能 (ValidationStep の required チェック) | AJV スキーマ側で required に含まれていない場合は schema バリデータも検出しない |
| catalog 未登録 eventPublish | `referentialIntegrity` の UNKNOWN_SYSTEM_REF/ERROR_CODE 系。eventPublish.topic と eventsCatalog の突合は referentialIntegrity の対象外 | referentialIntegrity はレスポンス/エラー/システム/シークレット参照のみカバー。eventsCatalog との双方向突合は /review-flow 観点 6 の AI 目視のみ |

### 4.3 SELECT カラム漏れの構造的検出可能性

`sqlColumnValidator` の `checkSqlColumns` は SQL の SELECT 句で取得したカラム列を検証するのではなく、**SQL 中で参照されたカラムがテーブル定義に存在するか**を検証する。

「SELECT に含めなかったカラムを後続ステップで `@bind.column` として参照する」問題は、`sqlColumnValidator` ではなく `identifierScope` の守備範囲に近い。具体的には:

- `dbAccess` step の `outputBinding` でバインドされた変数のシェイプ (どの列が含まれるか) を追跡し
- 後続 step で `@bindVar.column` として参照されたフィールドが SELECT 句に含まれているか

この突合は `identifierScope` の現実装では行っていない (root 識別子のみ検査、property path は無視する方針)。よって SELECT カラム漏れは現行バリデータでは構造的に検出できず、AI による Rule 9 チェックリスト確認が唯一の防衛線となっている。

---

## 5. Phase 2 子 ISSUE 案

### 子 2: 新業界シナリオ — 医療・行政複合業務 v3 ドッグフード

**具体タイトル案**: `dogfood(v3): 医療/行政業務で v3 ProcessFlow + バリデータ実行セマンティクスを検証 (親 #493 子 2)`

**briefing 案**:

`dogfood-2026-04-28-schema-v3-public-service.md` の Round 4 で「healthcare / 教育」が v3 schema の未検証業界として残っている。本 ISSUE では医療業務 (診察予約 → 患者記録 → 処方箋発行 など) または社会保険行政業務 (給付申請 → 審査 → 支払通知) を対象に v3 ProcessFlow を 2 シナリオ生成し、以下を同時検証する:

1. AJV v3 schema 検証 (v3-samples.test.ts に追加)
2. `checkReferentialIntegrity` / `checkIdentifierScopes` が v1 形式で v3 サンプルを実行した場合の挙動 (v3 TS 型同期前の暫定 readiness 確認)
3. `/create-flow` Rule 9/10 チェックが SQL カラム整合・@conv 整合で機能するか実測

業界選定理由: 金融 (securities) / 製造 / 物流 / 小売 / 行政 (public-service) は既検証済。医療は WorkflowStep (多段承認) + externalSystem (電子カルテ連携) + PrivacyPolicy (センシティブデータ) が自然に現れるため、validator 活用度の高い業界として最適。物流は Phase 1 (#486) で検証済みのため除外。

### 子 3: `/create-flow` SKILL に整合性チェック追加

**具体タイトル案**: `improve(skill): /create-flow Step 5 に validate:dogfood と identifierScope 呼び出しを統合 (親 #493 子 3)`

**briefing 案**:

本監査で判明した Skill のギャップを解消する。Step 5 (完成後の自己検証) に以下を追加する:

**追加 1: `validate:dogfood` 実行**

`/create-flow` で作成したフローを `docs/sample-project/process-flows/` に配置した後、`cd frontend && npm run validate:dogfood` を実行し、全バリデータを横断的に一括検証する。これにより SQL カラム整合 (Rule 9) と @conv 整合 (Rule 10) を機械的に検出できる。

**追加 2: identifierScope の個別実行方針**

`validate:dogfood` は `docs/sample-project/` 全件を対象とするため、作成中の単一フローのみを検証する場合は `checkIdentifierScopes` を `validateDogfood.test.ts` の単体実行パターンで呼ぶ手順を Step 5 に追記する。

**対象ファイル**: `.claude/skills/create-flow/SKILL.md` (Step 5 の検証コマンドブロックに 1 ステップ追加)。コード変更は不要。

### 子 4: `/review-flow` SKILL に referentialIntegrity / identifierScope 実行を統合

**具体タイトル案**: `improve(skill): /review-flow の Step 1 前に checkReferentialIntegrity + checkIdentifierScopes を実行 (親 #493 子 4)`

**briefing 案と根拠**:

`/review-flow` vs 新規 `/review-table-flow` の選択:

- `/review-flow` は ProcessFlow 単体の実行セマンティクスレビュー。`referentialIntegrity` (responseRef / errorCode / systemRef) と `identifierScope` (変数スコープ) はどちらも ProcessFlow 単体で動くバリデータであり、**対象が同一**。
- 新規 `/review-table-flow` はテーブル定義とフローの横断整合 (SQL カラム突合、テーブル参照の存在確認) を目的とする場合に意義があるが、既存の `/review-flow` 観点 1 (変数ライフサイクル) は identifierScope が補完できる。
- **結論**: 既存 `/review-flow` の Step 0 後に `validate:dogfood` の個別 flow 実行 (または `checkReferentialIntegrity(flow)` / `checkIdentifierScopes(flow)` を呼ぶ短いコマンド) を前置する方が Skill 分散より実用的。

具体的な追加内容:

1. Step 0 (引数解決) の後、Step 1 (観点検証) の前に「**事前バリデータ実行**」ステップを挿入
2. 実行: `validateDogfood.test.ts` のパターンを参考に flow JSON を読み込んで 4 バリデータを呼ぶ (tables / conventions は `docs/sample-project/` から読む前提)
3. バリデータ結果は観点別カバレッジ表に「validator 検出済」として記録し、AI 目視から除外する

### 子 5: Phase 2 評価レポートと Phase 3 移行判断

**具体タイトル案**: `docs(spec): Phase 2 評価レポート — バリデータ横断新業界検証の結果 + Phase 3 移行判断 (親 #493 子 5)`

**briefing 案**:

子 2 (新業界 v3 ドッグフード) と 子 3/4 (Skill 統合) の完了後に実施する。評価観点:

1. 新業界 2 シナリオで Must-fix が 0 件になるまでのラウンド数 (子 2 の定量成果)
2. Skill 統合後の `/create-flow` 初回 Must-fix 削減率 (子 3/4 の定量成果、#486 比較)
3. v3 TS 型同期完了後に validator 切替を起票するか判断 (現行 v1 型バリデータのまま Phase 3 継続可能か)
4. Phase 3 として「テーブル定義 + 処理フロー横断整合の自動検証 (SQL カラム突合 deep 化 + テーブル v3 参照整合)」に進むかの判断材料を整理

---

## 結論と次アクション

### 結論

1. **バリデータ実装は整備されている**: 4 バリデータは production UI (ProcessFlowEditor / ProcessFlowListView) と `validate:dogfood` CLI の両方で動作しており、基本的な活用マトリクスは機能している。

2. **Skill 統合が欠けている**: Rule 9/10 の SQL / @conv チェックは「AI がテキストで確認」にとどまり、バリデータを呼び出す自動化ステップが存在しない。これが #486 の Must-fix 2 件の根本原因。

3. **v3 readiness は「TS 同期後」待ち**: 全バリデータが v1 型前提であり、v3 ProcessFlow サンプルに対して v1 型でそのまま呼び出すとプロパティアクセスが異なる可能性がある。ただし `validate:dogfood` スクリプトは `docs/sample-project/` (v1) サンプルを対象とするため、v3 サンプル (`docs/sample-project-v3/`) との gap は現時点で許容範囲。

4. **SELECT カラム漏れは現行バリデータで構造的検出不可**: property path レベルの突合 (SELECT した列と後続参照) は `identifierScope` の守備範囲外。中長期的には `identifierScope` を拡張するか、新たな Step-level output shape validator が必要。

### 次アクション

| 優先度 | アクション | 対応 ISSUE 候補 |
|---|---|---|
| 高 | `/create-flow` Step 5 に `validate:dogfood` を追加 | 子 3 |
| 高 | `/review-flow` Step 0 後に referentialIntegrity + identifierScope 自動実行を追加 | 子 4 |
| 中 | 医療/行政業務 v3 シナリオドッグフード (バリデータ実行効果の定量測定) | 子 2 |
| 中 | v3 TS 型同期完了後の validator 切替起票 | TS 同期 ISSUE 完了後 |
| 将来 | identifierScope の property path 追跡 (SELECT カラム漏れの構造的検出) | 別 ISSUE、Phase 3 候補 |
