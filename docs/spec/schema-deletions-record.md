# Schema 削除事項記録 (Phase X1-X3 で取り下げられた提案 + 削除された field)

Issue: [#1254](https://github.com/csilost2001/harmony/issues/1254) (RFC) / [#1263](https://github.com/csilost2001/harmony/issues/1263) (実装)
策定日: 2026-05-23
ステータス: **記録のみ** (将来 dogfood で同種の case が再発した時の判断材料)

`#1254` で 3 AI 議論を経て **不採用** になった提案と、`#1263` Phase X1-X3 で **schema 削除** された field を記録する。schema 変更を伴わない削除事項として spec doc に明文化する目的。

---

## §1 件 6 (B-1 / B-6 / B-4) 不採用 (Phase X2-X3 共通)

### B-1: Step kind core 4 縮約 (`data` / `control` / `compute` / `effect`) — **不採用**

- 提案: 現 24 step kind 列を `data` (dbAccess / externalSystem / aiCall 統合) / `control` (branch / loop / transactionScope) / `compute` / `effect` (eventPublish / system) の 4 種に縮約
- **不採用理由**:
  - intent-rich semantics の喪失 (kind 列が薄まると AI 生成精度が下がる)
  - 二段 kind (meta.flowType + step.kind) 問題の解消にはならず、step 内部の `kind 拡張 enum` に移動するだけ
  - Step 固有 validator (`processFlowAntipatternValidator` / `referentialIntegrity` 等) が kind 別 dispatch を失う
- 3 AI R3 全員反対、user 裁定で不採用

### B-6: BPMN 風 graph + state machine 化 — **不採用**

- 提案: 現行 linear+branch+loop モデルを BPMN graph + state machine に振り切る
- **不採用理由**:
  - AI codegen 契約との相性悪 (graph → code 変換は AI 推論精度が低い)
  - visual editor 必須化 (人間が graph を手書きするのは現実的でない)
  - 既存 linear+branch+loop モデルの AI 親和性 (Markdown spec → JSON 変換) を喪失
- 3 AI R3 全員反対、user 裁定で不採用

### B-4: `kind=screen` ProcessFlow の物理分離 — **不採用**

- 提案: `kind=screen` を別 resource type ("screen-bound action group") として独立
- **不採用理由**:
  - `#1019` で逆方向の統合経緯がある (action group → ProcessFlow に統合)
  - 論理境界明示は既存 `flowType=screen` で十分 (新 resource type 不要)
- user 裁定で不採用

---

## §2 `actionProfile` 削除 (Phase X2 で確定)

- 提案: `semanticProfiles` の action-level alias として `actionProfile` (wizard / report / CRUD / batch / integration / notification / search / ai-orchestration) を採用 (件 1 派生)
- **2026-05-23 user 壁打ち + 3 AI 議論で全面撤回**:
  - 上位 (Screen / view-definition / flowType) または下位 (step kind) で既に正規表現がある
  - action level 固有 profile が 1 件も挙げられない (上位/下位で表現済)
  - TX 境界は step グループ単位の事実、action level で `profile=transactional-write` を持っても「どの step グループに TX 必須か」は判定不能 (粒度誤り)
  - `/generate-code` の template (scaffold) 選択は flowType + step kind 列 + screen 仕様で閉じる、action profile は二重管理
  - 将来 action 種類別 contract (idempotency / rate limit 等) が必要になったら **専用 field** で前倒しなしに追加 (enum 予測列挙より dogfood 駆動)
- 復活トリガー: `#1265` S-8 で記録

---

## §3 `lineage` field 削除 (Phase X3 / #1254 件 5)

- 提案: 現行 `StepBaseProps.lineage` (`DataLineage` $def) を削除
- **削除理由**:
  - 重複情報 (DB アクセスの reads / writes は SQL AST 解析で完全復元可能)
  - 保守コスト高 (examples 全件で reads/writes を手書きしていた、SQL と二重管理)
  - SQL が canonical なら lineage は派生情報として validator / AST 解析で生成可能
- 3 AI R3 Option E、user 裁定で削除確定
- 影響範囲:
  - `schemas/v3/process-flow.v3.schema.json`: `StepBaseProps.lineage` + `DataLineage` $def + `LineageEntry` $def 削除
  - `frontend/src/types/v3/process-flow.ts`: `LineageEntry` / `DataLineage` interface + `StepBaseProps.lineage` 削除
  - examples 全 33 ファイル: 90 lineage block 削除 (機械 migration)
- 復活トリガー: SQL AST 解析 validator が未実装の段階で「特定 example の lineage が必要」と判明したら再検討 (`#1265` ストック予定)

---

## §4 個別 step variant の inline 失敗系 field 集約 (Phase X3 / #1254 件 2)

- 個別 step variant に inline 配置されていた失敗系 field を `StepBaseProps.errorHandling` object に集約 (案 D):
  - ExternalSystemStep の `outcomes` / `retryPolicy` 削除
  - AiCallStep / AiAgentStep の `outcomes` 削除
  - TransactionScopeStep の `outcomes` / `rollbackOn` 削除
- 集約後の構造: `errorHandling: { outcomes?, rollbackOn?, retryPolicy?, onTimeout? }`
- 効果:
  - Schema 認知 simple (浅 nest、4 field を 1 object に統合)
  - UI lifecycle 順表示が容易 (pre `runIf` → main → post `errorHandling`)
  - step kind に応じて意味のある subset のみ使用 (validator が semantic 妥当性を判定)

---

## §5 関連

- 親 RFC: [#1254](https://github.com/csilost2001/harmony/issues/1254)
- 実装: [#1263](https://github.com/csilost2001/harmony/issues/1263) Phase X1-X3
- 撤廃制限ストック: [#1265](https://github.com/csilost2001/harmony/issues/1265)
- 復活判断: dogfood で同種 case が再発した場合、本記録 + #1265 を参照

## §6 変更履歴

- 2026-05-23: 初版作成 (#1263 Phase X3 — RFC #1254 件 6 + 件 2 + 件 5 削除事項を記録)
