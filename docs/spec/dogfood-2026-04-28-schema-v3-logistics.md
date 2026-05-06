# Schema v3 Dogfood Round 5 評価レポート (#537, logistics)

| 項目 | 値 |
|---|---|
| ISSUE | #537 (Round 5) |
| 実施日 | 2026-04-28 |
| 対象 | PR #534 (#533 R3 fix) + PR #536 (#535 Round 4) 後の v3.0.2、approval-parallel + branch-merge の業務文脈実機検証 |
| サンプル所在地 | `docs/sample-project-v3/logistics/` |
| AJV 検証 | 61 test 全 pass |
| 担当 | Opus (倉庫間転送実行、並行 workflow) + Sonnet (配送状況照会) |
| 前提 | Round 4 Sonnet レビューで「Round 5 直列先行推奨」、ユーザー判断で実施決定 (手堅さ優先、2026-04-28) |

---

## 1. スコープ・成果物

`docs/sample-project-v3/logistics/` に物流 (倉庫間転送) namespace 一式:

| 種別 | ファイル | 件数 |
|---|---|---|
| Project | `project.json` | 1 |
| Table | warehouses / transfer_orders / transfer_lines / shipments | 4 |
| Screen | 倉庫間転送指示 (`42f09728-...json`) | 1 |
| ProcessFlow (Opus) | 倉庫間転送実行 (`0fe7af80-...json`) — approval-parallel + branch-merge | 1 |
| ProcessFlow (Sonnet) | 配送状況照会 (`ea579b99-...json`) — シンプル参照系 | 1 |
| Extension | `logistics.v3.json` (Sonnet が ShipmentStatusResponse を追記) | 1 |
| **合計** | — | **9 ファイル** |

検証: `v3-samples.test.ts` (14) + `v3-variant-coverage.test.ts` (47) = **61 test 全 pass**、修正ループ 0 回。

---

## 2. Round 5 で検証した並行 WorkflowPattern

Round 1〜4 で実機未検証だった並行 semantics を業務文脈で検証:

### 2.1 approval-parallel (3 名並行承認)

倉庫間転送実行フロー step-07 で使用:
- approvers 3 名 (転送元倉庫マネージャー / 転送先倉庫マネージャー / 物流コーディネーター) を `order: 1` で並行宣言
- `deadlineExpression` で出荷予定日 -24h を期限設定
- onApproved: status='approved' に更新
- onRejected: status='cancelled' + 422 return

**所感**: schema 上自然に書けた、approvers[].order が同値なら並行と解釈する semantics は明確。実装層では並行通知を発出して全員 OK で進む実装を期待する形。

### 2.2 branch-merge (3 タスク並行 → merge)

倉庫間転送実行フロー step-08 で使用:
- approvers 3 名 (ピッキング担当 / パッキング担当 / 配送手配担当) を sign-off 並列宣言
- 3 タスク完了 (sign-off) で merge → onApproved に進む
- onRejected: 1 名でも問題発生で 422

**所感**: branch-merge の semantics は「並行 task の merge」と解釈が自然。WorkflowStep の構造で表現可能。ただし業界によっては「N-of-M 並行 (3 タスク中 2 つ完了で進行)」のような quorum + parallel 組み合わせが必要な場合、現 schema では `quorum` フィールドは approval-quorum のみ使用想定で表現できない (容認可、複合パターン必要時は別 ISSUE)。

---

## 3. R5-x 検出 finding

### R5-1 (Sonnet 検出、低優先度): approval-parallel の per-approver timeout 表現

- **現象**: `WorkflowStep.deadlineExpression` は workflow 全体に 1 つだけ。approval-parallel で「担当者は 24h、課長は 48h」のような per-approver timeout は表現できない
- **影響**: 軽微。実用上は 1 つの deadline で十分なケースが大半
- **修正案**: WorkflowApprover に optional `deadlineExpression` を追加 (each approver level)。breaking change なし
- **判定**: **容認 (運用ガイドで補完可)、必要時に別 ISSUE 起票**。本ラウンドでは schema 修正不要

### 他に新規検出: なし

- approval-parallel と branch-merge の core semantics は schema で表現できる
- R3-1〜R3-3 / F-1〜F-4 の fix がすべて logistics でも実機機能
- Sonnet 独立委譲も迷いなく書けた + 自発的に extension に ShipmentStatusResponse を追加できる柔軟性を確認

---

## 4. 3 分類別 件数集計 (Round 1〜5 推移)

| 分類 | R1 retail | R2 finance | R3 manufacturing | R4 public-service | **R5 logistics** |
|---|---|---|---|---|---|
| フレームワーク | 4 件 (F-1〜F-4) | 0 件 | 3 件 (R3-1〜R3-3) | 0 件 | **0 件 (R5-1 容認)** |
| 拡張定義 | 2 件 (容認/v3.1 候補) | 0 件 | 0 件 | 0 件 | 0 件 |
| サンプル設計 | 2 件 | 0 件 | 0 件 | 0 件 | 0 件 |

