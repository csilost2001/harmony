# Schema v3 Dogfood Round 4 評価レポート (#535, public-service)

| 項目 | 値 |
|---|---|
| ISSUE | #535 (Round 4) |
| 実施日 | 2026-04-28 |
| 対象 | PR #534 (#533 R3-1〜R3-3 fix) マージ後の v3.0.2、Round 1〜3 で fixture のみで業務未検証だった WorkflowPattern 4 種 |
| サンプル所在地 | `docs/sample-project-v3/public-service/` |
| AJV 検証 | `frontend/src/schemas/v3-samples.test.ts` (14) + `v3-variant-coverage.test.ts` (47) = **61 test 全 pass** |
| 担当 | Opus (主、5 段 workflow フロー) + Sonnet (1 件: 申請ステータス通知) |

---

## 1. スコープ・成果物

`docs/sample-project-v3/public-service/` に建築確認申請プロジェクト一式:

| 種別 | ファイル | 件数 |
|---|---|---|
| Project | `project.json` | 1 |
| Table | applicants / applications / application_approvals / attachments | 4 |
| Screen | 建築確認申請 (`f9de5853-...json`) | 1 |
| ProcessFlow (Opus) | 建築確認申請審査 5 段 workflow (`1cd900ee-...json`) | 1 |
| ProcessFlow (Sonnet) | 申請ステータス通知 (`72fe2c92-...json`) | 1 |
| Extension | `public.v3.json` | 1 |
| **合計** | — | **9 ファイル** |

---

## 2. Round 4 で検証した WorkflowPattern 業務文脈

Round 1〜3 で**実機サンプルで使用したのは `approval-sequential` のみ**。fixture では他 10 種を cover したが業務妥当性は未検証だった。本ラウンドで 5 段 workflow 連結フローを実機検証:

| Stage | WorkflowPattern | 業務シナリオ | 結果 |
|---|---|---|---|
| 1. 受付 | `acknowledge` | 受付担当者が申請を受領、決定権なし、記録のみ | ✅ approver 1 名、決定権なしの semantics が schema 上自然 |
| 2. 一次審査 | `review` | 担当者が建築基準法・条例適合性を判断、却下なら return | ✅ 単純承認/却下の表現として `approval-sequential` (1 名) との違いがやや曖昧、運用ガイドで補完推奨 |
| 3. 公示期間 | `sign-off` | 14 日法定公示、deadline 必須、書記が公示終了後に sign-off | ✅ `deadlineExpression` で公示期限を表現可、deadline 経過時の挙動は v3 schema レベルでは明示なし (運用が onTimeout 等で補完) |
| 4. 異議申立対応 | `approval-veto` | 利害関係者 (近隣住民代表 / 環境担当) が異議、1 件でも veto なら却下 | ✅ approvers[] が複数で、1 名の rejected が onRejected に流れる semantics は明確 |
| 5. 最終決裁 | `approval-sequential` | 担当→課長→部長 3 段承認 (Round 1〜3 の再現性確認) | ✅ Round 1〜3 と同一動作を確認、互換性 OK |

**所感**: 4 種の新 WorkflowPattern は schema 上自然に書けた。**Sonnet 報告**: 「`onApproved / onRejected` 内に dbAccess と eventPublish を入れ子にする構造の明確さが印象的、各 stage の承認/却下で何が起きるかが 1 箇所に凝縮」。

ただし Sonnet 指摘あり: **5 WorkflowStep + 15+ 通常 step が 1 ProcessFlow に並ぶと認知負荷が高い** (後半 step の文脈変数追跡が困難)。これは ADR-001 で明示済 (本サンプルは schema 検証目的、実運用ではイベント駆動分割推奨)。

---

## 3. Round 1〜3 で導入した fix の実機効果

| Fix | Round 4 での効果 |
|---|---|
| F-1 ($schema 属性) | 9 sample すべてに $schema 記述、IDE 補完が効く |
| F-2 (StepBaseProps.lineage) | 5 段 workflow で lineage を 9 step に分散使用 (writes 多用) |
| F-4 (discriminator) | BranchCondition / Constraint で focused エラー報告、新業界でも体感 |
| **R3-1 (IdentifierPath)** | Sonnet 報告: 「**表現力が大きく向上**」、`application.application_number` / `application.status` 等の object field 参照が直接 flowVariable で書ける、以前 expression 切り出しが必要だった場面が型付きで書けるようになった |
| R3-2 (cutoffAt pattern) | 本ラウンドでは出番なし (closing 不使用) |
| R3-3 (scheduled+httpRoute) | 本ラウンドの 2 PF はどちらも httpRoute あり (kind=screen/system)、不整合チェックは `kind=scheduled` のフローでのみ効くため適用なし |

---

## 4. 3 分類別 件数集計 (Round 1〜4 比較)

| 分類 | Round 1 (retail) | Round 2 (finance) | Round 3 (manufacturing) | Round 4 (public-service) |
|---|---|---|---|---|
| **フレームワーク** (schema 自体) | 4 件 (F-1〜F-4) | 0 件 | 3 件 (R3-1〜R3-3) | **0 件** ✨ |
| **拡張定義** (extensions.v3) | 2 件 (容認 / v3.1 候補) | 0 件 | 0 件 | 0 件 |
| **サンプル設計** (記述ミス系) | 2 件 | 0 件 | 0 件 | 0 件 |

**Round 4 で新規 finding: 0 件** (Sonnet も Opus も)。

---

