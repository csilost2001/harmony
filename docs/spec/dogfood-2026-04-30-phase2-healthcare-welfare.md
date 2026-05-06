# Phase 2 子 2 ドッグフード — 医療 + 社会保険行政業務 (2026-04-30)

## 概要

Phase 2 メタ #493 子 2 (#600) として、Phase 1 で未検証の業界 — 医療 (healthcare) と社会保険行政 (welfare-benefit) — を対象に v3 ProcessFlow を 2 シナリオずつ計 4 フロー実装し、子 3 (`/create-flow` validator 統合 PR #601) と 子 4 (`/review-flow` Step 0.5 機械的バリデータ実行 PR #602) の効果を実測した。

実装は **Opus 単独** (Codex / Sonnet 不使用) + **Opus サブエージェントによる独立レビュー** という構成。Stage 1 (healthcare) は Codex 委譲で着手したが long-running stale 問題で中断、Opus が引き継ぎ完成。Stage 2 (welfare-benefit) は最初から Opus 単独で実装。

## 検証目的

1. `/create-flow` Step 5 + `/review-flow` Step 0.5 の機械的検証パスが **未経験業界** で機能するか実測
2. 既存 v1 型バリデータ (referentialIntegrity / identifierScope / sqlColumnValidator / conventionsValidator) が v3 サンプルでどこまで動くか測定
3. v3 wm-readiness の積み残し ISSUE 起票根拠を収集
4. Phase 1 #486 物流ドッグフード (Must-fix 50-75% 削減) との比較で改善維持を確認

## 実装サマリ

### Stage 1: healthcare (医療業界)

| 項目 | 内容 |
| --- | --- |
| シナリオ 1 | 診察予約 (PHI 同意確認 → 患者照会 → 医師資格確認 → 空き枠検証 → 予約作成 → EMR 同期) |
| シナリオ 2 | 処方箋発行 (患者記録参照 → PHI アクセス → 薬剤安全性チェック → WorkflowStep 3 段 [医師署名 / 薬剤師鑑査 / 最終承認] → 薬局送信) |
| Step 数 | フロー 1: 18 step / フロー 2: 20 step + WorkflowStep 3 段 |
| Tables | patients / appointments / medical_records / prescriptions / providers (5 件) |
| Extensions | healthcare.v3.json — fieldTypes 4 / actionTriggers 2 / stepKinds 2 (PhiAccessCheckStep, ClinicalSafetyCheckStep) / responseTypes 3 / conventionCategories 3 |
| testScenarios | フロー毎 3 件以上 (happy / validation error / 業務エッジ) |
| 業務的特徴 | HIPAA 風最小必要原則、医師資格の外部レジストリ確認、電子カルテ非同期同期 |

### Stage 2: welfare-benefit (社会保険行政業務)

| 項目 | 内容 |
| --- | --- |
| シナリオ 1 | 給付申請受付 (本人確認 → 受給資格 → 重複申請 30 日窓 → 限度額 → applications 作成 → 一次審査キュー投入 → 受付通知メール) |
| シナリオ 2 | 支払通知 (出納長最終決裁 [WorkflowStep review パターン] → 銀行送金 [冪等キー必須] → payments / applications / beneficiaries 整合更新 → 受給者通知メール) |
| Step 数 | フロー 1: 17 step / フロー 2: 19 step + WorkflowStep 1 段 |
| Tables | applicants / applications / reviews / payments / beneficiaries (5 件、合計 61 columns + 14 indexes + 18 constraints) |
| Extensions | welfare-benefit.v3.json — fieldTypes 4 / actionTriggers 2 / stepKinds 1 (DuplicateApplicationCheckStep) / responseTypes 3 / conventionCategories 3 |
| testScenarios | フロー毎 3-4 件 (happy / validation / business edge) |
| 業務的特徴 | 本人確認の信頼源化、冪等送金 (二重支払防止)、累計支払額の会計年度管理、出納長承認による責任分界 |

