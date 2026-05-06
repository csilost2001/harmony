# Schema v3 Dogfood Round 3 評価レポート (#529, manufacturing)

| 項目 | 値 |
|---|---|
| ISSUE | #529 (Round 3) |
| 実施日 | 2026-04-28 |
| 対象 | PR #526 (#525) で F-1/F-2/F-4 fix 後の `schemas/v3/`、Round 1 (retail) + Round 2 (finance) で未使用要素の検証 |
| サンプル所在地 | `docs/sample-project-v3/manufacturing/` |
| AJV 検証 | `frontend/src/schemas/v3-samples.test.ts` (14 tests, 全 pass) |
| 担当 | Opus (主) + Sonnet (1 件: 月次棚卸締め) |
| 前提 | Round 2 後「90-95% 完成度」と評価したが PR #528 レビューで「85-90% 妥当」に下方修正済 |

---

## 1. スコープ・成果物

`docs/sample-project-v3/manufacturing/` に Round 1/2 未使用要素を網羅検証する第 3 業界 sample 一式:

| 種別 | ファイル | 件数 | Round 1/2 未使用要素を含むか |
|---|---|---|---|
| Project | `project.json` | 1 | (なし) |
| Sequence | `sequences/28e5b81c-...json` (production_order_seq) | 1 | ✅ **Sequence** (Round 1/2 未使用) |
| Table | `tables/` (items/boms/production_orders/inventory_snapshots/quality_inspections) | 5 | ✅ **TriggerDefinition (BEFORE/AFTER)**、**DefaultDefinition (4 kind)**、**self-referencing FK 系**（boms→items × 2 FK）|
| Screen | `screens/67cf4447-...json` (製造指示作成) | 1 | (なし) |
| Layouts | `layouts/screen-layout.json` + `layouts/er-layout.json` | 2 | ✅ **screen-layout.v3** + **er-layout.v3** (Round 1/2 未使用) |
| ProcessFlow (Opus) | `process-flows/8210362d-...json` (製造指示生成) | 1 | ✅ **LoopStep collection mode**、Sequence 連動 INSERT、DefaultDefinition |
| ProcessFlow (Sonnet) | `process-flows/e3a68880-...json` (月次棚卸締め) | 1 | ✅ **`meta.kind="scheduled"`**、**ClosingStep**、**CdcStep + CdcDestination(auditLog)** |
| Extension | `extensions/manufacturing.v3.json` | 1 | (なし、既存 stepKinds 機構と同じ) |
| **合計** | — | **12** | **6 領域すべて未使用要素を含む** |

検証: `npx vitest run src/schemas/v3-samples.test.ts` — 14 test 全 pass (project/tables/screens/process-flow/extension/sequence/screen-layout/er-layout の 8 schema 横断)。

---

## 2. Round 1/2 未使用 schema 要素の実機検証結果

