---
description: "Phase 4 全仕様書統合検証レポート — retail (既存退避→AI 生成→改善ループで Must-fix ゼロ達成)"
status: record
category: record
---

# Phase 4 (全仕様書統合検証) 評価レポート — retail (2026-04-27)

> **📝 ステータス**: 完了済 **historical record** (Phase 4 retail 全仕様書統合検証、#500)。本書は当時の検証結果記録として保持、削除不可 (他 spec から参照ある場合あり)。最新の状況・運用は現行 spec を参照。

## 概要

Phase 4 (全仕様書統合検証) のラウンド 1 として、**既存サンプル退避 → AI 投入スクリプトで retail 業務の全仕様書を一括生成 → /review-flow による独立検証 → 失敗改善ループ → Must-fix ゼロ達成** を実証した。

ユーザー指示の核心 (「設計データ投入スクリプトでドッグフードして失敗→改善の繰り返し」) を達成。

## 検証目的

メタ #500 の核心命題:
> 業務概要を入力するだけで、AI が**整合性の取れた全仕様書 (処理フロー / テーブル定義 / 業務規約 / 拡張定義)** を生成し、その整合性が `validate:dogfood` + `/review-flow` で検証可能か

## 実施フロー

```
Step 1: 既存サンプル退避
  docs/sample-project/ → docs/legacy-sample-project/
  docs/sample-project/ に空構造 + 空 conventions catalog

Step 2: 投入スクリプト (AI モード)
  npm run generate:dogfood --industry retail --scenarios ... --mode ai
  → docs/sample-project/_briefing.md 生成

Step 3: AI 仕様書生成 (Sonnet サブエージェント)
  briefing 読み取り → 全 4 種仕様書を生成
  - 拡張定義 (retail namespace)
  - テーブル定義 8 件
  - conventions 拡張
  - 処理フロー × 4 シナリオ (gggggggg-0001..0004)

Step 4: validate:dogfood 検証
  → 4/4 全 pass (整合性 OK)

Step 5: /review-flow 検出 (4 並列)
  → Must-fix 13 / Should-fix 16 / Nit 11 = 40 件 (実行セマンティクス問題)

Step 6: 改善 (Sonnet 1 セッション 40 件一括修正)
  PR #508 マージ
  → validate:dogfood 4/4 全 pass

Step 7: 再 /review-flow 検出 (4 並列)
  → 3/4 Must-fix ゼロ、1 件残 (オフバイワン)

Step 8: 微修正
  PR #509 マージ
  → 全 4 flow Must-fix ゼロ達成 ✅
```

## 結果サマリ

### 改善ラウンド集計

| ラウンド | Must-fix | Should-fix | Nit | 状態 |
|---|---|---|---|---|
| ラウンド 2 (初回 /review-flow) | **13** | 16 | 11 | 改善必要 |
| ラウンド 4 (修正後再 /review-flow) | **1** | 4 | 7 | 微修正 |
| ラウンド 5 (最終) | **0** | 4 | 7 | ✅ Must-fix ゼロ |

### 4 retail flow の最終状態

| Flow | Must-fix | 主要修正 | 判定 |
|---|---|---|---|
| gggggggg-0001 (店舗在庫照会) | 0 | conventions catalog `lowStockThreshold` / `product-code` 追加 | ✅ |
| gggggggg-0002 (カート追加) | 0 | step-10 二重 UPSERT 削除 / 既存商品除外条件 / null 区別 | ✅ |
| gggggggg-0003 (注文確定 TX) | 0 | TX 後 SELECT (`@persistedOrder`) 再取得パターン (#460 踏襲) / branch で TX 失敗時 422 return / TX 内 `@newOrder.id` → `@newOrderId` 統一 | ✅ |
| gggggggg-0004 (配送指示) | 0 | `generateUUID()` → `@fn.generateShipmentId()` / 試行上限 `>=` (オフバイワン解消) / carrierResult null guard | ✅ |

## 3 分類別件数 (改善ループ全体集計)

| 領域 | ラウンド 2 検出 | 修正後残存 |
|---|---|---|
| **フレームワーク** | 5 | 0 |
| **拡張定義** | 3 | 0 (Should-fix 1 残) |
| **サンプル設計** | 32 | 0 (Should-fix 3 / Nit 7 残) |

## 重要な発見

### A. 一発出しで 100% 整合は困難 (期待通り)
- AI が`/create-flow` 14 ルール self-check 遵守を申告しても、独立 review で 13 Must-fix が検出された
- **修正ループは必須**: ユーザー指示「失敗→改善の繰り返し」は構造的に正当

### B. 既知パターン再発 (Phase 1 と同じ)
- TX outputBinding ネスト参照 (#458/#478 で何度も発覚) が retail-0003 でも再発
- `@conv.*` catalog 整合 / 関数カタログ整合の盲点が再発
- **spec / SKILL の充実だけでは AI のミスを完全には防げない**ことを再実証
- `/review-flow` の最終防衛線が必須

### C. AI 自己申告の精度限界
- ラウンド 1 で Sonnet 自己申告 8/8 ✓ → 独立 review で Must-fix 13 件検出
- 自己申告精度は実用に耐えない、独立検証が必須

### D. 改善ループの収束性
- ラウンド 2 → ラウンド 4 で **Must-fix 13 → 1 (92% 削減)**
- ラウンド 5 で完全ゼロ達成
- **2-3 ラウンドで収束する** ことを確認

### E. schema 拡張の必要性
- ラウンド 3 で実装中に schema 拡張 6 フィールド追加 (`patternRef` / `ngEventPublish` / `object[]` 等)
- AI が業務記述を正確に表現するには schema の柔軟性も必要

## 副産物 (PR #508 由来)

### schema 拡張 6 フィールド
- `patternRef`: validation rule で conventions regex 参照
- `ngEventPublish`: validation 失敗時のイベント発行
- `object[]` 型: outputs フィールドで配列型表現
- `responseSchema`: externalSystem step の応答スキーマ
- `CacheHint.note`: キャッシュ意図注記
- `ElseBranch.description`: elseBranch 動作記述

→ これらは spec の表現力強化で、後続 ドッグフードでも有用。

## 残課題 (フォローアップ ISSUE 候補)

### Should-fix 残 4 件
- gggggggg-0001: `retail.search_validation_failed` イベント名のセマンティクス問題
- gggggggg-0002: no-op パス (step-12b/13b) が UPSERT RETURNING で常に値を返すため到達不能
- gggggggg-0003: `@inventoryUpdate` を TX 外で参照 (TX rollback 時に未定義リスク)
- gggggggg-0004: ADR-003 で宣言した `retail:ShipmentDispatchStep` が steps に存在しない

### Nit 残 7 件
- step ID 欠番、glossary aliases 不足、testScenario 拡充等

### `/create-flow` SKILL 強化候補 (Rule 15-17 候補)
- 拡張 step の outputBinding 必須化 (二重実行防止)
- 関数カタログとの整合性 (`@fn.*` 参照は functionsCatalog 登録済みのみ)
- testScenario と condition の論理整合 (オフバイワン検出)

## 結論

| 評価項目 | 結果 |
|---|---|
| 投入スクリプトでの全仕様書生成 | ✅ 達成 (briefing 経由) |
| validate:dogfood 全 pass | ✅ 達成 (4/4) |
| /review-flow Must-fix ゼロ | ✅ 達成 (改善 2 ラウンドで完全達成) |
| 失敗→改善ループの実用性 | ✅ 実証 |
| 3 分類別件数集計 | ✅ 機能 |
| Codex 不使用での完遂 | ✅ Sonnet/Opus サブエージェントで完結 |

### 一般化された知見

本フレームワークは「**業務概要から AI が全仕様書を生成 → 整合性検証 → 改善 → Must-fix ゼロ達成**」という**完結したワークフロー**を持つに至った。これにより:

1. **業務アプリ開発者は業務概要だけ書けば、AI が整合性ある仕様書一式を生成できる**
2. **/review-flow による独立検証が品質保証の最終防衛線**
3. **改善ループは 2-3 ラウンドで収束する** (実用的な所要時間)

次フェーズ:
- **Phase 5 (将来)**: 実装コード自動生成 (仕様書 → コード)
- **Phase 4-3 (継続)**: 他業界での再検証、SKILL 改善 (Rule 15-17 追加候補)

## 関連

- 親メタ: #500 (Phase 4) — 本 PR でクローズ判定
- 子 ISSUE: #506 (Phase 4-2 ラウンド実行)
- 関連 PR: #503 (基盤) / #505 (AI モード) / #507 (ラウンド 1) / #508 (ラウンド 3) / #509 (ラウンド 5)
- 既存ドッグフードレポート:
  - `dogfood-2026-04-26-finance.md` (Phase 1 金融)
  - `dogfood-2026-04-26-manufacturing.md` (Phase 1 製造)
  - `dogfood-2026-04-27-logistics-create-flow-validation.md` (Phase 1 物流 + /create-flow 検証)
- 退避済サンプル: `docs/legacy-sample-project/` (参照用)
