---
description: "/create-flow 効果検証レポート (物流業務、Must-fix 50-75% 削減)"
status: record
category: record
---

# `/create-flow` 効果検証レポート — 物流業務 (2026-04-27)

> **📝 ステータス**: 完了済 **historical record** (物流業務 `/create-flow` 効果検証、Phase 4 retail 検証と並行実施)。本書は当時の検証結果記録として保持、削除不可 (他 spec から参照ある場合あり)。最新の状況・運用は現行 spec を参照。

## 概要

`/create-flow` スキル (PR #485) の作成時品質ガード効果を、**製造業 #478 (`/create-flow` 未使用、Codex 不使用)** との比較で定量検証した。

物流業務 1 シナリオ (配送指示 → 倉庫ピッキング → 配送追跡 → 顧客到着確認) を Sonnet と Opus に **`/create-flow` 経由で並列実装**させ、初回 `/review-flow` の Must-fix 件数を比較。

## 検証目的

メタ #478 で観察された:
- 一発出し時の初回 Must-fix: 両 AI とも 4 件/シナリオ
- 既知パターン再発: TX outputBinding ネスト参照 / branch return 後 fallthrough を両 AI で再発

`/create-flow` の 8 ルール self-check が**作成時点で**これらを抑制できるか定量検証。

## 検証結果サマリ (主要発見)

### Must-fix 件数の劇的削減

| AI | #478 (一発出し) | #486 (`/create-flow` 経由) | 削減率 |
|---|---|---|---|
| **Sonnet** | 4 件 | **2 件** | **50%** |
| **Opus** | 4 件 | **1 件** | **75%** |

→ 両 AI とも有意に Must-fix 削減。Opus の削減率が高いのは spec 遵守度の高さに由来。

### 抑制された既知パターン (両 AI 共通で完全抑制)

| 既知パターン | #478 (Codex / 両 AI で再発) | #486 (`/create-flow` 経由) |
|---|---|---|
| TX outputBinding ネスト参照 | あり | **なし** ✓ |
| inlineBranch.ng 欠落 | あり | **なし** ✓ |
| catalog 未登録 eventPublish | あり | **なし** ✓ |
| schema invalid (`namespace:StepName`) | Opus #480 で発生 | **なし** ✓ |

→ `/create-flow` の Step 3 (8 ルール self-check) が**作成時点で機能**することを実証。

### 残った Must-fix の性質 (`/create-flow` checklist 漏れ)

両 AI とも残った Must-fix は **既知パターンではなく新規盲点**:

- **Sonnet (2 件)**:
  - SELECT カラム漏れ (`@shipment.quantity` を SELECT していないのに参照): SQL 整合の盲点
  - TX inner branch fallthrough (TX 内の branch return 後の制御不明): 既知パターン #458/#478 の TX 外バージョン → TX 内でも発生

- **Opus (1 件)**:
  - `@conv.limit.maxDeliveryAttempts` が `conventions-catalog.json` 未登録: `@conv.*` 参照と catalog 整合の盲点

→ 結論: **`/create-flow` checklist にない領域 (SQL カラム整合 / catalog 参照整合 / TX 内 branch fallthrough) が新たな盲点として浮上**。`/review-flow` が依然として最終防衛線として必須。

## AI 別の自己申告精度

| AI | 自己申告 | 独立 review-flow | 精度 |
|---|---|---|---|
| Sonnet PR #487 | 8/8 ✓ | Must-fix 2 件 | **6/8 ≈ 75%** (2 件見落とし) |
| Opus PR #488 | 8/8 ✓ | Must-fix 1 件 | **7/8 ≈ 87.5%** (1 件見落とし) |

→ **Opus の自己批評精度が高い** (#478 の知見と一致)。ただし両 AI とも完全な自己評価は不可能 — `/review-flow` 独立検証が品質保証の最終手段。

加えて、Opus は `/create-flow` 実行中に **schema 制約 6 件を新規発見** (`affectedRowsCheck.operator` の `=` のみ受容、`expected` は integer リテラル必須等)。これは `/create-flow` SKILL の改善材料。

## 検証指標達成状況

| 指標 | #478 (`/create-flow` 未使用) | #486 (`/create-flow` 使用) | 評価 |
|---|---|---|---|
| 初回 Must-fix 件数 | 4 件/シナリオ | **1-2 件/シナリオ** | ✅ 期待値達成 |
| 既知パターン再発 | 両 AI で 2-3 種再発 | **完全抑制** | ✅ 期待値超過 |
| 修正サイクル数 | 1 ラウンド | **1 ラウンドで Must-fix ゼロ達成** | ✅ 達成 |
| spec 解釈ブレ | あり (AI 別の workaround 差異) | **統一** (両 AI が同じ pattern を採用) | ✅ 達成 |
| `/review-flow` 必須性 | 必須 | **依然として必須** (新規盲点を捕捉) | ⚠️ 期待通り |

## 一般化された知見

1. **`/create-flow` は既知パターン抑制に大成功**: TX ネスト参照 / inlineBranch.ng / catalog 整合 / namespace:StepName 等の頻発バグを作成時点で防止
2. **新規盲点は依然存在**: SQL カラム整合 / `@conv.*` catalog 参照 / TX 内 branch fallthrough 等の checklist にない領域
3. **AI 別の自己批評精度差は維持**: Opus 87.5% > Sonnet 75% (#478 の傾向と一致)
4. **作成時ガードと最終防衛線の併用が最適**: `/create-flow` で前段抑制、`/review-flow` で残存検出 → 修正 → マージ
5. **schema 制約の暗黙的部分が露呈**: Opus の発見した 6 件の schema 制約は `/create-flow` SKILL 自体の改善材料

## `/create-flow` SKILL の改善候補 (派生 ISSUE)

検証で明らかになった追加チェック項目:

1. **SQL SELECT 句のカラム整合確認**: 後続で参照する全フィールドが SELECT 句に含まれているか
2. **`@conv.*` 参照の catalog 整合**: 参照先キーが `docs/sample-project/conventions/conventions-catalog.json` に存在するか
3. **TX 内 branch return 後の制御**: TX inner branch が return した場合の後続 step 制御 (`runIf` ガード or branch 構造化)
4. **`affectedRowsCheck.operator` 制約**: `=` のみ受容、`==` 不可
5. **`affectedRowsCheck.expected` 制約**: integer リテラル必須、式参照不可
6. **`OtherStep.outputSchema` 形式制約**: `{field: "string"}` 形式のみ、複雑 JSON Schema 不可

これらは `/create-flow` SKILL の Step 3 既知パターン回避 8 ルールに追加候補。別 ISSUE で起票。

## メタ #458 / #478 / #486 の比較

### 検証データ全体

| 検証 | 業界 | AI | spec 改訂 | `/create-flow` | 初回 Must-fix 平均 |
|---|---|---|---|---|---|
| #458 (金融、6 シナリオ) | 金融 | Codex 主 | 改訂前 | 未導入 | 2.8 件/シナリオ |
| #478 (製造、2 シナリオ) | 製造 | Sonnet/Opus | 改訂後 (#474) | 未導入 | 4.0 件/シナリオ |
| #486 (物流、2 シナリオ) | 物流 | Sonnet/Opus | 改訂後 + `/create-flow` | 導入 | **1.5 件/シナリオ** |

→ **#486 で初めて Must-fix が大幅削減**。spec 改訂単体では効果限定的だったが、**`/create-flow` ワークフロー化で実効性が確認された**。

### スキル/ツール群の効果

| 改善施策 | 効果 |
|---|---|
| spec 改訂 #474 (PR #477) | TX 設計・rollbackOn・ADR 記述に部分的効果。既知パターンの再発は防げず |
| `/review-flow` (PR #462) | 体系的検出ワークフロー、Must-fix を漏れなく拾う最終防衛線 |
| **`/create-flow` (PR #485)** | **作成時の品質ガード、既知パターンを作成時点で抑制 — 効果大** |

3 点セットで「**業務フロー設計を AI に任せられる仕組み**」がほぼ完成。

## 結論

| 評価項目 | 結果 |
|---|---|
| `/create-flow` 効果検証 | ✅ Must-fix 50-75% 削減を達成 |
| 既知パターン抑制 | ✅ 完全抑制 (4 種すべて) |
| AI 比較データ取得 | ✅ Opus > Sonnet の傾向再確認 |
| 新規盲点の発見 | ✅ 6 件の schema 制約 + 3 件の checklist 漏れ |
| `/review-flow` 併用必要性 | ✅ 依然として必須 (期待通り) |

### 次フェーズへの推奨

- **`/create-flow` SKILL 改善 ISSUE** を起票 (上記 6 件の checklist 追加、優先度: 中)
- **Phase 2 (テーブル定義 + 処理フロー連携) のメタ ISSUE 起票** — 本検証で `@conv.*` catalog 整合性問題が発覚しており、テーブル/規約との整合性検証が次の自然な拡張
- **`namespace:StepName` schema 対応 ISSUE** (フレームワーク Must-fix 残課題、優先度: 中)

## 関連

- 親 ISSUE: #486 (物流ドッグフード、`/create-flow` 効果検証)
- 子 PR: #487 (Sonnet) / #488 (Opus)
- `/create-flow` 実装: #484 / PR #485
- 比較対象 (一発出し): #458 (金融) / #478 (製造)
- 評価レポート参照: `docs/spec/dogfood-2026-04-26-finance.md` / `docs/spec/dogfood-2026-04-26-manufacturing.md`
- 3 分類ルール: memory `feedback_dogfood_issue_classification.md`