| 要素 | 使用箇所 | 結果 | 所感 |
|---|---|---|---|
| **`Sequence`** + `conventionRef` + `usedBy: TableColumnRef[]` | 製造指示番号採番 sequence | ✅ 自然に書ける、TableColumnRef で利用先カラムを宣言 | 採番運用と DB Sequence 連携が schema 上で表現可、loader 実装で `@conv.numbering.*` 解決すれば良い |
| **`TriggerDefinition`** (BEFORE/AFTER + INSERT/UPDATE/DELETE/TRUNCATE + whenCondition) | quality_inspections (audit / immutable enforcement の 2 trigger) | ✅ trg-qi01 (AFTER INSERT 監査) + trg-qi02 (BEFORE UPDATE/DELETE で result='pass' を block) で Trigger 機構をフル活用 | PL/pgSQL 等の DB 方言依存 body は string で持つだけで loader は無関与、schema 役割は明確 |
| **`DefaultDefinition`** (literal / function / sequence / convention の 4 kind) | items (4 default) + production_orders (3 default) | ✅ 4 kind すべて使用、kind="sequence" で production_order_seq 連動 | `Column.defaultValue` (string short) と `DefaultDefinition` の使い分けは schema 上両方許容 — どちらを正にするかは運用ガイド次第 |
| **`LoopStep` collection mode** + `outputBinding.operation="push"` | 製造指示生成 step-06 (BOM 行を反復、bomComponents に push) | ✅ 反復処理を構造化表現可、initialValue で初期化、collectionItemName で内部変数 | 一発で書けた。LoopStep の 3 loopKind (count/condition/collection) のうち collection が dogfood で最も使う |
| **`ClosingStep`** (period="monthly" + idempotencyKey + rollbackOnFailure) | 月次棚卸締め (Sonnet) | ✅ 直感的に書ける | Sonnet 報告: 「`cutoffAt` の format 制約欠如」を発見 → **R3-2** |
| **`CdcStep`** + `CdcDestination.kind="auditLog"` | 月次棚卸締め (Sonnet)、inventory snapshot capture | ✅ tableIds + captureMode + destination の 3 必須要素を素直に書ける | Sonnet 報告: 「`captureMode: full / incremental` の使い分け基準が schema コメントにない」(運用ガイドで補完可、Should-fix ではない) |
| **`meta.kind="scheduled"`** | 月次棚卸締め | ✅ HTTP route 省略 + `trigger="auto"` で cron フローを表現 | Sonnet 報告: 「`scheduled` の場合に `httpRoute` 禁止の schema 強制がない」→ **R3-3** |
| **`screen-layout.v3`** | 製造指示画面の position | ✅ Designer 専用座標 schema が独立しており業務情報と分離 | Round 1/2 で省略していたのは正しかった (業務情報には不要) |
| **`er-layout.v3`** + `LogicalRelation` (cardinality: many-to-many) | manufacturing/layouts/er-layout.json | ✅ 5 table の position + boms→items の many-to-many logicalRelation | self-referencing 系を logical 表現できる、ER 図エディタの入力 schema として十分 |
| **self-referencing 系 FK** (boms→items × 2 FK: parent + child) | boms テーブル | ✅ 同 items テーブルへ 2 つの FK、CHECK 制約 (parent <> child) で自身を子にできない | schema レベルでは特別扱い不要、通常 FK の集合で表現可 |

---

## 3. 3 分類別 件数集計 (Round 1/2/3 比較)

memory `feedback_dogfood_issue_classification.md` 準拠:

| 分類 | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| **フレームワーク** (schema 自体の改善) | 4 件 (F-1/F-2/F-3/F-4) | 0 件 | **3 件 (R3-1 / R3-2 / R3-3)** ⚠️ |
| **拡張定義** (extensions.v3 の改善) | 2 件 (容認 / v3.1 候補) | 0 件 | 0 件 |
| **サンプル設計** (記述ミス系) | 2 件 (placeholder UUID / F-2 関連) | 0 件 | 0 件 |

### Round 3 で検出された 3 件のフレームワーク改善

#### R3-1: `valueFrom.flowVariable.variableName` の Identifier 制約による object field 参照不可

- **現象**: 製造指示画面で `valueFrom: { kind: "flowVariable", variableName: "createdOrder.order_number" }` と書こうとしたが、`Identifier` ($defs/Identifier) のパターン `^[a-z][a-zA-Z0-9]*$` がドット非対応で AJV reject
- **発見**: Opus が製造指示画面作成時に踏んだ。AJV エラーで気付き、`expression` 形式 (`{ kind: "expression", expression: "@createdOrder.order_number" }`) で workaround
- **影響**: INSERT RETURNING で取得した object 変数の特定 field を screen に出すケース (頻出) で `flowVariable` 短縮形を使えない
- **修正案 (要設計者承認)**:
  - **案 A**: `variableName` の制約を `Identifier` から「Identifier (.field)*」のパターンに緩和 (`^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`)
  - **案 B**: `valueFrom.flowVariable` に optional `path` フィールドを追加 (`{ kind: "flowVariable", variableName: "createdOrder", path: "order_number" }`)
  - **推奨**: 案 A (実装も loader 側で `.split('.')` するだけで済む、UI 側の変更も小さい)
- **影響範囲**: schemas/v3/screen-item.v3.schema.json 1 ファイル

#### R3-2: `ClosingStep.cutoffAt` の format 制約欠如

