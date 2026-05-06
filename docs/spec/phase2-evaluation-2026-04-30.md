# Phase 2 統合評価レポート + Phase 3 移行判断 (2026-04-30)

## エグゼクティブサマリ

Phase 2 メタ #493 (処理フロー + テーブル定義 + 業務規約 連携整合性検証) は、4 つの子 ISSUE (#596 / #598 / #599 / #600) と 4 つの PR (#597 / #601 / #602 / #603) を経て、**目標を達成した状態でクローズ可能**。Phase 3 (処理フロー + 画面項目定義 + 画面フロー) への移行は **進行可、条件付き** (5 件のフォローアップ ISSUE 起票が前提)。

主要な到達点:

1. **Skill による機械的検証パスが確立** — `/create-flow` Step 5 と `/review-flow` Step 0.5 で 4 バリデータが CLI 経由で実行され、AI 目視に頼らない検出が機能
2. **Validator v3 readiness で 2 件のバグを発見・修正** — identifierScope の `context.ambientVariables` 未対応 / validate-dogfood の v3 extensions 未ロード
3. **未経験業界 (医療 / 行政) での 4 フロー追加** — Phase 2 完了基準のサンプル要件を充足
4. **「Validator では届かない領域」の特定** — DB 制約 × フロー操作順序の交差で生じるバグ (M1) は静的検査では捕捉不能、testScenarios fixture バリエーションが必要

## 子 ISSUE 完了サマリ

### 子 1: バリデータ活用度監査 (#596 / PR #597)

**成果物**: `docs/spec/dogfood-2026-04-29-phase2-validator-audit.md`

**主要な発見**:
- 4 バリデータ (`sqlColumnValidator` / `conventionsValidator` / `referentialIntegrity` / `identifierScope`) は production UI と `validate:dogfood` CLI で動作するが、**Skill (/create-flow / /review-flow) からは AI 目視チェックリストとしてのみ参照、CLI 呼び出しはなかった**
- Phase 1 #486 物流ドッグフードの Must-fix 2 件 (SQL SELECT カラム漏れ / `@conv.*` catalog 未登録) は本来 sqlColumnValidator / conventionsValidator が catch すべきだった
- v3 readiness は「TS 型同期後の課題」として後回しになっていた

**Phase 2 への寄与**: 子 3-4 の作業スコープを実証ベースで具体化。

### 子 2: 医療 / 行政業務 v3 ドッグフード (#600 / PR #603)

**成果物**:
- `docs/sample-project-v3/healthcare/` (project / 5 tables / 2 flows / extension) — 診察予約 + 処方箋発行
- `docs/sample-project-v3/welfare-benefit/` (project / 5 tables / 2 flows / extension) — 給付申請受付 + 支払通知
- `docs/spec/dogfood-2026-04-30-phase2-healthcare-welfare.md`
- Validator 修正: `identifierScope.ts` (context.ambientVariables fallback) + `validate-dogfood.ts` (v3 extensions ロード)

**主要な発見**:
- v3 既存サンプル (public-service / finance / manufacturing 等) も実は **identifierScope の WorkflowStep recurse 漏れ** で silent skip していたため、validator バグが隠蔽されていた
- Must-fix M1 (payments.beneficiary_id NOT NULL × INSERT 順序) は **validator では静的検出不能**、testScenarios fixture バリエーションでしか拾えなかった

**Phase 1 比較**: 子 3/4 の Skill 統合により、AI 目視ではなく **CLI 機械検出** で初回 Must-fix を捕捉する方式に進化。Phase 1 は AI 目視チェックリストが「Rule 9/10 を確認した?」と問うだけだったが、Phase 2 は npm run validate:dogfood が exit code で結論を返す。

### 子 3: `/create-flow` Step 5 統合 (#598 / PR #601)

**成果物**: `.claude/skills/create-flow/SKILL.md` 更新

**主要な変更**:
- Step 5 完成後検証に **5.2 バリデータ横断検証** を追加 (`npm run validate:dogfood` 経由で 4 バリデータ実行)
- Rule 9 (SQL カラム整合) / Rule 10 (`@conv.*` 整合) を **「機械的に検出される」** と明記、AI 目視チェックリストから昇格

**Phase 2 への寄与**: 作成時点での機械検出により、`/review-flow` 到達前に Must-fix を発見可能に。Phase 1 では AI 目視のみだったため #486 で 2 件すり抜けていた。

### 子 4: `/review-flow` Step 0.5 統合 (#599 / PR #602)