## 5. 依然未検証 WorkflowPattern (低優先度、容認可)

Round 4 でカバーできなかった WorkflowPattern (fixture では検証済):

- `approval-quorum` (majority / nOfM): 委員会等の合議制
- `approval-escalation`: deadline 後の自動エスカレーション
- `approval-parallel`: 並列承認
- `branch-merge`: 並行 step の合流
- `discussion`: 議論型 (決定なし)
- `ad-hoc`: 即興型

これら 6 種は fixture (構造的バリデーション) で正常動作を確認済。業務文脈での使用感は未確認だが、Round 4 までの実績で **schema が想定する semantics は十分明確** と判断 (各 pattern の必須プロパティ if/then 強制も discriminator + AJV で機能)。

---

## 6. v3.0 確定可否判定 (Round 4 結果反映)

### 判定: **v3.0 確定可能、TS 同期着手推奨 ✅**

根拠:
- Round 4 で **新規 finding 0 件**、F-1〜F-4 + R3-1〜R3-3 の累計 7 件 fix 後 schema は実機で堅牢
- 4 業界 (retail / finance / manufacturing / public-service) で計 41 sample (Round 1: 7 + R2: 9 + R3: 12 + R4: 9 + 4 layouts) を実機検証、**修正ループ 0 回 (Round 2 / 4) または 軽微 (Round 3)**
- WorkflowPattern 11 種のうち **5 種は業務文脈実証済** (acknowledge/review/sign-off/approval-veto/approval-sequential)、**残り 6 種は fixture で構造検証済**
- Sonnet 独立委譲が 4 ラウンド連続で迷いなく書けている = schema が「別 AI が独立に読める」品質に到達

### 完成度評価 (改訂)

- Round 1 後: 70-75% (β)
- Round 2 後: 85-90% (RC 候補) → PR レビューで下方修正
- Round 3 後: 80-85% (R3 finding 検出で後退)
- **Round 4 後: 90-95% (TS 同期着手可能)**

### 残存リスク (TS 同期で発覚する可能性)

- v3.1 候補 #6 (拡張機構 object/array 不統一) は依然未対応 — TS 型同期時に表面化する可能性、breaking change で別 ISSUE
- WorkflowPattern 6 種が業務文脈未検証 — TS 型同期は schema 構造のみ依存、実装層で issue が出る場合は別 ISSUE で対応
- 業界 5 個目 (healthcare / 教育 / 物流 等) 未検証 — public-service と性質が異なる業界で R5-x が出る可能性は残る

---

## 7. 追加ラウンド要否の判断材料 (ユーザー相談用)

memory `project_schema_v3_2026_04_27.md` の品質評価ゲート規定 (2026-04-28 ユーザー確認): **0 件でも総合評価、対応できる問題があれば追加ラウンド可**。

### 追加ラウンドを「やる」根拠

- 残 WorkflowPattern 6 種を業務文脈で押さえれば 95%+ の自信
- 業界 5 個目 (healthcare / 教育) で発見される可能性は理論上残る
- TS 同期着手前に schema を確実に固める方が下流リワーク回避

### 追加ラウンドを「やらない」根拠

- Round 4 で新規 0 件、収束を強く示唆 (Round 1: 4 → R2: 0 → R3: 3 → R4: 0、振動はあるが下限が下がってきている)
- 残 WorkflowPattern 6 種は fixture で構造検証済 = AJV 構造的には問題なし、業務妥当性は実装層 (TS 型 / UI) で発覚しても schema 修正なしに対処可能
- TS 同期は schema 変更を最小限にできる前提で進められる
- 4 業界 41 sample は dogfood として十分豊富

### 推奨

**TS 同期着手を推奨**。Round 5 (例: healthcare) は **TS 同期と並行可能** (memory rule 通り、マージブロッカーではない)。TS 同期で schema 改善が必要と判明したら、その時点で R5 を起票して優先度判断する流れが実用的。

---

## 8. 後続 ISSUE 優先順位 (Round 4 後の確定版)

| 優先度 | ISSUE | 状態 |
|---|---|---|
| **完了** | dogfood Round 1〜4 + F-1〜F-4 fix + R3-1〜R3-3 fix + variant fixture | ✅ |
| **次着手** | **TS 型同期** (`frontend/src/types/`) | 7 ファイル + zod 検討 |
| **並行可** | sample 全件 v3 化 (残 retail 0003/0004 = 2 件) | TS 同期と並行 |
| **並行可** | spec 文書 v3 反映 (`docs/spec/process-flow-*.md` 14 件) | TS 同期と並行 |
| **TS 後** | validator 切替 (referentialIntegrity / sqlColumnValidator / loadExtensions / conventionsValidator) | TS 型に依存 |
| **TS 後** | UI コンポーネント v3 同期 (30+ ファイル) | TS 型完成後 |
| **オプション** | dogfood Round 5 (healthcare 等) | TS 同期で問題が出たら起票 |
| **将来 (v3.1)** | 拡張機構 object/array 不統一吸収 | breaking change、別 ISSUE |

---

## 9. 結論

- Round 4 で v3 schema の業務文脈妥当性が 4 業界 + 41 sample で実証、新規 finding 0 件
- WorkflowPattern 5 種が業務実証済、残 6 種は fixture で構造実証済 = 実用上十分
- **TS 同期着手可能と判断**。Round 5 は TS 同期と並行で機会を見て実施
- 完成度 90-95%、残り 5-10% は TS 同期 + 業界 5 個目で詰める範囲