- **現象**: Sonnet が月次棚卸締め作成時に `cutoffAt: "23:59:59"` と書いたが、`HH:MM` (例: "23:59") も同じく schema 上 valid。実装側で format ばらつきが発生する余地
- **発見**: Sonnet が schema 検証時に「description には例 23:59:59 とあるが pattern/format が無い」と指摘
- **影響**: ClosingStep 実装間で cutoffAt 解釈が分かれる (実害は小、operational guide で補完可)
- **修正案**: `cutoffAt` に `pattern: "^\\d{2}:\\d{2}(:\\d{2})?$"` を追加、または `format: "time"` (ajv-formats が要登録)
- **影響範囲**: schemas/v3/process-flow.v3.schema.json 1 ファイル
- **重要度**: **Should-fix** (運用ガイドで補完可だが schema 側 fix が clean)

#### R3-3: `meta.kind="scheduled"` + `Action.httpRoute` の不整合チェック欠如

- **現象**: Sonnet が月次棚卸締め (kind="scheduled") を書いたが、誤って Action.httpRoute を書いてもバリデーション通過した
- **発見**: Sonnet が「scheduled なら httpRoute 禁止の強制が無い」と指摘
- **影響**: cron フローに HTTP route を書いてしまう実装ミスが schema で防げない
- **修正案**:
  ```jsonc
  // process-flow.v3.schema.json root に if/then 追加
  "if": { "properties": { "meta": { "properties": { "kind": { "const": "scheduled" } } } } },
  "then": {
    "properties": {
      "actions": {
        "items": { "properties": { "httpRoute": false } }
      }
    }
  }
  ```
- **影響範囲**: schemas/v3/process-flow.v3.schema.json 1 ファイル
- **重要度**: **Should-fix** (実害は実装時に気付くが、schema で構造的に防ぐ方が安全)

---

## 4. v3.0 確定可否判定 (Round 3 結果反映)

### 判定: **v3.0 確定の前に R3-1/R3-2/R3-3 修正を推奨 (v3.0.2 として fix)**

Round 2 後の判定「v3.0 確定可能 (RC 状態)」は **撤回**。Round 3 で 3 件のフレームワーク改善 (うち R3-1 は実用上のはまり所、R3-2/R3-3 は構造的検証強化) が見つかったため、TS 型同期着手前に v3.0.2 として fix することを強く推奨。

### 理由

- **TS 同期は schema を正として 7 ファイル + zod 設計の作業** = 後から R3-1 を fix すると TS 型を書き直し
- R3-1 (`valueFrom.flowVariable.variableName`) は実機ではまったので fix 必須。R3-2/R3-3 は Should-fix だが TS 同期前なら fix のコストは低い
- Round 3 で「Round 1/2 で**未使用だった schema 要素**」を初めて検証したため新規 finding が出るのは想定内 — 既知 limitation の確認、Round 4 (例: healthcare) で 0 件継続なら確定

### 完成度評価 (改訂)

- Round 1 後: 70-75% (β)
- Round 2 後: 85-90% (RC 候補) ← PR #528 レビューで下方修正
- **Round 3 後: 80-85% (R3-1/R3-2/R3-3 fix 後に 90-95% に到達)**

R3-1〜R3-3 fix で 90-95%、Round 4 (manufacturing 以外の異質業界) で 0 件継続が見られたら 95% 以上 = TS 同期着手可能。

---

## 5. v3.1 候補 6 項目の Round 3 後の判定

| # | 候補 | Round 1 | Round 2 | Round 3 | 最終 |
|---|---|---|---|---|---|
| 1 | ProcessFlow root 4 セクション化の認知負荷 | 容認 | 容認 | 容認 (LoopStep 含む製造指示生成も書きやすい) | **容認 (確定)** |
| 2 | `context.health` / `readiness` / `resources` 位置 | 保留 | 保留 | 保留 (manufacturing でも未使用) | **保留 (容認)** |
| 3 | 拡張機構 1 ファイル統合の限界 | 容認 | 容認 | 容認 (manufacturing.v3.json も <200 行) | **容認 (確定)** |
| 4 | Step.oneOf 22 variant の AI/validator 認知負荷 | 容認 | 容認 | 容認 (LoopStep collection mode 一発で書けた) | **容認 (limitation 文書化済)** |
| 5 | ValidationStep.conditions と rules の同居 | 容認 | 容認 | 容認 | **容認 (確定)** |
| 6 | 拡張機構の object/array 不統一 | v3.1 候補 | v3.1 候補 | (manufacturing でも気にならず) | **v3.1 持ち越し (低優先度)** |

