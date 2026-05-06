# Phase 3 統合評価レポート + Phase 4 移行判断 (2026-04-30)

## エグゼクティブサマリ

Phase 3 メタ #611 (処理フロー + 画面項目定義 + 画面フロー 連携整合性検証) は、5 つの子 ISSUE (子 0a/0b/1/3/4) と 1 つの吸収 ISSUE (#614) + 関連 ISSUE (#616 / #624) を経て、**目標を達成した状態でクローズ可能**。Phase 4 への移行は **進行可、5 件のフォローアップ ISSUE 起票 / 進行管理が前提** (Phase 2 と同パターン)。

主要な到達点:

1. **画面項目イベント ↔ 処理フロー連携 validator (5 番目) を新設、Skill 統合済** — `screenItemFlowValidator` が `/create-flow` Step 5.2 + `/review-flow` Step 0.5 で機械実行され、6 issue code を CLI 検出
2. **healthcare + welfare-benefit で実プロジェクト実証** — 4 画面新設、双方向参照が成立、validator は 6 issue code 全件 0 件検出 (=実害なし) を達成
3. **「Validator では届かない領域」の Phase 3 版を特定** — argumentMapping の **キー集合は検出するが値の意味的整合 (enum 値マッピング等) は検出不能**。独立レビュー (Sonnet) で M2 1 件発見
4. **子 2 (trigger / 画面遷移 validator) は起票不要と最終判断** — 子 1 が trigger ⇄ 画面イベント連携を吸収済。残る画面遷移 (forwardScreen / navigateTo) は Phase 4 候補へ移管

## 子 ISSUE 完了サマリ

### 子 0a: identifierScope.walkSteps WorkflowStep recurse 修正 (#606 / PR #613)

**成果物**: `frontend/src/schemas/identifierScope.ts` 修正

**主要な変更**:
- WorkflowStep の `onApproved` / `onRejected` / `onAcknowledged` ハンドラに識別子スコープ検査が recurse しなかった盲点を修正
- 既存サンプルでバグ顕在化なし (silent skip 状態だった)

**Phase 2 評価レポート §フォローアップ ISSUE 起票案 (a)** で予告されていた前提整備、Phase 3 着手前条件を満たす。

### 子 0b: validate-dogfood per-project 化 + サンプル構造 spec 確立 (#607 / PR #615)

**成果物**:
- `frontend/scripts/validate-dogfood.ts` per-project ロード対応
- `docs/spec/sample-project-structure.md` 新設 (1 プロジェクト = 1 完結成果物セットの規約)
- v3 conventions catalog 構造確定 (per-project 配置)

**主要な変更**:
- `loadTables` / `loadConventions` を `docs/sample-project-v3/<project>/` 単位で動作するよう変更
- 7 業界それぞれに `conventions-catalog.v3.json` (空配置) + `tables/` を per-project で配置可能に

**Phase 2 評価レポート §フォローアップ ISSUE 起票案 (b)** で予告されていた前提整備、Phase 3 着手前条件を満たす。

### 過渡期解消 #616 (PR #618)

**成果物**: `docs/sample-project-v3/retail/` への subdirectory 移動 + v3-root 過渡期 fallback 削除

**主要な変更**:
- 子 0b で確立した per-project 構造に retail を準拠させ、過渡期 fallback コードを削除
- 7 業界全てが per-project 構造で揃う

### 前提: schema 拡張 #624 (PR #625)

**成果物**: `schemas/v3/screen-item.v3.schema.json` + `schemas/v3/process-flow.v3.schema.json` 拡張

**主要な変更**:
- `ScreenItem.events[]` 追加 (各 event は `id` / `handlerFlowId` / `argumentMapping`)
- `ProcessFlow.meta.primaryInvoker` 追加 (`{kind: "screen-item-event", screenId, itemId, eventId}` 形式、現状 1 variant の oneOf)