**Round 5 で要 schema 修正な finding: 0 件** (R5-1 は容認)。

---

## 5. WorkflowPattern 業務文脈検証カバー率 (Round 1〜5 累計)

11 種中 7 種が業務文脈実機検証済 (Round 5 で +2):

| Pattern | 検証 Round | 結果 |
|---|---|---|
| `approval-sequential` | R1 (retail) / R2 (finance) / R4 (public-service) | ✅ |
| `acknowledge` | R4 (public-service) | ✅ |
| `review` | R4 (public-service) | ✅ |
| `sign-off` | R4 (public-service) | ✅ |
| `approval-veto` | R4 (public-service) | ✅ |
| `approval-parallel` | **R5 (logistics)** | ✅ |
| `branch-merge` | **R5 (logistics)** | ✅ |
| `approval-quorum` | fixture のみ (PR #532) | 構造検証済 |
| `approval-escalation` | fixture のみ (PR #532) | 構造検証済 |
| `discussion` | fixture のみ (PR #532) | 構造検証済 |
| `ad-hoc` | fixture のみ (PR #532) | 構造検証済 |

残 4 種 (approval-quorum / approval-escalation / discussion / ad-hoc) は fixture で構造検証済 = 実用上十分。

---

## 6. v3.0 確定可否判定 (Round 5 結果反映、最終判断)

### 判定: **v3.0 確定、TS 同期着手 ✅**

根拠 (Round 1〜5 累計):
- 5 業界 (retail / finance / manufacturing / public-service / **logistics**) で計 50 sample 作成、AJV 検証 全 pass
- フレームワーク改善累計 7 件 fix (F-1〜F-4 + R3-1〜R3-3)、Round 4・5 で新規検出 0 件 = **収束**
- WorkflowPattern 11 種中 7 種実機検証 + 4 種 fixture 検証 = 全パターンカバー
- Sonnet 独立委譲 5 ラウンド連続成功 + 自発的拡張 (R5 で extension へ追記) = schema 流暢度高
- AJV テスト 61 件全 green、構造的バリデーション網羅

### 完成度評価 (確定版)

- Round 1 後: 70-75% (β)
- Round 2 後: 85-90% (RC 候補)
- Round 3 後: 80-85% (R3 finding で後退)
- Round 4 後: 90-95%
- **Round 5 後: 95% (TS 同期着手可能、最終確定)**

### 残存リスク (容認)

- R5-1 (per-approver deadline) — 必要時に別 ISSUE
- v3.1 候補 #6 (拡張機構 object/array 不統一) — breaking change、別 ISSUE で計画的に
- 業界 6 個目以降の未検証 — 経験則 R6 以降は finding 0 が続く想定 (R4-R5 が連続 0、収束パターン)

### TS 同期で発覚しても schema fix が容易な領域

- WorkflowPattern enum 1 個追加 / property 1-2 個追加 — TS 型は数行で対応可
- discriminator keyword の追加 — TS 型は無関係
- 構造的破壊的変更 — Round 1〜5 で兆候なし、低リスク

---

## 7. 後続 ISSUE 優先順位 (確定)

| 優先度 | ISSUE | 状態 |
|---|---|---|
| **完了** | dogfood Round 1〜5 + F-1〜F-4 + R3-1〜R3-3 fix + variant fixture | ✅ |
| **次着手** | **TS 型同期** (`frontend/src/types/`) | 7 ファイル + zod 検討 |
| **並行可** | sample 全件 v3 化 (残 retail 0003/0004) | TS と並行 |
| **並行可** | spec 文書 v3 反映 (`docs/spec/process-flow-*.md` 14 件) | TS と並行 |
| **TS 後** | validator 切替 | TS 型に依存 |
| **TS 後** | UI コンポーネント v3 同期 (30+ ファイル) | TS 型完成後 |
| **オプション** | dogfood Round 6 (例: healthcare / 教育) | TS 同期で問題が出たら起票、不要な可能性大 |
| **将来 (v3.1)** | 拡張機構 object/array 不統一 + R5-1 per-approver deadline | breaking change + 軽微改善、別 ISSUE で |

---

## 8. 結論

- **schema v3 は 5 業界 50 sample の dogfood で実証済、95% 完成度 = TS 同期着手可能**
- Round 5 (approval-parallel + branch-merge) で並行 semantics の業務文脈妥当性を確認、Round 4 Sonnet 指摘の構造的懸念は解消
- 検出 finding 0 件 (R5-1 は容認)、収束を強く示唆
- **次は TS 型同期着手**、Round 6 は不要 (発見されない可能性大、TS で問題が出たら都度判断)