---

## 6. 後続 ISSUE 優先順位 (Round 3 結果反映)

| 優先度 | ISSUE | 状態 |
|---|---|---|
| **完了** | dogfood Round 1 (retail) | #523 PR #524 |
| **完了** | F-1/F-2/F-4 fix | #525 PR #526 |
| **完了** | dogfood Round 2 (finance) | #527 PR #528 |
| **完了** | dogfood Round 3 (manufacturing) | **本 PR** |
| **次 (新規 ISSUE 起票)** | **R3-1/R3-2/R3-3 fix** (schema 修正、governance §7 設計者承認) | TS 同期前の必須前提 |
| **その後** | TS 型同期 (`frontend/src/types/`) | R3 fix 後 |
| **オプション** | dogfood Round 4 (healthcare 等) | R3 fix 後 + TS 同期着手判断 |
| **中** | sample 全件 v3 化 (残 retail 0003/0004) | TS 同期と並行可 |
| **中** | validator 切替 (referentialIntegrity / sqlColumnValidator / loadExtensions / conventionsValidator) | TS 同期後 |
| **中** | spec 文書 v3 反映 (`docs/spec/process-flow-*.md` 14 件) | 並行可 |
| **低** | UI コンポーネント v3 同期 (30+ ファイル) | TS 同期完了後 |
| **将来 (v3.1)** | 拡張機構 object/array 不統一吸収 | 低優先度 |

---

## 7. 結論

- **Round 3 で 3 件のフレームワーク改善 (R3-1/R3-2/R3-3) を検出**、Round 1/2 で未使用だった schema 要素 (Sequence / TriggerDefinition / DefaultDefinition / LoopStep collection / ClosingStep / CdcStep / scheduled / screen-layout / er-layout / self-FK) を網羅検証
- **v3.0 確定判定は Round 2 から後退**、R3-1〜R3-3 を v3.0.2 として fix してから TS 同期推奨
- 完成度: **80-85% (R3 fix 後に 90-95%、Round 4 で 95%+)**
- **Round 3 をやって良かった** — Round 1/2 だけで TS 同期着手していたら R3-1 はまる所だった

### PR #530 独立レビュー (Sonnet) で追加検出 — 依然多くの未使用 variant が残る

Round 3 後でも以下は **0 use のまま**:

- BranchCondition: `tryCatch` / `affectedRowsZero` / `externalOutcome` (3/4 未使用)
- Step kind: `screenTransition` / `displayUpdate` / `eventSubscribe` / `jump` / `loopBreak` / `loopContinue` / `commonProcess` (7 件)
- LoopKind: `count` / `condition` (2/3 未使用)
- WorkflowPattern: 10/11 未使用 (`approval-sequential` のみ使用)
- Context: `health` / `readiness` / `resources` 未使用
- StepBaseProps: `txBoundary` / `compensatesFor` (Saga 系) 未使用
- CdcDestination: `eventStream` / `table` (2/3 未使用)

新業界 sample で全部カバーは過剰。**現実的な対応**:

- **A: 未使用 variant の AJV fixture テスト拡充** — 業務文脈なしで構造的バリデーション網羅 (推奨、~1 日)
- **B: Round 4 (新業界、例: healthcare)** で**意図的に未使用 variant を使う設計** — 1 業界で複数カバー
- **推奨**: A 先 → 必要なら B

### 次の手 (確定版)

1. **R3-1/R3-2/R3-3 schema fix ISSUE 起票** (governance §7 設計者承認、別 ISSUE)
2. **未使用 variant AJV fixture 拡充 ISSUE 起票** (案 A、別 ISSUE) — Round 4 やる前に構造的網羅性を上げる
3. これらが完了したら TS 同期着手、または Round 4 を判断

「Round 3 をやってから A」という判断は正解だった。Round 2 で確定判断していれば R3-1 は TS 同期途中で発覚した。Round 3 後の「未使用 variant fixture 拡充」が次の現実解。
