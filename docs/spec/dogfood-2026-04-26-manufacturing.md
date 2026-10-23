---
description: "再ドッグフード (製造業) 評価レポート — Codex 抜き / Sonnet vs Opus 比較 / 3 分類別件数集計"
status: record
category: record
---

# 再ドッグフード (製造業) 評価レポート (2026-04-26)

> **📝 ステータス**: 完了済 **historical record** (製造業 dogfood、#478、Phase 4 前の検証)。本書は当時の検証結果記録として保持、削除不可 (他 spec から参照ある場合あり)。最新の状況・運用は現行 spec を参照。

## 概要

メタ #458 (金融複合業務) の成果が**別の AI / 別の業界で再現可能か**を検証する再ドッグフード。Codex 不使用、Sonnet と Opus サブエージェントのみで 2 シナリオを実装し、3 分類別の問題件数と AI 別品質差を集計した。

## 検証目的

1. メタ #458 の成果再現性 (金融以外で 5/5 維持できるか)
2. spec 改訂 #474 の実効性検証 (#477 で TX 制御フロー / 拡張定義実利用 / runtime conventions ガイドライン拡充済)
3. 3 分類ルール (`feedback_dogfood_issue_classification.md`) の初運用
4. Codex 抜きでのワークフロー完遂可能性
5. AI 別 (Sonnet vs Opus) の実装品質比較

## 検証対象

| # | シナリオ | ISSUE / PR | 担当 AI |
|---|---|---|---|
| 1 | 受注 → 生産計画 → 部材引当 → 製造指示 | #479 / #481 | **Sonnet** (general-purpose, sonnet model) |
| 2 | 製造実績 → 品質検査 → 出荷可否 → トレーサビリティ | #480 / #482 | **Opus** (general-purpose, opus model) |

namespace: `manufacturing` (新規)

### フローファイル一覧

| ファイル | シナリオ | アクション数 | testScenarios |
|---|---|---|---|
| `docs/sample-project/process-flows/eeeeeeee-0001-4000-8000-eeeeeeeeeeee.json` | 受注/生産計画/部材引当/製造指示 | 1 (act-001、在庫充足/不足の 2 パス) | 3 |
| `docs/sample-project/process-flows/eeeeeeee-0002-4000-8000-eeeeeeeeeeee.json` | 製造実績受信/品質検査/出荷可否/トレーサビリティ | 3 (act-001 製造実績受信/act-002 品質検査/act-003 出荷可否判定) | 4 |

## 拡張定義 (manufacturing namespace)

### 確定した拡張カタログ

`docs/sample-project/extensions/manufacturing/` に以下 4 ファイルを配置:

#### FieldType (4 種)

| kind | label | 追加 PR | 実利用シナリオ |
|---|---|---|---|
| `lotId` | ロット ID | #481 | シナリオ #1/#2 (InventoryReserveStep / TraceabilityStep 入力) |
| `workOrderId` | 製造指示書 ID | #481 | シナリオ #1/#2 (WorkOrder 状態更新) |
| `partNumber` | 部品番号 | #481 | シナリオ #1 (BOM 展開 / 在庫引当 入力) |
| `serialNumber` | シリアル番号 | #482 | シナリオ #2 (製造実績受信、個品識別) |

#### ActionTrigger (1 種)

| value | label | 追加 PR | 実利用シナリオ |
|---|---|---|---|
| `qualityIncident` | 品質異常検知時 | #482 | 将来用 (シナリオ #2 の act-002 は `submit` 起動のため未使用、README に明記) |

#### DbOperation (2 種)

| value | label | 追加 PR | 実利用シナリオ |
|---|---|---|---|
| `BOM_EXPLODE` | BOM 階層展開 | #481 | シナリオ #1 (act-001 BOM 展開) |
| `RESERVE_INVENTORY` | 在庫引当 (排他ロック付き UPDATE) | #481 | シナリオ #1 (act-001 部材引当) |

#### Step (4 種)

| name | label | 追加 PR | 実利用シナリオ |
|---|---|---|---|
| `BomExplodeStep` | BOM 展開 | #481 | シナリオ #1 (act-001 step-005-b-02) |
| `InventoryReserveStep` | 在庫引当 | #481 | シナリオ #1 (act-001 step-005-b-07-02) |
| `TraceabilityStep` | トレーサビリティ記録 | #482 | シナリオ #2 (act-001 `:447` / act-003 `:868`) |
| `QualityCheckStep` | 品質検査 | #482 | シナリオ #2 (act-002 `:589`) |

## 実装結果サマリ

### 初回実装時の問題件数 (PR 自己申告)

シナリオ #1 (Sonnet、PR #481) と シナリオ #2 (Opus、PR #482) は `/review-flow` の独立レビューを別セッションで実施せず、実装者による自己申告値を記録する。

| 領域 | シナリオ #1 (Sonnet) | シナリオ #2 (Opus) | 合算 |
|---|---|---|---|
| フレームワーク / spec 問題 | 1 | 3 | 4 |
| 拡張定義問題 | 0 | 4 | 4 |
| サンプル設計問題 | 1 | 3 | 4 |
| **合計** | **2** | **10** | **12** |

両 PR ともマージ前に `extensions-samples.test.ts` / `process-flow.schema.test.ts` (203 件) 全 pass および `npm run build` 成功を確認してマージ済み。

## 3 分類別詳細 (両シナリオ合算)

| 領域 | 件数 | 主な内容 |
|---|---|---|
| **フレームワーク (本アプリ)** | 4 | spec §15.2 ↔ schema 乖離 (Sonnet/Opus 共通)、`txResult` メタオブジェクト未定義、fireAndForget sideEffects 境界曖昧、拡張 step 副作用契約の表現手段なし |
| **拡張定義** | 4 | `UPSERT_IDEMPOTENT` namespace 所属問題、`QualityCheckStep.inspectionItems` 型 workaround、`qualityIncident` 未利用の扱い、`TraceabilityStep.metadata` schema 緩さ |
| **サンプル設計** | 4 | BOM 配列アクセスパスの明示度 (Sonnet)、act-002 TX 範囲の選択、act-003 連鎖起動のパターン、`disposition` 値の拡張余地 |

### フレームワーク (本アプリ) 領域の問題詳細

1. **spec ↔ schema 乖離 (Sonnet / Opus 両方で直面)**: spec §15.2 が拡張 step の正式形式を `namespace:StepName` と規定したが、`process-flow.schema.json` の `OtherStep.type` は `{"const": "other"}` のみ受容する。
   - **Sonnet (シナリオ #1)**: 経験で乖離を察知し `type: "other"` + description 注記の旧形式で回避 → schema valid
   - **Opus (シナリオ #2)**: spec を遵守して `manufacturing:TraceabilityStep` 等の namespace 修飾形式を使用。ただし PR #482 の仕様逐条突合節 §15.2 で「schema 未対応の状態で spec 指定形式を採用」と自己申告しており、schema validation の扱いを PR description で整合性説明済み (203 tests pass 確認)
   - **別 ISSUE 起票候補**: spec §15.2 を schema が受容するよう改修するか、spec を「過渡期は `type: "other"` workaround」に書き換えるか

2. **`txResult` メタオブジェクト形式の未定義 (Opus が自己申告)**: spec は `@txResult.committed` を例示するが、`rollbackAt` / `errorCode` 等の他フィールドの契約が仕様書に存在しない。Opus は `committedAt` を使わず `committed` のみで統一することで回避。

3. **fireAndForget + sideEffects 境界の曖昧さ (Opus が自己申告)**: spec §4.3 は fireAndForget を「バックグラウンド reject 扱い」と明記するが、`outcomes.timeout.action: "continue"` 時に sideEffects が実行されるかどうかが曖昧。Opus は fireAndForget 通知に sideEffects を付けない形で回避。

4. **拡張 step の affectedRows 契約宣言手段なし (Opus が自己申告)**: 拡張 step が何行 INSERT するかを schema で表現できない。冪等性 / 副作用契約が description に依存する構造的限界。

### 拡張定義領域の問題詳細

1. **`UPSERT_IDEMPOTENT` の namespace 所属**: securities namespace で既定義のため manufacturing での再定義を避けたが、グローバル昇格か各 namespace 独自定義かの設計指針が未決定 (Opus が自己申告)。

2. **`QualityCheckStep.inspectionItems` の型 workaround**: 配列を受け取る入力項目だが、フロー JSON 側で `@inputs.inspectionItems` (式文字列) として渡すため `{ "type": "array" }` では schema 違反になる。`{ "type": "string" }` で定義して runtime で評価する想定にした (Opus が自己申告)。

3. **`qualityIncident` trigger の未利用**: 定義したが シナリオ #2 の act-002 が `submit` 起動のため実利用しなかった。spec §15.3 の「実利用必須」原則の例外として README に明記済み (Opus が自己申告)。

4. **`TraceabilityStep.metadata` の schema 緩さ**: `{ "type": "object" }` のみで内部構造未定義。`metadata` に渡す鍵 (`workOrderId` 等) が Tribal knowledge になる (Opus が自己申告)。

### サンプル設計領域の問題詳細

1. **BOM 展開結果の配列アクセスパス明示度 (Sonnet)**: `compute` step の `@bomParts.partNumbers` は JSON として valid だが、配列アクセスの description が薄い。

2. **act-002 PASS 経路の TX 範囲選択 (Opus)**: `quality_inspections INSERT` を TX 内に含めるか TX 外にするかの設計選択。最終的に TX inner に含める形を選択、理由を決定事項 ADR-002 に記録。

3. **act-003 連鎖起動のパターン (Opus)**: quality.inspected イベント駆動が理想だが、EventSubscribeStep を使わず HTTP POST 同期起動として表現。spec §13.1 の Pattern を採用、将来的な非同期化の余地あり。

4. **`disposition` の値拡張余地 (Opus)**: SCRAP/REWORK/SPECIAL_APPROVAL の 3 値で固定。製造業実態では「ランクダウン採用」等の処置もあり、将来の業務要件で拡張が必要。

## Sonnet vs Opus 詳細比較

| 比較項目 | Sonnet (シナリオ #1) | Opus (シナリオ #2) |
|---|---|---|
| 自己申告問題件数 (合計) | 2 件 | 10 件 |
| schema 適合性 | ✅ schema valid (`type: "other"` workaround 採用) | ✅ schema valid (203 tests pass、仕様逐条突合で形式説明済み) |
| 拡張 step 参照形式 | `type: "other"` + description 注記 (旧形式) | `manufacturing:StepName` namespace 修飾形式 (spec §15.2 準拠) |
| spec §15.2 の扱い | spec ↔ schema 乖離を察知して workaround | spec を遵守、乖離を PR で自己申告 |
| rollbackOn 設計 | spec §8.4 準拠 (`INVALID_STATE_TRANSITION` のみ) | spec §8.4 準拠 (`DB_CONSTRAINT_VIOLATION` のみ) |
| TX runIf ガード | spec §8.3 準拠 (`@productionTxResult.committed == false/true`) | spec §8.3 準拠 (`@txResult.committed == false/true`) |
| TX 外部呼出位置 | spec §8.2 準拠 (mesSystem は TX 外) | spec §8.2 準拠 (WMS / customerNotification は TX 外) |
| ADR / decisions 記述 | 3 件 (ADR-001/002/003) | 3 件 (ADR-001/002/003) |
| testScenarios 件数 | 3 件 | 4 件 |
| eventsCatalog 件数 | 5 件 | 5 件 |
| glossary 用語数 | 10 件 | 9 件 |
| errorCatalog 件数 | 5 件 | 8 件 |
| 問題の自己申告粒度 | 低 (2 件のみ記録) | 高 (10 件を詳細分類) |
| Codex 経由 | 不使用 | 不使用 |

### 観察される傾向

**Opus の特性**:
- 問題発見・記録の粒度が高い (実装中に気づいた設計判断 10 件を詳細分類して PR description に自己申告)
- spec 遵守度が高い (rollbackOn / runIf / TX 外部呼出を最初から正しく設計、ADR 記述が充実)
- spec §15.2 の namespace 修飾形式を spec 通りに採用 (schema 側の乖離を認識しつつも spec 遵守を優先)
- 実装の自己批評能力が高く、仕様の曖昧さを PR 記述として残す

**Sonnet の特性**:
- schema レベルで安全な実装を優先 (spec ↔ schema 乖離を経験から察知して workaround)
- 問題記録の粒度は低い (自己申告件数が少ない)
- 基本設計 (TX, runIf, rollbackOn) は spec に準拠

## spec 改訂 #474 (PR #477) の実効性評価

### 効果が見えた項目

| spec 条項 | 両 AI の対応 |
|---|---|
| §8.2 外部呼出を TX 外に | 両 AI とも anti-pattern なし。Sonnet: mesSystem を TX 外。Opus: WMS/customerNotification を TX 外 |
| §8.3 TX rollback ガード | 両 AI とも `@txResult.committed == false/true` で正確にガード |
| §8.4 rollbackOn は TX inner 由来のみ | 両 AI とも発火可能なエラーコードのみ列挙 |
| §13.1 内部スケジューラ auth | Opus の act-001/act-003 で `auth: "required" + requiredPermissions: ["system"]` |
| §15.3 拡張定義の実利用必須 | 両 AI とも定義した拡張を実体使用 (未使用拡張はゼロ、ただし `qualityIncident` は将来用として例外扱い) |
| ADR 形式の decisions 記述 | 両 AI とも 3 件の decisions を MADR 形式で記録 |

### 効果が限定的だった項目

| 問題パターン | 状況 |
|---|---|
| spec §15.2 ↔ schema 乖離 | 両 AI が実装中に遭遇。spec §15.2 自体は改訂済だが schema 側が追従していない構造的問題 |
| 拡張 step の型・副作用契約 | spec で表現手段が提供されておらず、実装者が description に頼らざるを得ない |

## メタ #458 結果との比較 (金融 vs 製造)

### #458 (金融、Codex 主体、6 シナリオ)

- 全 6 シナリオで `/review-flow` + 独立レビューを実施
- Must-fix は PR 本体に解消し全シナリオでゼロ達成
- Should-fix/Nit は #473 で集約修正
- Codex 並列実装 + extensions merge conflict 解消が主な工数

### #478 (製造、Codex 不使用、2 シナリオ)

- 2 シナリオで実装後、**別セッション Sonnet による独立 `/review-flow` を初回 + 修正後の 2 ラウンド実施**
- 初回独立 `/review-flow` 検出 (合算): **Must-fix 8 / Should-fix 6 / Nit 5 = 19 件**
  - シナリオ #1 (Sonnet): Must-fix 4 / Should-fix 3 / Nit 2
  - シナリオ #2 (Opus): Must-fix 4 / Should-fix 3 / Nit 3
- 修正委譲後の再 `/review-flow`: **両シナリオで Must-fix ゼロ達成** (Should-fix 3 / Nit 4 が修正副作用として残)
- Codex 不使用でも実装 → 独立レビュー → 修正 → 再レビュー → マージの完遂を確認

### 既知パターン再発の検証 (#458 と #478 で対比)

| 既知パターン | #458 (Codex 主) | #478 Sonnet | #478 Opus |
|---|---|---|---|
| TX outputBinding ネスト参照 | あり (PR #460) | **再発** | **再発** |
| branch return 後 fallthrough | あり (#2/#5/#6) | **再発** | **再発** |
| 死コード rollbackOn | あり | **あり** | なし (改善) |
| responseRef 意味的矛盾 | — | あり | なし |
| inlineBranch.ng 欠落 | あり (#3/#6) | なし | なし |
| spec ↔ schema 乖離検出 | — | workaround で回避 | **schema invalid 発生** |

→ **spec 改訂 #474 が明文化したガイドラインのうち、TX outputBinding ネスト参照と branch return fallthrough の 2 パターンは両 AI で再発**。spec 文書化だけでは AI のミスを完全に防げないことを実証。`/review-flow` の検出ワークフローが必須。

### 比較まとめ

| 指標 | #458 (金融) | #478 (製造) |
|---|---|---|
| シナリオ数 | 6 | 2 |
| 担当 AI | Codex (主) / Sonnet (フォールバック) | Sonnet / Opus |
| spec 改訂 | 改訂前 | 改訂後 (#474) |
| 独立 `/review-flow` | 実施 | **実施 (初回 + 修正後の 2 ラウンド)** |
| schema test pass | 全件 | 全件 (203-215 件、シナリオごとに変動) |
| build pass | 全件 | 全件 |
| 独立レビュー検出問題 (修正前合算) | — | 19 件 (Must-fix 8 / Should-fix 6 / Nit 5) |
| 修正後 Must-fix | 0 | **0 (両シナリオ)** |
| Codex 不使用完遂 | 非対象 | ✅ 確認 |

## 副産物 / 派生課題

1. **spec §15.2 ↔ schema 乖離の解消** (別 ISSUE 候補):
   - spec §15.2 で謳った `namespace:StepName` 形式を schema が受容するよう `OtherStep.type` を改修するか、spec を「過渡期は `type: "other"` workaround」に書き直すかの判断が必要
   - 優先度: 高 (両 AI が実装中に遭遇するため)

2. **`UPSERT_IDEMPOTENT` のグローバル昇格**:
   - securities/manufacturing 双方の業務で必要な操作。グローバル DbOperation として定義して両 namespace から参照できるようにする設計が望ましい

3. **`qualityIncident` trigger の活用シナリオ**:
   - シナリオ #2 では未使用。将来の自動連動シナリオ (品質異常検知 → 自動 BLOCKED 処理等) で実利用可能

4. **`TraceabilityStep.metadata` 形状の正規化**:
   - PRODUCTION / INSPECTION / SHIPMENT ごとに期待される鍵が異なる。拡張 step の metadata 形状を kind 別に正規化する schema bag 設計が候補

## 結論

### 検証結果サマリ

| 評価項目 | 結果 |
|---|---|
| メタ #458 成果の他業界再現性 | ✅ 達成 (両シナリオで schema/build 全 pass、業務フロー完成) |
| spec 改訂 #474 の実効性 | ✅ 基本効果確認 (TX 設計 / rollbackOn / ADR 記述 / 拡張実利用の各観点で遵守) |
| 3 分類ルールの初運用 | ✅ 機能 (フレームワーク 4 / 拡張定義 4 / サンプル設計 4 の分類を適用) |
| Codex 抜きでの完遂 | ✅ 達成 (Sonnet/Opus ともにテスト全 pass + マージ完遂) |
| AI 別品質比較 | ✅ データ取得 (Sonnet: schema 安全重視 / Opus: spec 遵守 + 高い自己批評) |

### 一般化された知見

- **spec 改訂 (#474) の効果は部分的**: TX 外部呼出位置・rollbackOn 列挙原則・ADR 記述・拡張定義実利用の 4 観点は両 AI で改善傾向。一方で **TX outputBinding ネスト参照・branch return 後 fallthrough の 2 既知パターンは両 AI で再発**。spec 文書化だけでは AI のミスを完全には防げない。
- **`/review-flow` ワークフローが品質保証の最終防衛線**: 初回検出 19 件 → 修正委譲 → 再レビューで Must-fix ゼロ達成。spec 改訂と並行して検出・修正サイクルが必須。
- **AI 別の特性差は明確**:
  - **Opus**: spec 遵守度が高く rollbackOn / runIf / ADR 記述が初回から精確。ただし spec ↔ schema 乖離があると spec を信じすぎて schema 違反になる (シナリオ #2 で schema invalid 3 step)
  - **Sonnet**: schema レベルで安全な実装を経験から担保。spec の細かいガイドラインの遵守度は Opus より低い (修正前は死コード rollbackOn 残留等)
  - 補完関係: Opus を実装、Sonnet を独立レビュアーに使う等の使い分けが有効
- **spec ↔ schema 乖離は構造的リスク**: spec 改訂時に schema 側の追従を必須化する CI 等の仕組みがないと、実装者 (AI 含む) が実装中に遭遇し続ける。
- **Codex 抜きでも完遂可能**: Sonnet/Opus + 独立 review-flow の組合せで実装 → 修正 → マージの自律ワークフローを確認。Codex プラン上限到達時のフォールバックパスとしても有効。

## 関連

- 親メタ: #478
- 子 ISSUE / PR: #479/#481 (Sonnet)、#480/#482 (Opus)
- 前回ドッグフード (金融): #458 / `docs/spec/dogfood-2026-04-26-finance.md`
- spec 改訂: #474 / PR #477
- 3 分類ルール: memory `feedback_dogfood_issue_classification.md`

## 次フェーズへの推奨

- **spec §15.2 ↔ schema 乖離 ISSUE を別途起票** (フレームワーク問題の根本解消)
- **`/review-flow` SKILL.md に既知パターンを明示列挙** — TX outputBinding ネスト参照 / branch return 後 fallthrough を AI が事前自己チェックできるよう SKILL を強化候補
- **Phase 2** (テーブル定義 + 処理フロー連携) の準備を進めて良いタイミング