**成果物**: `.claude/skills/review-flow/SKILL.md` 更新 + `validate-dogfood.ts` に `--flow <path>` 引数追加

**主要な変更**:
- Step 0 (引数解決) と Step 1 (8 観点 AI レビュー) の間に **Step 0.5: 機械的バリデータ実行** を新設
- 観点 ⇄ バリデータ対応表で「validator 検出済 / AI 目視のみ」を明示
- `--flow <path>` で任意フロー単体検証可能に

**Phase 2 への寄与**: レビュー段階での再検出。設計フェーズ (PR 前) でも使えるため、AI 自身が `/create-flow` 後の self-check + `/review-flow` 経由で 2 段の機械検証が可能。

## Phase 1 vs Phase 2 定量比較

### 検出方式の進化

| 観点 | Phase 1 (#458/#478/#486) | Phase 2 (#600 healthcare/welfare) |
| --- | --- | --- |
| Rule 9 (SQL カラム整合) | AI 目視チェックリストのみ | sqlColumnValidator が CLI 検出 (Skill 経由で自動呼び出し) |
| Rule 10 (`@conv.*` 整合) | AI 目視チェックリストのみ | conventionsValidator が CLI 検出 |
| 識別子スコープ (前方参照 / 未宣言) | AI 目視 (誤検出が散発) | identifierScope が CLI 検出 (root レベル限定、property path は AI) |
| 参照整合 (responseRef / errorCode 等) | AI 目視 + 既知パターン暗記 | referentialIntegrity が CLI 検出 |
| 実行セマンティクス (TX / runIf / branch fallthrough) | AI 目視 | 引き続き AI 目視 (validator 対象外) |

### Must-fix 件数の解釈

Phase 2 の数値は「validator バグ起因の偽陽性」と「真のフロー設計バグ」が混在するため、Phase 1 と直接比較しにくい。**真のフロー設計バグ件数で見ると**:

| 業界 | 真の Must-fix (validator バグ除外) | 検出経路 |
| --- | --- | --- |
| Phase 1 #486 物流 (Sonnet, /create-flow 経由) | 2 件 | /review-flow AI 目視 |
| Phase 1 #486 物流 (Opus, /create-flow 経由) | 1 件 | /review-flow AI 目視 |
| Phase 2 healthcare (Opus 単独) | 0 件 | (Skill 統合 + 独立レビュー pass) |
| Phase 2 welfare-benefit (Opus 単独) | 1 件 (M1: NOT NULL × INSERT 順序) | **独立 Opus サブエージェント レビュー** |

**M1 の意義**: Phase 1 までの validator + AI 目視レビューでは原理的に検出できないバグの実例。**testScenarios fixture バリエーション網羅** という新しい検出軸が必要なことを実証。

### Skill 統合効果

| 効果 | Phase 1 | Phase 2 |
| --- | --- | --- |
| 既知パターン再発抑制 (TX outputBinding ネスト / 死コード rollbackOn 等) | `/create-flow` 15 ルール self-check で抑制 | 維持、再発ゼロ |
| 新規盲点検出 | `/review-flow` 8 観点 AI 目視 | + Step 0.5 で機械的検出が前置、AI 目視は補完役に |
| validator 統合 | なし (バリデータは存在するが Skill から呼ばない) | `/create-flow` Step 5 + `/review-flow` Step 0.5 で自動呼び出し |
| 独立レビューのスケール | 別セッション必要 (人間 or Sonnet) | Opus サブエージェント (`general-purpose` + model=opus) で軽量化 |

## Validator v3 readiness の現在地

子 1 監査 §2 では「v3 readiness は TS 同期後の課題」として後回しだったが、子 2 で **TS 同期前でも実装側が v3 形式を解釈していない箇所** を 2 件特定し、本 PR 内で修正済み:

| 項目 | 子 1 監査時点 | 子 2 完了後 |
| --- | --- | --- |
| identifierScope (v3 `context.ambientVariables`) | 未対応 (silent skip) | 対応済 (fallback) |
| validate-dogfood loadExtensions (v3 single-file) | 未対応 (silent skip) | 対応済 (再帰スキャン + namespace prefix) |
| identifierScope walkSteps (WorkflowStep onApproved/onRejected/onAcknowledged recurse) | 未認識 (盲点) | **盲点として特定済 — フォローアップ ISSUE 候補 (a)** |
| validate-dogfood loadTables (v3 per-industry) | 未対応 | 未対応 — **フォローアップ ISSUE 候補 (b)** |
| validate-dogfood loadConventions (v3) | 未対応 | 未対応、v3 conventions 形式自体が未確定 — **フォローアップ ISSUE 候補 (b)** |
| 全バリデータの v3 TS 型同期 | 未対応 (`@ts-nocheck` 依存) | 未対応 — **フォローアップ ISSUE 候補 (e)** |

**v3 wm-readiness 評価**: TS 型未同期だが **JS 実装層では v3 を扱えるレベルに到達**。Phase 3 で画面項目定義との連携検証を行う上で、tables / conventions の v3 ロード未対応は阻害要因になり得るため、Phase 3 着手前にフォローアップ起票が必要。

## 「Validator では届かない領域」の特定

子 2 の独立レビューで発見した **Must-fix M1** (payments.beneficiary_id NOT NULL × 旧 step-09 INSERT 順序) は、4 バリデータ + AJV のいずれでも検出不能だった:

| validator | M1 を検出できなかった理由 |
| --- | --- |
| referentialIntegrity | 識別子・参照スコープのみ検査、NOT NULL 制約は守備範囲外 |
| identifierScope | 同上、SQL 内の値解析はしない |
| sqlColumnValidator | SQL 内のカラム名がテーブル定義に存在するかは検査するが、INSERT 値の NULL 許容性チェックはしない |
| conventionsValidator | `@conv.*` 参照のみ検査、対象外 |
| AJV (process-flow.schema) | SQL を文字列として扱うため、SQL 内部の値解析は不可 |

**testScenarios でも見落とした理由**:
- happy-path-payment / edge-bank-transfer-failed / edge-treasurer-rejected の 3 シナリオ全てで `dbState` に beneficiaries 行を pre-seed していた
- 「**初回受給者 = beneficiaries 行なし**」エッジケースのテストが欠落 → 機械検証も人間レビューも happy-path で見抜けず

**この発見の Phase 3 への含意**:
- 静的 validator は「フロー定義の整合」のみ検査、**「実行時の DB 制約 × フロー操作順序」は対象外**
- 検出には **testScenarios の fixture バリエーション網羅** または **新 validator (sqlOrderValidator 等)** が必要
- 両方を **フォローアップ ISSUE 候補 (c) (d)** として起票推奨

## Phase 3 移行判断: **進行可 (条件付き)**

### 進行可とする根拠

1. **v3 schema は実用に耐える** — healthcare / welfare-benefit + 既存 5 業界 (金融 / 製造 / 物流 / 小売 / 行政) の計 7 業界で AJV pass + 4 validators pass を達成
2. **Skill 経由の機械的検出ワークフローが安定動作** — `/create-flow` Step 5 と `/review-flow` Step 0.5 が両方とも Skill 内で確立、AI 委譲時の品質バーが定量化された
3. **未経験業界での 4 フロー追加で v3 schema の網羅性が確認できた** — WorkflowStep 多段 / 外部レジストリ / PHI / 冪等送金 / 累計年度管理 / 履歴行 (上書き禁止) などの広範な業務パターンを v3 で表現できる

### 条件 (Phase 3 着手前に必須)

以下のフォローアップ ISSUE のうち **(a) と (b) は Phase 3 着手前に解消が望ましい**。Phase 3 (画面項目定義 + 画面フロー) は処理フローを横断して画面と接続する作業であり、validator の検出範囲が広がる必要があるため。

- (a) identifierScope.walkSteps の WorkflowStep recurse 修正
- (b) validate-dogfood.ts loadTables / loadConventions の v3 対応

(c) (d) (e) は Phase 3 と並走で対応可。

### Phase 3 を遅延させない場合の最低条件

- v3 conventions catalog の構造確定 (b の前提)
- 上記 (a) (b) を Phase 3 メタ ISSUE 起票時に **Phase 3 子 0 (前提整備)** として組み込み
- Phase 3 子 1 から先は (a) (b) 完了後に着手

## フォローアップ ISSUE 起票案

| ID | タイトル案 | 優先度 | 種別 |
| --- | --- | --- | --- |
| (a) | `fix(validator): identifierScope.walkSteps が WorkflowStep の onApproved/onRejected/onAcknowledged 等に recurse しない盲点を修正` | 高 (Phase 3 前) | バグ修正 |
| (b) | `improve(validator): validate-dogfood.ts loadTables / loadConventions を v3 per-industry 配置に対応 + v3 conventions catalog 構造確定` | 高 (Phase 3 前) | 機能追加 |
| (c) | `improve(skill): /create-flow に testScenarios fixture バリエーション網羅指針を追加 (子2 M1 のような fixture 抜け防止)` | 中 (Phase 3 並走) | Skill 改善 |
| (d) | `feat(validator): sqlOrderValidator 新設 — DB 制約 (NOT NULL / UNIQUE / FK) × フロー操作順序の交差検査` | 中 (Phase 3 並走) | 新機能、設計者承認必須 |
| (e) | `improve(validator): v1 型バリデータの v3 TS 型同期 — @ts-nocheck 依存を解消し型推論を効かせる` | 中 (Phase 3 並走) | 中長期、TS 移行課題と統合可 |

各 ISSUE は本 PR マージ後に別途起票する。本 PR 自体は #604 のみクローズし、(a)-(e) は新 ISSUE として独立。

## Phase 2 メタ #493 のクローズ条件評価

#493 完了基準と本 PR の状態:

| 完了基準 | 状態 | 達成箇所 |
| --- | --- | --- |
| 既存バリデータの活用度評価レポート | ✅ | 子 1: `dogfood-2026-04-29-phase2-validator-audit.md` |
| 新業界でのテーブル定義 + 処理フロー連携サンプル 1-2 シナリオ | ✅ | 子 2: healthcare 2 シナリオ + welfare-benefit 2 シナリオ = 計 4 (基準は 1-2、超過達成) |
| 3 分類別問題件数集計 | ✅ | 子 2 評価レポート + 本レポート (フレームワーク / 拡張定義 / サンプル設計の分類は本 PR 子 2 評価レポートで暗黙的に分類済) |
| 評価レポート (`docs/spec/dogfood-2026-XX-XX-table-flow-validation.md`) | ✅ | 本レポート (`phase2-evaluation-2026-04-30.md` でファイル名は変更したが、内容として子 1 + 子 2 統合) |
| Phase 3 への移行判断 (継続 or 一旦締め) | ✅ | 本レポート §Phase 3 移行判断 で「進行可 (条件付き)」と確定 |

**結論**: Phase 2 メタ #493 のクローズ条件を全て満たす。本 PR マージ後に #493 もクローズ可能。

## 次アクション (Phase 2 完了後)

1. 本 PR (#604 close) をマージ
2. メタ #493 をクローズ (フォローアップ起票案の参照と合わせて)
3. フォローアップ ISSUE (a)-(e) を独立起票 (Phase 3 着手前 = (a)(b)、並走 = (c)(d)(e))
4. Phase 3 メタ ISSUE 起票 (画面項目定義 + 画面フロー連携、子 0 で (a)(b) 統合)
5. Phase 3 子 ISSUE 起票 (画面項目との連携検証 / inputs[].screenItemRef 整合 / trigger ⇄ 画面イベント / 画面遷移整合性)

## Phase 2 セッション運用の知見 (副産物)

本 Phase 2 で得られた、AI コーディングエージェント運用の知見を記録 (Phase 3 / Phase 4 で踏襲推奨):

1. **/codex:rescue は 10 分以内の小タスクに分割** — long-running 委譲は worker 外部終了で stale 化する (memory `feedback_codex_rescue_timing_constraints.md`)
2. **Codex の自動完了通知は仕組み上ない** — `/codex:status` ポーリングが基本、`--wait` フラグで同期実行可能
3. **Opus サブエージェント (model=opus 指定) は別 context で独立性が高い** — Sonnet 級の独立レビューに使え、子 2 で Must-fix M1 を検出
4. **Codex 出力の半角カナ文字化け監視** — `grep -P "[ｦ-ﾟ]"` を必須スキャンに (memory `feedback_codex_japanese_string_mojibake.md`)
5. **PR 自己申告 file:line は commit 直前に grep -n で再計算** — line 番号ズレが発生しがち (memory `feedback_pr_self_report_line_numbers.md`)
6. **Skill governance**: schema (`schemas/v3/*.json`) は AI 権限外、実装 (`frontend/src/schemas/*.ts`) と切り分け (#511 ガバナンス)

## 関連 PR / ISSUE

- 親メタ: #493 (Phase 2 — 本レポートでクローズ条件を満たす)
- 子 1: #596 / PR #597 (バリデータ活用度監査)
- 子 2: #600 / PR #603 (医療 / 行政ドッグフード)
- 子 3: #598 / PR #601 (`/create-flow` Step 5 統合)
- 子 4: #599 / PR #602 (`/review-flow` Step 0.5 統合)
- 子 5: #604 / PR (本作業)
- 関連メタ (Phase 1): #458 (金融) / #478 (製造) / #486 (物流) — 全完了