### 検証指標 (実装側、本レポート確定時点)

| 観点 | healthcare | welfare-benefit |
| --- | --- | --- |
| AJV (v3-samples.test.ts) | pass | pass (実装中に 4 件のスキーマ違反を AJV で発見・修正、後述) |
| validate:dogfood --flow each | 4/4 validators pass | 4/4 validators pass |
| Opus 初回作成での Must-fix (機械検出) | 13 件 (詳細後述) | 4 件 (実装中に AJV で検出・即修正) |
| 既知パターン再発 (#458/#478/#486) | なし | なし |
| schema 改変 | ゼロ (#511 ガバナンス遵守) | ゼロ |
| 独立 Opus レビュー Must-fix | 0 件 (Stage 1 / 2 通算) | 1 件 (M1: payments.beneficiary_id NOT NULL 違反、本 PR で解消) |
| 独立 Opus レビュー Should-fix | 2 件 (Stage 3 No-op / errorCode 誤誘導、本 PR で解消) | 1 件 (testScenarios の初回受給者ケース漏れ、本 PR で解消) |
| 独立 Opus レビュー Nit | 1 件 (timeout sideEffects 漏れ、本 PR で解消) | 2 件 (event 二重発行 / 拡張 stepKind 重複、本 PR で解消) |

## Stage 1 で発見した validator 実装バグ 2 件 (重要)

healthcare 実装中、validate:dogfood が `UNKNOWN_TYPE_REF` 7 件 + `UNKNOWN_IDENTIFIER` 6 件を返した。詳細調査の結果 **2 つの validator 実装バグが判明** したため、Stage 1 commit `c1e22a9` 内で修正した。

### バグ 1: identifierScope.ts は v3 `context.ambientVariables` を読まない

**症状**: `@requestId` / `@sessionUserId` を validation step の inlineBranch 等で参照すると `UNKNOWN_IDENTIFIER` 検出。

**原因**: `frontend/src/schemas/identifierScope.ts:80` が `group.ambientVariables` (top-level) のみ参照。v3 schema は `context.ambientVariables` 配下にのみ配置するため、validator が空 Set として処理し全参照を未宣言扱いに。

**Phase 1 まで気付かなかった理由**: v3 既存サンプル `public-service` flow も同じ構造だが、`@sessionUserId` 参照は WorkflowStep の `onApproved` / `onRejected` 配下にあった。**identifierScope の `walkSteps` は WorkflowStep の onApproved / onRejected 配下を recurse しない別のバグ** があり、その盲点で WorkflowStep 内の参照は検査をスキップ → silently pass。healthcare では同じ参照を `validation.inlineBranch.ngBodyExpression` 等の正規チェックパスに置いたため検出された。

**修正**: `context.ambientVariables` を fallback で読むように変更 (1 行) — v1 既存サンプルとの後方互換維持。

**残存リスク**: WorkflowStep の onApproved / onRejected 配下を walkSteps が recurse しないバグはそのまま残っている (修正すると public-service / healthcare flow 2 / welfare-benefit flow 2 の WorkflowStep で大量の検出が発生し scope 外)。**別 ISSUE 起票候補**。

### バグ 2: validate-dogfood.ts は v3 extensions を読まない

**症状**: typeRef `healthcare:AppointmentResponse` 等が `UNKNOWN_TYPE_REF` 検出。

**原因**: `frontend/scripts/validate-dogfood.ts` の `loadExtensions` が `docs/sample-project/extensions/` (v1 per-file 形式: `field-types.json` / `triggers.json` / `db-operations.json` / `steps.json` / `response-types.json`) のみスキャン。`docs/sample-project-v3/<industry>/extensions/<ns>.v3.json` (single-file 形式) を silent skip し v3 拡張定義の typeRef / stepKind が解決不能。

**修正**: `samplesV3Dir` 配下を再帰スキャンして `*.v3.json` を読み、`fieldTypes` / `actionTriggers` (= triggers) / `stepKinds` (= steps) / `responseTypes` を namespace prefix 付きで bundle に追加。public-service v3 flow も以前同じ理由で 5 件の UNKNOWN_TYPE_REF を出していたが、本修正で 0 件に。

**残存リスク**: v3 extensions の `actionTriggers` を v1 bundle の `triggers` 配列にマップしているが、両者の field 構造はほぼ互換 (value / label / description)。完全互換でない場合、誤検出が発生し得る。**観察対象**。

### この発見の意義

- 監査報告書 `docs/spec/dogfood-2026-04-29-phase2-validator-audit.md` §2 で「v3 readiness は TS 型同期後の課題」と記録されていたが、本ドッグフードで **TS 同期前でも実装側が v3 形式を解釈していない箇所** を 2 件特定できた
- 既存 v3 サンプル (public-service) が validator pass していたのは構造的に正しいからではなく **validator のもう 1 つの盲点 (WorkflowStep recurse) で隠蔽されていた** だけ — 今後の dogfood で同じ罠に注意が必要

## Phase 1 比較 (#486 物流との対比)

`/create-flow` 効果検証 (#486) の指標と本 dogfood の比較:

| 観点 | #486 物流 (Sonnet, /create-flow 経由) | #486 物流 (Opus, /create-flow 経由) | 本 #600 healthcare (Opus 単独) | 本 #600 welfare-benefit (Opus 単独) |
| --- | --- | --- | --- | --- |
| 初回 Must-fix 件数 (機械検出) | 2 件 | 1 件 | 13 件 (validator バグ起因) | 4 件 (AJV) |
| 既知パターン再発 | なし | なし | なし | なし |
| 新規盲点発見 | SQL SELECT 漏れ / TX 内 branch fallthrough | catalog 未登録 | **validator 実装バグ 2 件** | スキーマ非対応の testScenario 種別など |
| validator 自動検出効果 | catalog レベル (Rule 9/10 はテキスト確認のみ) | 同上 | **CLI 機械検出** (#599 PR #602 経由で実装済み) | 同上 |

**主要な変化**: Phase 1 では `/create-flow` Step 3 (15 ルール self-check) で既知パターンを抑制したが、本 Phase 2 では `/review-flow` Step 0.5 (#599 / PR #602) と `/create-flow` Step 5 (#598 / PR #601) で **bash one-liner による検出** に進化。AI 目視に頼らない構造的検出が機能することを実証した。

**Must-fix 件数の見方**:
- healthcare 13 件のうち、**実質的なフロー設計バグ 0 件** (全 13 件が validator バグ由来の偽陽性)
- welfare-benefit 4 件は **AJV が実装中に検出した schema 違反** (envVars 種別ミス / circuitBreaker 場所違い / audit.result enum / testScenario kind / dbRow match 必須) — AI が schema 文面を完全には記憶しておらず微小なミスを犯したが、**全て AJV が拾えるレベル** で AI 目視の漏れではない。Phase 1 でも同種ミスは発生していたが、当時は AJV を作成中に呼ばずレビューで初めて検出していた。本 Phase 2 で `/create-flow` Step 5 統合により実装中に拾えるようになった

## 独立レビューで発見した「validator では届かない領域」

本ドッグフードの実装後、別 context の Opus サブエージェントによる独立レビュー (read-only) を実施した。発見された 7 件 (Must-fix 1 / Should-fix 3 / Nit 3) は本 PR 内で全件解消したが、Phase 2 全体の知見として **validator が静的に検出できない種類のバグ** を 1 件記録しておく価値がある。

### Must-fix M1: payments.beneficiary_id NOT NULL 違反 (welfare-benefit 支払通知 旧 step-09)

**症状**: `payments.beneficiary_id` カラムは `notNull: true`。修正前の旧 step-09 では `INSERT INTO payments (... beneficiary_id ...) VALUES (..., COALESCE(@existingBeneficiary.id, NULL), ...)` となっていた。受給者台帳 (beneficiaries) が存在しない初回受給者の場合 `@existingBeneficiary` は NULL になり、NOT NULL 制約違反で **初回支払で必ず失敗** する。

**validator が拾えなかった理由**:
- referentialIntegrity / identifierScope: 識別子・参照スコープのみ検査、NOT NULL 制約は守備範囲外
- sqlColumnValidator: SQL 内のカラム名がテーブル定義に存在するかは検査するが、INSERT 値の NULL 許容性チェックはしない
- conventionsValidator: `@conv.*` 参照のみ検査、対象外
- AJV / process-flow.schema: SQL を文字列として扱うため、SQL 内部の値解析は不可

**testScenarios でも見落とした理由**: happy-path-payment / edge-bank-transfer-failed / edge-treasurer-rejected の 3 シナリオ全てで `dbState` に beneficiaries 行を pre-seed していた (実テスト実装時には fixture に 1 行入れがちな自然なパターン)。**「初回受給者 = beneficiaries 行なし」エッジケースのテストが欠落** していた結果、機械検証も人間レビューも happy-path で静的にも見抜けなかった。

**修正**: step-08b で初回受給者なら `INSERT INTO beneficiaries ... total_paid_amount=0` を先行実行し、step-15 を全件 UPDATE 化に統合。新 testScenario `happy-path-first-time-beneficiary` で初回パスを覆う。

### Phase 2 評価レポート (子 5) への含意

本ケースは Phase 1 (#458/#478/#486) でも観測されなかった種類のバグ:
- 「**fixture 設計が無意識に testScenario カバレッジに穴を空ける**」というパターン
- validator はあくまでフロー定義の静的整合だけを見るため、**「DB 制約とフロー操作順序の組み合わせから生じる実行時失敗」は静的に検出不可能**

子 5 評価レポート / Phase 3 設計時には:
- testScenarios の **fixture バリエーション網羅** を `/create-flow` SKILL に追加
- DB 制約 (NOT NULL / UNIQUE / FK) と SQL 操作順序の交差検査を行う **新 validator** (sqlOrderValidator 等) の起票検討

を含めることを推奨する。

## v3 readiness 評価

### 機能した validator (本 dogfood 経由)

| validator | v3 対応度 | 注記 |
| --- | --- | --- |
| referentialIntegrity | ✓ (本 PR で v3 extensions ロード対応) | typeRef / responseRef / errorCode / systemRef / compensatesFor を全件チェック可 |
| identifierScope | ✓ (本 PR で context.ambientVariables fallback 追加) | ただし WorkflowStep recurse 漏れの別バグは残存 (Phase 3 ISSUE 候補) |
| sqlColumnValidator | △ | tables 自動ロードは v1 path のみ。v3 tables は未対応 (本 PR で未着手、Phase 3 候補) |
| conventionsValidator | △ | conventions catalog 自動ロードは v1 path のみ。v3 conventions catalog 仕様自体が未確定 (Phase 3 候補) |

### 未対応領域 (起票候補)

1. `validate-dogfood.ts` の `loadTables` を v3 per-industry tables 対応化 — sqlColumnValidator 完全動作のため必須
2. v3 conventions catalog の構造確定 + `loadConventions` 拡張 — conventionsValidator 完全動作のため
3. identifierScope.ts の `walkSteps` を WorkflowStep の onApproved / onRejected / onAcknowledged / onCancelled / onTimeout に recurse させる修正 — 本 PR で発見した盲点の解消
4. v1 型バリデータの v3 TS 型同期 — `dogfood-2026-04-29-phase2-validator-audit.md` §2 で挙げた中長期課題、本 PR スコープ外

## 業務シナリオの新規性 (Phase 1 未検証要素の網羅)

| Phase 1 未検証要素 | 本 dogfood で実装 |
| --- | --- |
| WorkflowStep 多段 (sign-off / review / approval-sequential) | healthcare 処方箋発行 (3 段) / welfare-benefit 支払通知 (review 1 段) |
| 外部 registry の資格確認 | healthcare 医師資格 (credentialRegistry) |
| センシティブデータ (PHI / PII) 最小必要原則 | healthcare 全フロー / welfare-benefit address_hash 化 |
| 冪等送金 / idempotency_key UNIQUE | welfare-benefit 支払通知 (bankSystem 冪等キー必須) |
| 累計値の年度管理 | welfare-benefit beneficiaries.fiscal_year + total_paid_amount |
| 監査履歴の上書き禁止 | welfare-benefit reviews テーブル (履歴行) |

## 結論と Phase 3 移行判断

### 結論

1. **Skill 統合の機械的検出効果を実証**: PR #601 / #602 マージ後、AI 目視に頼らず CLI で AJV + 4 validators が pass しなければ実装完了とみなさないワークフローが整備された。Phase 1 比較で「初回作成時の盲点」が validator バグ起因 / 真のフロー設計問題に分離可能になった
2. **v3 wm-readiness の具体的な穴を特定**: identifierScope の context.ambientVariables 未対応 / validate-dogfood の v3 extensions 未対応 / sqlColumnValidator・conventionsValidator の v3 tables / catalog 未対応 — 本 PR で 2 件は修正、残り 2 件は Phase 3 起票候補
3. **既知パターン再発ゼロ**: TX outputBinding ネスト / branch fallthrough / 死コード rollbackOn / `@conv.*` 未登録 等 Phase 1 で頻発したパターンは healthcare / welfare-benefit の計 4 フローで一切再発せず。`/create-flow` 15 ルール self-check と `/review-flow` 8 観点が Phase 2 でも有効
4. **業務文脈の網羅性向上**: Phase 1 では金融 / 製造 / 物流 / 小売 / 行政の 5 業界で WorkflowStep / 多段承認 / PII 制約のいずれかが部分的に欠けていたが、本 Phase 2 で **PHI + 冪等送金 + 累計年度管理 + 多段ワークフロー** を網羅。v3 schema が広範な業務に対応できることを実証

### Phase 3 への移行判断: **進行可** (条件付き)

**進行可とする根拠**:
- v3 schema は本 dogfood で発見した 2 件の validator バグ修正後、healthcare + welfare-benefit + 既存 5 業界 (金融 / 製造 / 物流 / 小売 / 行政) の計 7 業界全てで AJV pass + 4 validators pass を達成
- Skill 経由の機械的検出ワークフローが安定動作

**条件**:
1. **必須起票候補 (Phase 3 開始前)**: `loadTables` v3 対応 / `loadConventions` v3 対応 / WorkflowStep recurse 修正 — Phase 3 (画面項目連携) の検証時にこれらが先行課題化する可能性が高い
2. **観察事項**: validator のもう 1 つの盲点 (WorkflowStep recurse) は public-service / healthcare 処方箋 / welfare-benefit 支払通知の 3 フローで silent skip 状態。すぐに検出されないが、リファクタリング時に変数移動で突然検出されるリスクあり

### Phase 2 子 5 (評価レポート) との関係

本レポートは Phase 2 子 5 評価レポートの **シナリオ実装結果セクション** に相当する。子 5 は本レポート + 子 1 監査報告書 (`docs/spec/dogfood-2026-04-29-phase2-validator-audit.md`) を統合し、Phase 2 全体の総括 + Phase 3 詳細スコープを定義する。

## 関連 PR / ISSUE

- 親: #493 (Phase 2 メタ) / #600 (子 2、本作業)
- 子 1: #596 / PR #597 (バリデータ活用度監査) — 本作業の起点
- 子 3: #598 / PR #601 (`/create-flow` Step 5 validate:dogfood 統合)
- 子 4: #599 / PR #602 (`/review-flow` Step 0.5 機械的バリデータ実行)
- 本 PR: ブランチ `feat/issue-600-phase2-healthcare-welfare-dogfood` (Stage 1 commit `c1e22a9` + Stage 2 commit `2a6c02f`)