**設計判断履歴**: backward reference (画面側 → フロー側、フロー数を中心とした M:1) を採用。primaryInvoker は副次呼び出しではなく **主要起動元** のメタ情報、designer 編集時の補完精度向上が目的で実行時には未参照 (description 明記)。

### 子 1: screenItemFlowValidator 新設 (#619 / PR #626)

**成果物**:
- `frontend/src/schemas/screenItemFlowValidator.ts` (新規、6 issue code)
- `frontend/src/schemas/screenItemFlowValidator.test.ts` (12 ケース)
- `frontend/scripts/validate-dogfood.ts` 統合 (5 番目 validator として project-level 検査)

**6 issue code**:

| code | severity | 検出内容 |
|---|---|---|
| `UNKNOWN_HANDLER_FLOW` | error | ScreenItem.events[].handlerFlowId が指す ProcessFlow が同プロジェクト内に存在しない |
| `MISSING_REQUIRED_ARGUMENT` | error | ProcessFlow の required input が argumentMapping で渡されていない |
| `EXTRA_ARGUMENT` | error | argumentMapping のキーが ProcessFlow inputs[] に存在しない |
| `PRIMARY_INVOKER_MISMATCH` | error | meta.primaryInvoker が指す ScreenItem.events[].handlerFlowId と本フロー id が不一致 (双方向整合) |
| `DUPLICATE_EVENT_ID` | error | 画面項目内で events[].id が重複 (JSON Schema では表現不可、validator で担保) |
| `INCONSISTENT_ARGUMENT_CONTRACT` | warning | 1 ProcessFlow を複数イベントから呼ぶ場合の argumentMapping キー集合が不揃い |

**Phase 3 への寄与**: 「フロー単体検査」から「フロー × 画面の境界検査」へ守備範囲を拡張。

### 子 3: Skill 統合 (#621 / PR #628)

**成果物**: `.claude/skills/create-flow/SKILL.md` + `.claude/skills/review-flow/SKILL.md` 更新

**主要な変更**:
- `/create-flow`: 8 観点 → 9 観点、15 ルール → 16 ルール、**Rule 16 (画面項目イベント連携整合)** 新設、Step 5.2 バリデータ表に screenItemFlowValidator 追加 (5 番目)
- `/review-flow`: 4 → 5 バリデータ、8 → 9 観点、Step 0.5 「何が動くか」表に追加、観点 ⇄ バリデータ対応表に観点 9 (画面項目イベント連携整合) を追加、Step 1 観点 9 を新規記述
- 役割分担: validator は機械検出、AI 目視は **「validator では届かない業務文脈の妥当性」** (argumentMapping 値の意味的整合 / primaryInvoker の業務上妥当性) に絞る

**Phase 2 確立パターンの踏襲**: Skill validator 統合パターンを 5 番目 validator に適用、新パターン導入なし。

### 子 4: ドッグフード + #614 統合 (#622 + #614 / PR #629)

