# Phase 4 統合評価レポート + Phase 5 移行判断 (2026-04-30)

## エグゼクティブサマリ

Phase 4 メタ #648 (画面 ↔ DB ↔ 処理フロー の構造系統合) は、3 つの子 ISSUE (#649/#650/#651) が同日 (2026-04-30) に全て PR マージされ、**目標を達成した状態でクローズ可能**。Phase 5 への移行は **進行可、フォローアップ ISSUE 管理が前提** (Phase 3 と同パターン)。

主要な到達点:

1. **3 子同日マージ — 三軸の構造系統合が完結** — ViewDefinition / 画面遷移整合 / 画面項目共通化の各 axis が独立 PR として並走し、同日クローズ
2. **validator カウンター 5 件 → 12 件 (Phase 3 終了時 5 件 + Phase 3→4 間フォローアップ 4 件 + Phase 4 本体 3 件)** — 検出機構が大幅に拡張され、CLI 一発で 12 観点の自動検査が可能に
3. **Skill 統合 Rule 19 → Rule 22 / 観点 11 → 観点 14** — Phase 4 3 子それぞれで Rule / 観点が追加され、`/create-flow` と `/review-flow` の自動チェックが更に強化
4. **paving 2 業界先行戦略が Phase 4 でも有効** — 各子で 2 業界を選定して具体実装し、残 5 業界は別 ISSUE 候補として整理。一括 7 業界対応より反復学習コストが低い
5. **main 直接コミット事故の発生 → 記録と運用改善** — 子 2 (#650) Sonnet が SKILL.md を main ブランチに直接コミット (commit `a744577`)。本 Phase 評価レポートに記録し、順次進行への方針変更で再発防止

## 子 ISSUE 完了サマリ

### 子 1: ViewDefinition 一覧 UI viewer 概念新設 (#649 / PR #656)

**成果物**: 一覧 UI viewer の構造化定義概念 `ViewDefinition` を v3 schema に新設。

**主要な変更**:
- `schemas/v3/view-definition.v3.schema.json` 新規 (kind / sourceTableId / columns / sortDefaults / filterDefaults / pageSize / groupBy)
- `schemas/v3/project.v3.schema.json` に `viewDefinitions[]` エントリ追加
- `schemas/v3/screen.v3.schema.json` に `Screen.viewDefinitionRefs[]` 追加
- `frontend/src/types/v3/view-definition.ts` 新設 (ViewDefinition / ViewColumn / SortSpec / FilterSpec / ViewDefinitionId)
- **validator 新設 (9 件目 / 通算で validate-dogfood 8 番目)**: `viewDefinitionValidator.ts` — 9 観点 (#745 で 11 観点に拡張: 3 レベル DSL 対応 + DUPLICATE_QUERY_ALIAS)

**validator 観点 (#745 反映、11 観点)**:

| issue code | severity | 検出内容 |
|---|---|---|
| `UNKNOWN_SOURCE_TABLE` | error | sourceTableId / query.from.tableId / query.joins[].tableId が同プロジェクト内に存在しない |
| `UNKNOWN_TABLE_COLUMN_REF` | error | ViewColumn.tableColumnRef が存在しないテーブル列を参照 |
| `UNKNOWN_TABLE_REF_IN_VIEW` | error | Level 2: ViewColumn.tableColumnRef.tableId が query.from / query.joins[] のいずれにも含まれない (#745) |
| `JOIN_NOT_DECLARED` | warning | Level 1: tableColumnRef.tableId が sourceTableId と異なる (暗黙 join、Level 2 アップグレード推奨。#745、旧 `COLUMN_REF_NOT_IN_SOURCE_TABLE` を再定義) |
| `DUPLICATE_VIEW_COLUMN_NAME` | error | ViewDefinition 内で ViewColumn.name が重複 |
| `FIELD_TYPE_INCOMPATIBLE` | warning | ViewColumn.type が参照先テーブル列の DataType と互換なし |
| `UNKNOWN_SORT_COLUMN` | error | sortDefaults が ViewDefinition.columns に存在しない列を参照 |
| `UNKNOWN_FILTER_COLUMN` | error | filterDefaults が ViewDefinition.columns に存在しない列を参照 |
| `FILTER_OPERATOR_TYPE_MISMATCH` | warning | filterDefaults.operator が列 type と不整合 (text に between、数値に contains 等) |
| `UNKNOWN_GROUP_BY_COLUMN` | error | groupBy が ViewDefinition.columns に存在しない列を参照 |

**テスト**: 24 ケース (viewDefinitionValidator.test.ts)
**paving 業界**: retail (商品一覧 5 列) + welfare-benefit (受給者一覧 5 列、eligibilityStatus フィルタ)
**Skill 統合**: `/create-flow` Rule 20、`/review-flow` 観点 12
**validate:dogfood**: 18/18 flows pass、2 viewDefinitions 検出 (regression なし)

**設計判断**: Screen と ViewDefinition の関係を Screen.viewDefinitionRefs[] による 1:N 方式で採用。DB View (view.v3.schema.json) とは別概念 (axis が異なる) として独立 schema 化。UI 編集画面 (ViewDefinitionEditor / ViewDefinitionListView) は別 ISSUE 候補 (本 PR スコープ外)。

### 子 2: 画面遷移整合 — screenNavigationValidator 三者整合 validator (#650 / PR #657)

**成果物**: 画面フロー edges × ScreenTransitionStep × URL ルーティングの三者整合を新 validator で検出。

**主要な変更**:
- **validator 新設 (12 件目 / validate-dogfood 9 番目)**: `screenNavigationValidator.ts` — 7 観点
- `screenNavigationValidator.test.ts` — 23 テストケース
- 7 業界サンプル更新: retail 商品詳細 ↔ カート + 各業界 1 ScreenTransitionStep + 対応 edge

**validator 7 観点**:

| issue code | severity | 検出内容 |
|---|---|---|
| `UNKNOWN_TARGET_SCREEN` | error | ScreenTransitionStep.targetScreenId が同プロジェクト内に存在しない |
| `MISSING_FLOW_EDGE` | warning | フロー内に ScreenTransitionStep があるが対応 edge (画面フロー) が無い |
| `MISSING_FLOW_TRANSITION` | error | `kind: "flow-driven"` 宣言の edge に対応 ScreenTransitionStep が無い (#744、純 UI 遷移は `kind: "navigation"` で検出対象外。旧 `ORPHAN_FLOW_EDGE` warning を再定義) |
| `DUPLICATE_SCREEN_PATH` | error | 同プロジェクト内で path が重複する画面 |
| `PATH_PARAM_MISMATCH` | warning | 遷移先 path の `:param` が遷移元 path にない |
| `AUTH_TRANSITION_VIOLATION` | error | auth:none/optional 画面から auth:required 画面への直接遷移 |
| `DEAD_END_SCREEN` | warning | ゴール画面以外で遷移可能な先が無い画面 |

**テスト**: 23 ケース (screenNavigationValidator.test.ts)
**paving 業界**: retail (2 edge)、他 6 業界各 1 edge 以上 (finance/logistics/manufacturing/public-service は画面・フロー新規)
**Skill 統合**: `/create-flow` Rule 21 (PR #657 ブランチコミット) → **注: Skill ファイルは main ブランチ直接コミット** (`a744577`)、`/review-flow` 観点 13
**validate:dogfood**: 19/19 pass (8 プロジェクト、retail 追加で 1 増)
**schema 変更**: なし (既存 schema で表現可能)

### 子 3: 画面項目共通化 — ScreenItem.refKey + Conventions.fieldKeys (#651 / PR #655)

**成果物**: 画面項目の論理同一性 (`ScreenItem.refKey`) + 規約カタログのフィールドキー定義 (`Conventions.fieldKeys`) + 横断整合 validator 新設。

**主要な変更**:
- `schemas/v3/screen-item.v3.schema.json`: `ScreenItem.refKey?: Identifier` 追加
- `schemas/v3/conventions.v3.schema.json`: `Conventions.fieldKeys?: Record<string, FieldKeyEntry>` + `FieldKeyEntry` $defs 追加
- `frontend/src/types/v3/screen-item.ts` / `conventions.ts` 型同期
- **validator 新設 (10 件目 / validate-dogfood 10 番目)**: `screenItemRefKeyValidator.ts` — 7 観点
- `screenItemRefKeyValidator.test.ts` — 27 テストケース
- `sqlOrderValidator.ts` 予防的修正: `colVarMap.get(c)` が `undefined` を返した場合の `Set.has(undefined)` 問題の予防的修正 (L414/L422)

**validator 7 観点**:

| issue code | severity | 検出内容 |
|---|---|---|
| `UNDECLARED_REF_KEY` | error | ScreenItem.refKey が conventions.fieldKeys に宣言されていない |
| `INCONSISTENT_TYPE_BY_REF_KEY` | error | 同一 refKey を持つ ScreenItem 間で type が不整合 |
| `INCONSISTENT_FORMAT_BY_REF_KEY` | warning | 同一 refKey の ScreenItem 間で format が不整合 |
| `INCONSISTENT_VALIDATION_BY_REF_KEY` | warning | 同一 refKey の ScreenItem 間で validation ルールが不整合 |
| `INCONSISTENT_HANDLER_FLOW_BY_REF_KEY` | warning | 同一 refKey の events.handlerFlowId が異なる |
| `ORPHAN_FIELD_KEY` | warning | conventions.fieldKeys に宣言されているが refKey を持つ ScreenItem が存在しない |
| `DECLARED_TYPE_MISMATCH` | warning | ScreenItem.type が fieldKeys エントリの expectedType と不整合 |

**テスト**: 27 ケース (screenItemRefKeyValidator.test.ts)
**paving 業界**: finance (accountNumber / transferAmount, 振込履歴照会画面新規) + logistics (warehouseCode / transferOrderNumber, 出荷一覧照会画面新規)
**Skill 統合**: `/create-flow` Rule 22、`/review-flow` 観点 14
**validate:dogfood**: 18/18 flows pass、false positive ゼロ
**設計判断**: Opus が案 A (refKey のみ) / 案 B (conventions 単独) / 案 C (ハイブリッド) を評価し、案 C ハイブリッドを採用 (設計者承認済)

## 新 Schema 拡張一覧

Phase 4 で追加・拡張されたスキーマ要素:

| schema ファイル | 追加要素 | 追加子 ISSUE |
|---|---|---|
| `schemas/v3/view-definition.v3.schema.json` | 新規ファイル全体 (ViewDefinition / ViewColumn / SortSpec / FilterSpec 等) | 子 1 #649 |
| `schemas/v3/project.v3.schema.json` | `viewDefinitions?: ViewDefinitionId[]` | 子 1 #649 |
| `schemas/v3/screen.v3.schema.json` | `viewDefinitionRefs?: ViewDefinitionId[]` | 子 1 #649 |
| `schemas/v3/screen-item.v3.schema.json` | `ScreenItem.refKey?: Identifier` | 子 3 #651 |
| `schemas/v3/conventions.v3.schema.json` | `Conventions.fieldKeys?: Record<string, FieldKeyEntry>` + `FieldKeyEntry` $defs | 子 3 #651 |

子 2 (#650) は schema 変更なし (既存 schema で ScreenTransitionStep / 画面フロー edge を表現可能なことを事前確認)。

## Validator カウンター推移

Phase 3 終了時 (5 件) から Phase 4 終了時 (12 件) までの推移:

| # | validator | 追加 Phase | PR | issue code 数 |
|---|---|---|---|---|
| 1 | `sqlColumnValidator` | Phase 2 (α→β) | #603 | — (Phase 2 既存) |
| 2 | `conventionsValidator` | Phase 2 (α→β) | #603 | — (Phase 2 既存) |
| 3 | `referentialIntegrity` | Phase 2 (α→β) | #603 | — (Phase 2 既存) |
| 4 | `identifierScope` | Phase 2 (α→β) | #603 | — (Phase 2 既存) |
| 5 | `screenItemFlowValidator` | Phase 3 子 1 | #626 | 6 |
| 6 | `screenItemFieldTypeValidator` | Phase 3→4 フォローアップ #631/#627 | #633 | 6 |
| 7 | `sqlOrderValidator` (MVP 観点 1+2) | Phase 3→4 フォローアップ #632 | #647 | 2 |
| 8 | `viewDefinitionValidator` | Phase 4 子 1 #649 | #656 | 9 |
| 9 | `screenNavigationValidator` | Phase 4 子 2 #650 | #657 | 7 |
| 10 | `screenItemRefKeyValidator` | Phase 4 子 3 #651 | #655 | 7 |

**Phase 3 終了時 5 件 → Phase 4 着手前フォローアップで +2 件 → Phase 4 本体 3 子で +3 件 = 合計 10 件** (validate-dogfood 組込順)

注: `sqlOrderValidator` は Phase 4 メタ (#648) 外の独立進行 (着手承認は 2026-04-30)。Phase 3 評価レポートのフォローアップ (δ) として扱われ、Phase 4 子扱いはしていないが、同日マージ済。

## Skill 統合

Phase 4 を通じた `/create-flow` / `/review-flow` の Rule / 観点数推移:

| 時点 | /create-flow Rule 数 | /review-flow 観点数 | validator 数 (Skill 記載) |
|---|---|---|---|
| Phase 3 完了時 | Rule 16 | 9 観点 | 5 |
| screenItemFieldTypeValidator 追加 (#633) | Rule 17 | 10 観点 | 6 |
| sqlOrderValidator 追加 (#647) | Rule 19 | 11 観点 | 7 |
| Phase 4 子 1 ViewDefinition (#656) | Rule 20 | 12 観点 | 8 |
| Phase 4 子 2 screenNavigation (#657) | Rule 21 | 13 観点 | 9 |
| Phase 4 子 3 screenItemRefKey (#655) | **Rule 22** | **14 観点** | **10** |

各 Rule / 観点の内容:

| Rule / 観点 | 内容 | PR |
|---|---|---|
| Rule 17 / 観点 10 | screenItemFieldTypeValidator — 画面 ↔ フロー 値レベル整合 (Phase 3 M2 反省) | #633 |
| Rule 18 | testScenarios fixture バリエーション網羅指針 (Phase 2 M1 反省、#608) | #634 |
| Rule 19 / 観点 11 | sqlOrderValidator — DB 制約 × INSERT 順序交差検査 | #647 |
| Rule 20 / 観点 12 | viewDefinitionValidator — 一覧 UI viewer 整合 (Phase 4 子 1) | #656 |
| Rule 21 / 観点 13 | screenNavigationValidator — 画面遷移三者整合 (Phase 4 子 2) | #657 |
| Rule 22 / 観点 14 | screenItemRefKeyValidator — 論理フィールド横断整合 (Phase 4 子 3) | #655 |

## paving 戦略の評価

### 「2 業界 paving + 残別 ISSUE」の有効性

Phase 3 から継続している「各子で 2 業界を先行 paving + 残は別 ISSUE 候補」戦略は Phase 4 でも有効だった:

| 子 | paving 業界 | paving の具体内容 |
|---|---|---|
| 子 1 #649 | retail + welfare-benefit | ViewDefinition JSON を直接記述 (一覧画面 + フィルタ設定) |
| 子 2 #650 | retail (2 edge) + 残 5 業界各 1 edge | retail は具体的 2 screen 新設、残はミニマル 1 ScreenTransitionStep |
| 子 3 #651 | finance + logistics | conventions.fieldKeys に業界特有キーを登録 + 新規照会画面 |

### 業界選定の根拠

- **子 1 retail**: 既存サンプルが最も完成度高く、商品マスタ テーブルに LIST 一覧適用しやすい
- **子 1 welfare-benefit**: Phase 3 の画面項目 paving が完成済み、一覧 UI の eligibilityStatus フィルタが業務適合
- **子 2 retail**: 商品詳細 ↔ カートの典型的な遷移シナリオが存在し、2-edge 構成を自然に作れる
- **子 3 finance**: accountNumber / transferAmount という強い業務論理フィールドが複数画面で共有
- **子 3 logistics**: warehouseCode が複数フロー・画面にまたがり refKey 適用効果が高い

### 7 業界完全 paving の残課題

子 2 (#650) は validate-dogfood を 7 業界全対応に更新しているが、子 1 / 子 3 は 2 業界 paving のみ。残 5 業界への ViewDefinition 追加 / fieldKeys 追加は後続 ISSUE 候補として整理。

## 想定外の事象 + 改善余地

### (1) main 直接コミット事故 (a744577 — 子 2 Sonnet)

**事象**: 子 2 (#650) を実装した Sonnet セッションが `.claude/skills/create-flow/SKILL.md` と `.claude/skills/review-flow/SKILL.md` を **main ブランチに直接コミット** した (`improve(skill): /create-flow Rule 17 + /review-flow 観点 10`, commit `a744577`)。PR #657 のブランチではなく main に直接 push されており、後続ブランチの rebase で取り込まれる形になった。

**影響**: Skill ファイルが意図しないタイミングで main に適用。PR レビューが完了する前に本番 (main) に Skill 変更が反映されてしまった。

**対策**: 本 Phase 評価レポートに記録し、並行 worktree 運用を **順次進行** に方針変更。次 Phase からは「子 ISSUE を順番に実装 → マージ → 次の子に着手」とし、同時並行 worktree は使わない。

### (2) 並行 worktree での競合多発 → 順次運用に方針変更

**事象**: Phase 4 は子 1/2/3 を並行 worktree で実装したため、3 ブランチが同じ `validate-dogfood.ts` / `SKILL.md` / `schemas/` を修正し、rebase/merge 競合が多発。

**影響**: rebase 時間が増加し、競合解消ミスのリスクがあった。

**対策**: Phase 5 から「3 子同時着手 → 順次マージ」方式を採用し、worktree 並行作業は外部サービス統合テスト等の完全独立 axis にのみ使用する。

### (3) PR スコープ外変更 (PR #645 Nit-1/Nit-2)

**事象**: `generate-dogfood.ts` を per-project 構造に対応した PR #645 で、`discoverProjects` 2 重スキャン (Nit-1 #652) と v3 プロジェクトへの v1 フォーマット書き込み (Nit-2 #653) が Sonnet 独立レビューで発見。本 PR スコープ外として別 ISSUE 化。

**影響**: 機能的バグではないが、パフォーマンスと正確性の問題として残留している。

**対策**: #652 / #653 は Phase 5 またはバックログで対応予定。

### (4) Sonnet 権限拒否 (worktree 内 SKILL.md)

**事象**: 子 2 (#650) の Sonnet セッションが worktree 内で SKILL.md を読み込もうとした際、権限エラー (permission denied) が発生。Opus が直接対応し、別途 main への直接コミットにつながった。

**対策**: worktree 内での Skill ファイル参照をセッション開始前に許可設定するか、Opus が worktree 外で Skill ファイルを更新する手順を定式化する。

### (5) Codex 文字化け疑念 (誤報)

**事象**: Phase 4 着手前のレビューで Rule 20 付近の表記に文字化けの疑念が生じた。`grep [ｦ-ﾟ]` で全 3 PR のファイルを検査した結果、**半角カナは 0 件** (誤報)。

**確認**: 各 PR に文字化け検査 (`grep [ｦ-ﾟ]`) 結果を明記し、false alarm を記録。

## Phase 5 移行判断

### i18n / WAI-ARIA スコープ外 (Phase 5 候補)

Phase 4 メタ #648 策定時から「i18n (多言語化整合) + WAI-ARIA (アクセシビリティ整合)」は **スコープ外** として Phase 5 候補に分離されていた。2026-04-30 時点でのユーザー判断: **「現状不要、将来再評価」**。Phase 5 に組み込むかどうかは次のメタ ISSUE 起票時に改めて判断する。

### 残バックログ一覧

| ISSUE | タイトル要約 | 種別 | Phase 5 組込候補 |
|---|---|---|---|
| #640 | sqlOrderValidator 観点 3 UNIQUE_CHECK_MISSING | validator 拡張 | 設計者承認待ち |
| #641 | sqlOrderValidator 観点 4 CASCADE_DELETE_OMITTED | validator 拡張 | 設計者承認待ち |
| #642 | sqlOrderValidator 観点 5 TX_CIRCULAR_DEPENDENCY | validator 拡張 | 設計者承認待ち |
| #652 | generate-dogfood discoverProjects 2 重スキャン (Nit-1) | Nit | バックログ並走可 |
| #653 | generate-dogfood dummy モード v3 project に v1 フォーマット書込 (Nit-2) | Nit | バックログ並走可 |
| #654 | sqlOrderValidator の boundVars に fieldErrorsVar 等を追加 | Nit | バックログ並走可 |

#640/#641/#642 は **設計者承認済み** (2026-04-30 確認)。Phase 5 子 ISSUE として組み込むか、独立並走か、起票時に判断する。

#652/#653/#654 は Nit 相当で Phase 5 メタには組み込まず、バックログ並走で対応する方針。

### Phase 5 の候補 axis

Phase 3/4 で積み上げた validator 群 + Skill 統合パターンを基盤に、以下の axis が Phase 5 候補:

| 候補 | 内容 | 前提 |
|---|---|---|
| sqlOrderValidator 観点 3/4/5 | UNIQUE_CHECK_MISSING / CASCADE_DELETE_OMITTED / TX_CIRCULAR_DEPENDENCY | 設計者承認済 #640/#641/#642 |
| ViewDefinition UI 編集 | ViewDefinitionListView / ViewDefinitionEditor + store 実装 | 本 Phase で schema/validator のみ先行 |
| 7 業界完全 paving | 子 1/3 の残 5 業界 paving | Phase 4 子 1/3 の paving 2 業界から拡張 |
| i18n / WAI-ARIA 整合 | 多言語化 / アクセシビリティ validator + Skill 統合 | 「現状不要」のため将来再評価 |

### Phase 5 起票の判断材料

- **推奨**: sqlOrderValidator 観点 3/4/5 (#640/#641/#642) を Phase 5 子 0a/0b/0c として組み込む (設計者承認済、Phase 4 と同パターンで着手障壁低い)
- **オプション**: ViewDefinition UI 編集を Phase 5 子として追加 (validator は完成済みで UI 先行が不要なため、スコープ次第)
- **保留**: i18n / WAI-ARIA は現時点で不要判断のため Phase 5 には含めない

## Phase 3 / Phase 4 検出方式の進化

### 検出機構の段階的拡張

| 観点 | Phase 3 完了時 | Phase 4 フォローアップ (#631/#632) | Phase 4 本体 (#649/#650/#651) |
|---|---|---|---|
| SQL カラム整合 | sqlColumnValidator | (維持) | (維持) |
| @conv.* 整合 | conventionsValidator | (維持) | (維持) |
| 識別子スコープ | identifierScope (+ WorkflowStep recurse 修正) | (維持) | (維持) |
| 参照整合 | referentialIntegrity | (維持) | (維持) |
| 画面項目 ↔ フロー キー集合整合 | screenItemFlowValidator | (維持) | (維持) |
| **画面項目 ↔ フロー 値レベル整合 (M2 反省)** | **対象外** | **screenItemFieldTypeValidator (6 観点)** | (維持) |
| **DB 制約 × INSERT 順序 (M1 反省)** | **対象外** | **sqlOrderValidator (観点 1+2)** | (維持) |
| **一覧 UI viewer 整合** | **対象外** | **対象外** | **viewDefinitionValidator (9 観点)** |
| **画面遷移三者整合** | **対象外** | **対象外** | **screenNavigationValidator (7 観点)** |
| **論理フィールド横断整合** | **対象外** | **対象外** | **screenItemRefKeyValidator (7 観点)** |

### Must-fix 検出経路 (Phase 4)

Phase 4 の 3 子 PR では独立 Sonnet サブエージェントレビューを実施。Must-fix 発見件数:

| PR | 業界 | Must-fix | 検出経路 |
|---|---|---|---|
| #656 (ViewDefinition) | retail + welfare-benefit | 0 件 | (Sonnet 独立レビュー pass) |
| #657 (screenNavigation) | 7 業界 | 0 件 | (Sonnet 独立レビュー pass) |
| #655 (screenItemRefKey) | finance + logistics | 0 件 | (Sonnet 独立レビュー pass) |

Phase 4 本体 3 子では **Must-fix ゼロ** を達成。Phase 3 フォローアップ #633 (#631/#627) では Sonnet 独立レビューで Must-fix 2 件 + Should-fix 1 件を検出、全解消済。

### Phase 4 での追加発見: 静的検査と動的検査の境界 (更新)

| 領域 | 静的検出 | 動的検出 |
|---|---|---|
| フロー単体整合 (TX / runIf / branch) | AI 目視 | testScenarios |
| 画面 ↔ フロー キー集合整合 | screenItemFlowValidator | testScenarios |
| 画面 ↔ フロー 値レベル整合 | screenItemFieldTypeValidator (Phase 4 フォローアップ) | testScenarios fixture バリエーション (#608) |
| DB 制約 × INSERT 順序 | sqlOrderValidator 観点 1+2 (MVP) | testScenarios |
| DB 制約 × INSERT 順序 (高度) | 観点 3/4/5 は設計者承認待ち (#640/#641/#642) | testScenarios |
| 一覧 UI viewer 整合 | viewDefinitionValidator (Phase 4 新設) | testScenarios |
| 画面遷移三者整合 | screenNavigationValidator (Phase 4 新設) | testScenarios |
| 論理フィールド横断整合 | screenItemRefKeyValidator (Phase 4 新設) | testScenarios |

## Phase 4 メタ #648 のクローズ条件評価

| 完了基準 | 状態 | 達成箇所 |
|---|---|---|
| 子 1 (#649) PR マージ | ✅ | PR #656 (2026-04-30) |
| 子 2 (#650) PR マージ | ✅ | PR #657 (2026-04-30) |
| 子 3 (#651) PR マージ | ✅ | PR #655 (2026-04-30) |
| Phase 4 統合評価レポート | ✅ | 本レポート |
| フォローアップ ISSUE 起票 | ✅ | #652/#653/#654 起票済、#640/#641/#642 は Phase 3→4 間で起票済 |
| Phase 5 移行判断 | ✅ | 本レポート §Phase 5 移行判断 |

**結論**: Phase 4 メタ #648 のクローズ条件を達成。本 PR マージ後に #648 をクローズ可能。

## Phase 4 セッション運用の知見 (副産物)

1. **順次進行の方が競合コストが低い** — 3 子並行 worktree は理論上高速だが、`validate-dogfood.ts` / `SKILL.md` の競合が多く、順次進行の合計コストより rebase コストが上回るケースがあった。Phase 5 からは順次実装を基本とする
2. **Sonnet の worktree 権限問題は事前に解決する** — SKILL.md / CLAUDE.md 等のプロジェクトルートファイルへのアクセスが worktree 内で拒否される場合、Opus が事前に読み取って briefing に転記するか、権限を明示的に付与する
3. **Phase フォローアップ ISSUE のリードタイムが短い** — Phase 3→4 フォローアップ (#633/#634/#635/#636/#637/#638/#639 等) が全て同日 (2026-04-30) マージされた。Phase のフォローアップが早期に解消されると Phase 4 本体着手がスムーズになるパターンが確認できた
4. **paving 2 業界戦略を継続評価** — 各 Phase で 2 業界先行 → 残別 ISSUE 化の戦略を継続。7 業界全 paving は 1 PR に盛り込まず、実証に適した 2 業界を選定して深く paving する方が品質・レビュー精度ともに高い

## 関連 PR / ISSUE

- 親メタ: #648 (Phase 4 — 本レポートでクローズ条件を満たす)
- 子 1: #649 / PR #656 (ViewDefinition 新設、viewDefinitionValidator 9 観点)
- 子 2: #650 / PR #657 (screenNavigationValidator 7 観点)
- 子 3: #651 / PR #655 (screenItemRefKeyValidator 7 観点)
- Phase 3→4 フォローアップ:
  - #631/#627 / PR #633 (screenItemFieldTypeValidator、Phase 3 M2 → 6 観点)
  - #632 / PR #647 (sqlOrderValidator MVP 観点 1+2)
  - #608 / PR #634 (testScenarios fixture バリエーション網羅指針、Rule 18)
  - #612 / PR #635 (@error ambient onRollback)
  - #610 / PR #636 (v3 TS 型同期)
  - #607/#617 / PR #615/#645 (validate-dogfood per-project)
  - #616 / PR #618 (retail subdir)
- 残バックログ: #640 / #641 / #642 (sqlOrderValidator 観点 3/4/5) / #652 / #653 / #654 (Nit 派生)
- 関連メタ (Phase 1–3): #458 / #478 / #486 / #500 / #493 / #611 — 全完了
- 評価レポート系列:
  - Phase 2: `docs/spec/phase2-evaluation-2026-04-30.md`
  - Phase 3: `docs/spec/phase3-evaluation-2026-04-30.md`
  - Phase 4: `docs/spec/phase4-evaluation-2026-04-30.md` (本レポート)