**成果物**:
- `docs/sample-project-v3/healthcare/screens/*.json` (2 画面: 診察予約 + 処方箋発行)
- `docs/sample-project-v3/welfare-benefit/screens/*.json` (2 画面: 給付申請受付 + 支払通知)
- 4 処理フローに `meta.primaryInvoker` 追加
- 各 project.json の entities.screens エントリ追加
- 5 プロジェクトの `conventions-catalog.v3.json` エントリ補充 (#614 同時 close)

**validate:dogfood 結果**:

| 検証 | 子 4 着手前 | 子 4 完了後 |
|---|---|---|
| Summary | 11 / 18 flows passed | **17 / 18** flows passed |
| conventionsValidator | 24 件 | **0 件** |
| identifierScope | 3 件 (`@error` #612 範囲) | 3 件 (#612 範囲、本 Phase スコープ外) |
| screenItemFlowValidator | (新規) | **0 件 (全 6 issue code 検出なし)** |

**独立レビュー (Sonnet) で発見した実害バグ**:
- welfare-benefit/screens の `BenefitType` セレクト options.value (livelihood / housing / medical / education) が flow 側 `BenefitType` domain enum (child_allowance / livelihood_support / medical_expense_subsidy / disability_support) と完全不一致
- 実行時に enum バリデーションで全リクエストが reject される実害バグ
- screenItemFlowValidator は argumentMapping のキー集合のみ検査するため**非検出**
- → §「Validator では届かない領域」(Phase 3 版) の典型例として記録

## Phase 1 / Phase 2 / Phase 3 検出方式の進化

### 検出機構の段階的拡張

| 観点 | Phase 1 (#458/#478/#486) | Phase 2 (#600 healthcare/welfare) | Phase 3 (#622 healthcare/welfare 画面項目) |
|---|---|---|---|
| Rule 9 (SQL カラム整合) | AI 目視のみ | sqlColumnValidator が CLI 検出 | (Phase 2 維持) |
| Rule 10 (`@conv.*` 整合) | AI 目視のみ | conventionsValidator が CLI 検出 | (Phase 2 維持) |
| 識別子スコープ | AI 目視 (誤検出散発) | identifierScope が CLI 検出 (root レベル) | + WorkflowStep recurse 対応 (子 0a) |
| 参照整合 | AI 目視 + 既知パターン暗記 | referentialIntegrity が CLI 検出 | (Phase 2 維持) |
| **画面項目連携 (handlerFlowId / argumentMapping / primaryInvoker)** | **対象外 (画面側未スコープ)** | **対象外 (画面側未スコープ)** | **screenItemFlowValidator が CLI 検出 (新設)** |
| 実行セマンティクス (TX / runIf / branch fallthrough) | AI 目視 | 引き続き AI 目視 | 引き続き AI 目視 |
| **業務文脈の妥当性 (enum 値整合 / 主要起動元の業務妥当性)** | **対象外** | **対象外** | **AI 目視 (validator では届かない領域)** |

### Must-fix 検出経路の進化

| Phase | 業界 | 真の Must-fix 件数 | 検出経路 |
|---|---|---|---|
| Phase 1 #486 物流 (Sonnet) | logistics | 2 件 | /review-flow AI 目視 |
| Phase 1 #486 物流 (Opus) | logistics | 1 件 | /review-flow AI 目視 |
| Phase 2 healthcare (Opus 単独) | healthcare | 0 件 | (Skill 統合 + 独立レビュー pass) |
| Phase 2 welfare-benefit (Opus 単独) | welfare-benefit | 1 件 (M1: NOT NULL × INSERT 順序) | **独立 Opus サブエージェント レビュー** |
| **Phase 3 子 4 (Opus 単独 + Sonnet 独立レビュー)** | **healthcare + welfare-benefit 画面項目** | **1 件 (BenefitType enum 不一致)** | **独立 Sonnet サブエージェント レビュー** |

**M2 (Phase 3) の意義**: Phase 2 M1 (DB 制約 × フロー操作順序) と並ぶ「validator では届かない領域」の典型例。**画面と処理フローの enum 値整合は静的 validator では原理的に検出不能** (validator はキー集合のみ、値の照合には型情報の対応関係が必要)。

### Skill 統合効果の累積

| 効果 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| 既知パターン再発抑制 | 15 ルール self-check | 維持、再発ゼロ | + Rule 16 (画面項目連携) で 16 ルール |
| 機械検出 validator 数 | 0 | 4 | **5** |
| 観点別 AI 目視 | 8 観点 | 8 観点 (validator 検出済欄に分離) | **9 観点** (画面連携整合性追加) |
| 独立レビューのスケール | 別セッション必要 | Opus サブエージェント | + Sonnet サブエージェント (軽量レビュー用途) |

## Validator では届かない領域 (Phase 3 版)

### 発見された M2 (BenefitType enum 不一致)

#### 検出経路と原理的限界

```
画面側 options.value:                  flow 側 BenefitType.values:
- "livelihood"               ────❌────  - "child_allowance"
- "housing"                              - "livelihood_support"
- "medical"                              - "medical_expense_subsidy"
- "education"                            - "disability_support"
```

実行時には:
1. ユーザーが `livelihood` を選択
2. 画面が argumentMapping 経由で `benefitType: "livelihood"` を flow に送信
3. flow の validation step で enum チェックが走り、`livelihood` は許容値ではないため **VALIDATION エラー** で reject
4. 全リクエストが落ちる実害バグ (画面が何も動かない状態)

#### 各 validator が検出できなかった理由

| validator | M2 を検出できなかった理由 |
|---|---|
| `screenItemFlowValidator` | argumentMapping の **キー集合のみ検査** (キー名 + required の整合)。値の照合は対象外 |
| `sqlColumnValidator` | SQL 内のカラム名のみ検査、画面 ↔ フロー間の値整合は対象外 |
| `conventionsValidator` | `@conv.*` 参照のみ検査、画面側 options.value と flow 側 enum の照合は対象外 |
| `referentialIntegrity` | responseRef / errorCode 等の参照のみ検査、対象外 |
| `identifierScope` | 識別子スコープのみ検査、値の照合は対象外 |
| AJV (screen.v3.schema / process-flow.v3.schema) | 各 schema 単体で valid だが、**スキーマを跨ぐ値の対応関係は表現不可** |

### 検出のために必要な機構 (Phase 4 候補)

選択肢 A — **新 validator (`screenItemFieldTypeValidator`)**: 画面項目 type と flow inputs[] type の値レベル整合を検査
  - 画面 options.value ⊆ flow domain enum.values の包含関係
  - 画面 input pattern と flow input domain regex の一致
  - 画面 input min/max と flow input range constraint の整合
  - **設計者承認動線必須** (新 validator 追加)

選択肢 B — **画面項目 type に flow domain への参照を埋める** (双方向参照拡張)
  - 例: `type: { kind: "domain", domainKey: "BenefitType", flowId: "<flowId>" }` のように flow を参照
  - 画面 options を flow domain enum から自動生成 (single source of truth)
  - schema 拡張必須 (#624 と同パターン)

選択肢 C — **testScenarios fixture バリエーション網羅**
  - 各画面項目 enum value を 1 件ずつテストケース化
  - validator 検出ではなく実行時テストで担保
  - Phase 2 #608 で既に提案済み、Phase 3 でも未着手

**推奨**: 選択肢 A + C のハイブリッド (validator で構造的検出 + テストで実行時担保)。Phase 4 で正式起票。

### Phase 3 での追加発見: 静的検査と動的検査の境界

Phase 2 で「DB 制約 × フロー操作順序」が静的検出不能と判明。Phase 3 で追加:

| 領域 | 静的検出 | 動的検出 (test) |
|---|---|---|
| フロー単体の整合 (TX / runIf / branch) | AI 目視 | testScenarios で間接的 |
| **画面 ↔ フロー キー集合整合** | **screenItemFlowValidator (Phase 3 新設)** | testScenarios |
| **画面 ↔ フロー 値の意味的整合** | **検出不能 (validator 拡張で対応可、未着手)** | **testScenarios fixture 網羅で必要** |
| **DB 制約 × フロー操作順序** | **検出不能 (Phase 2 で判明)** | **testScenarios fixture 網羅で必要** |

→ **Phase 4 で testScenarios fixture バリエーション網羅 (#608) を本格対応すべき** (Phase 2 から繰越し済)

## 子 2 (trigger / 画面遷移 validator) の起票要否最終判断

### 当初の Phase 3 メタ想定

メタ #611 起票時、子 2 は以下を扱う想定だった:

- `trigger` (button click / form submit 等) と画面定義側のイベントハンドラの整合
- `forwardScreen` / `navigateTo` 等の画面遷移と画面フロー定義の整合
- 終了 step が画面遷移を持たない / 持つべきの判定

### 子 1 完了後の状況

子 1 #619 で確立した **ScreenItem.events[].handlerFlowId** は、当初子 2 で扱う予定だった「trigger ⇄ 画面イベント整合」を **完全に吸収**:

- ScreenItem.events[] = 画面側 trigger 宣言
- handlerFlowId = 該当 trigger に対応する処理フロー id
- 双方向整合 (events[].handlerFlowId ↔ flow.meta.primaryInvoker) は子 1 validator が検査

→ **子 2 が当初担当する予定だった trigger 連携は子 1 で全カバー済**。

### 残る画面遷移 (forwardScreen / navigateTo) の状況

- v3 schema の現状確認: `forwardScreen` / `navigateTo` 系の step kind は **schema に未定義**
- healthcare / welfare-benefit ドッグフードでも画面遷移系 step は使用していない
- 画面遷移は schema 拡張 + 拡張 step kind 設計 + 画面フロー定義 (`docs/sample-project-v3/<project>/views/*.json` 等) の確立が前提

→ 画面遷移 validator は **schema 設計が先行**しないと validator 設計に進めない。Phase 3 スコープでは検証対象なし。

### 最終判断: 子 2 は起票せず Phase 4 候補へ移管

- 子 1 で trigger 連携は吸収済
- 画面遷移は schema 拡張 + views 定義の確立 (Phase 4 ViewDefinition 整合と一体) が前提
- → Phase 4 候補 §「画面遷移整合 + ViewDefinition」として一体化、子 2 は独立起票しない

## Phase 4 候補リスト (Phase 3 から引き継ぎ)

### 構造的整合系 (新 validator 候補)

| 候補 | 内容 | 必要な前提 |
|---|---|---|
| `screenItemFieldTypeValidator` (新設) | 画面 options.value ⊆ flow domain enum.values 等の値レベル整合検査 | 設計者承認、既存 5 validators パターン踏襲 |
| 画面遷移 validator (旧子 2、Phase 3 で起票見送り) | forwardScreen / navigateTo + views/ の整合 | views v3 schema 確立 + step kind 設計 |
| `sqlOrderValidator` (Phase 2 から繰越) | DB 制約 × フロー操作順序の交差検査 | 設計者承認、Phase 2 評価レポート §候補 (d) |

### Skill / fixture 系

| 候補 | 内容 | 必要な前提 |
|---|---|---|
| testScenarios fixture バリエーション網羅 (#608、Phase 2 から繰越) | 各画面項目 enum value / DB 行 fixture を testScenarios で網羅 | Skill 改善、設計判断不要 |
| `/create-flow` 画面側生成サポート | flow の inputs[] / outputs[] から画面項目案を提案 | Phase 4 backend tool 拡張可能性検討 |

### Schema / spec 系

| 候補 | 内容 | 必要な前提 |
|---|---|---|
| ViewDefinition (一覧 UI) 整合 | DB ビュー (data view) ではなく一覧 UI viewer の意味で、画面項目共通化と一体 | Phase 4 ViewDefinition v3 schema 確立 |
| 画面項目共通化 (再利用 ScreenItem ライブラリ) | 複数画面で同じ住所入力 / 銀行口座参照等を再利用するパターン | schema 拡張 (ScreenItem.refKey 等)、既存 #390 prior art あり |
| 多言語化整合 (i18n) | conventions catalog `i18n.supportedLocales` × `msg.<key>.locales` × screen labels | conventions schema は既に対応、UI / Skill 統合が未着手 |
| アクセシビリティ整合 | label / placeholder / errorMessages の WAI-ARIA 整合 | 軽量、Phase 4 後半候補 |

### 中長期 (TS 移行系)

| 候補 | 内容 | 必要な前提 |
|---|---|---|
| v3 TS 型同期 (#610、Phase 2 から繰越) | `@ts-nocheck` 依存解消 | TS 全体移行と統合可、Phase 4 並走可 |
| `@error` 暗黙変数 (#612) | identifierScope の `@error` ambient 化 | 設計判断、Phase 3 で並走 ISSUE として認識済 |

## Phase 4 移行判断: **進行可 (条件付き)**

### 進行可とする根拠

1. **画面と処理フローの境界検査が確立** — Phase 3 で 5 番目 validator が CLI 検出可能に。Phase 4 で扱う ViewDefinition / 画面項目共通化等は本機構の延長で実装できる
2. **「validator では届かない領域」の特定パターンが Phase 2 / Phase 3 で安定** — DB 制約 × 順序 (Phase 2)、画面 × 値整合 (Phase 3) と続く流れで、Phase 4 候補の検出限界も事前予測可能
3. **Skill 統合パターンが 5 番目 validator にも適用できた** — 新 validator 追加時の Skill 統合手順が定式化、Phase 4 でさらに validator を増やしても運用コストが線形

### 条件 (Phase 4 着手前に必須または推奨)

以下のフォローアップ ISSUE のうち **(α) と (β) は Phase 4 着手前に解消が望ましい**。Phase 4 (ViewDefinition / 画面項目共通化) は画面側 schema を拡張する作業であり、画面側既存検証で見つかった残課題を先に整理すべき。

- (α) `@error` 暗黙変数 #612 — Phase 3 で並走認識済、未着手
- (β) testScenarios fixture バリエーション網羅 #608 — Phase 2 から繰越、Phase 3 で BenefitType enum 不一致 (M2) を実行時テストで catch できなかった反省を反映

(γ) (δ) (ε) は Phase 4 と並走で対応可。

### Phase 4 を遅延させない場合の最低条件

- Phase 4 メタ ISSUE 起票時に (α) (β) を **Phase 4 子 0 (前提整備)** として組み込む
- Phase 4 子 1 から先は (α) (β) 完了後に着手 (Phase 3 と同パターン)

## フォローアップ ISSUE 起票案

| ID | タイトル案 | 優先度 | 種別 |
|---|---|---|---|
| (α) | `fix(validator): identifierScope の @error 暗黙変数を ambientVariables に組み込む (#612)` | 高 (Phase 4 前) | バグ修正、既存 ISSUE |
| (β) | `improve(skill): /create-flow に testScenarios fixture バリエーション網羅指針を追加 (#608)` | 高 (Phase 4 前) | Skill 改善、Phase 2 から繰越 |
| (γ) | `feat(validator): screenItemFieldTypeValidator 新設 — 画面 options ⊆ flow domain enum 等の値レベル整合検査` | 中 (Phase 4 並走) | 新機能、設計者承認必須 |
| (δ) | `feat(validator): sqlOrderValidator 新設 — DB 制約 × フロー操作順序の交差検査` | 中 (Phase 4 並走) | 新機能、設計者承認必須、Phase 2 から繰越 |
| (ε) | `improve(validator): v3 TS 型同期 — @ts-nocheck 依存解消 (#610)` | 中 (Phase 4 並走) | 中長期、TS 移行と統合可、Phase 2 から繰越 |

各 ISSUE は本 PR マージ後に別途起票する。本 PR 自体は #623 のみクローズし、(α)-(ε) は新 ISSUE / 既存 ISSUE 進行管理として独立。

## Phase 3 メタ #611 のクローズ条件評価

#611 完了基準と本 PR の状態:

| 完了基準 | 状態 | 達成箇所 |
|---|---|---|
| 子 0a (#606) / 子 0b (#607) 両者マージ済 | ✅ | PR #613 / #615 |
| 既存画面項目連携の現状監査レポート | ✅ | 子 1 子 4 の評価で代替 (本レポート §子 1 / 子 4) |
| 新規 validator 2 件 (画面項目連携 / trigger・画面遷移) | △ | 1 件 (screenItemFlowValidator)。子 2 は子 1 で吸収済 + Phase 4 移管と判断 (本レポート §子 2 起票要否最終判断) |
| Skill (`/create-flow` + `/review-flow`) への統合 | ✅ | 子 3 #621 / PR #628 |
| 2 業界ドッグフード (healthcare + welfare-benefit) で画面項目 + 画面フロー追加完了 | ✅ | 子 4 #622 / PR #629 (画面遷移は Phase 4 移管) |
| 評価レポート (`docs/spec/phase3-evaluation-YYYY-MM-DD.md`) | ✅ | 本レポート |
| Phase 4 移行判断 | ✅ | 本レポート §Phase 4 移行判断 |

**結論**: Phase 3 メタ #611 のクローズ条件を実質達成。子 2 は子 1 で吸収済 + Phase 4 移管としてクローズ判定。本 PR マージ後に #611 もクローズ可能。

## 次アクション (Phase 3 完了後)

1. 本 PR (#623 close) をマージ
2. メタ #611 をクローズ (フォローアップ起票案の参照と合わせて)
3. フォローアップ ISSUE (γ) (δ) を独立起票 (Phase 4 着手前 = (α)(β) は既存 ISSUE 進行管理、並走 = (γ)(δ)(ε))
4. Phase 4 メタ ISSUE 起票 (ViewDefinition / 画面項目共通化 / 多言語化整合 / アクセシビリティ整合 / 残課題、子 0 で (α)(β) 統合)
5. Phase 4 子 ISSUE 起票

## Phase 3 セッション運用の知見 (副産物)

本 Phase 3 で得られた、AI コーディングエージェント運用の知見 (Phase 4 で踏襲推奨):

1. **Sonnet サブエージェントは軽量レビュー用途に最適** — Phase 2 で Opus サブエージェントを Must-fix M1 検出に使ったが、Phase 3 では Sonnet で BenefitType enum M2 を検出できた。コスト効率と検出精度のバランスで Sonnet が次の標準 (Opus は重い設計判断時のみ)
2. **「validator では届かない領域」の発見は独立レビュー必須** — Phase 2 M1 / Phase 3 M2 ともに **AI 単独では発見不能、独立レビューで初めて検出**。Phase 4 でも独立レビュー (Sonnet/Opus) を全 PR で必須化推奨
3. **子 ISSUE の柔軟な再構成 OK** — 当初メタの子 2 (trigger / 画面遷移) は実装過程で子 1 が吸収済と判明、子 5 で「起票しない」を確定。**メタ起票時の子分割を絶対視しない、実装中に判明した最適化は積極的に反映する** 運用が有効
4. **Skill 統合の累積パターン化** — Phase 2 で 4 validator → Phase 3 で 5 validator + AI 目視観点 +1 という拡張に新しい設計判断は不要だった。Phase 4 で N validator になっても同パターンで増やせる
5. **Phase 評価レポートのテンプレ化** — Phase 2 / Phase 3 で同形式 (§検出方式の進化 / §validator では届かない領域 / §Phase X+1 移行判断) のレポートを書いた。Phase 4 でも本レポートをテンプレに踏襲可能

## 関連 PR / ISSUE

- 親メタ: #611 (Phase 3 — 本レポートでクローズ条件を満たす)
- 子 0a: #606 / PR #613 (identifierScope.walkSteps recurse 修正)
- 子 0b: #607 / PR #615 (validate-dogfood per-project 化)
- 過渡期: #616 / PR #618 (retail subdir)
- 前提 (schema): #624 / PR #625 (ScreenItem.events[] + ProcessFlow.meta.primaryInvoker)
- 子 1: #619 / PR #626 (screenItemFlowValidator 新設)
- 子 3: #621 / PR #628 (`/create-flow` + `/review-flow` Skill 統合)
- 子 4 + 統合: #622 + #614 / PR #629 (healthcare + welfare-benefit ドッグフード + 規約カタログ補充)
- 子 5: #623 / PR (本作業)
- 子 2: 起票せず (子 1 吸収 + Phase 4 移管)
- 関連 ISSUE: #612 / #608 / #610 (Phase 4 引継ぎ候補)
- 関連メタ (Phase 1 / Phase 2): #458 / #478 / #486 / #500 / #493 — 全完了
