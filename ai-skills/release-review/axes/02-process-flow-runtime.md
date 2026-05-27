# Axis 02 — process-flow runtime contract

## scope

`examples/<project>/process-flows/*.json` および `workspaces/<dogfood>/process-flows/*.json` の **実行セマンティクス** を `/review-flow` の 10 観点で全件監査。schema validate は通っても runtime 契約 (変数 lifecycle / TX / runIf / 補償 / event 双方向) を満たさないものを発見する。

`ai-skills/review-flow/SKILL.md` の 10 観点 + 18 ルールの既知パターンを ALL 適用。

## 必須 step

### 1. 対象 ProcessFlow 一覧

```bash
find examples/ workspaces/ -path "*/process-flows/*.json" -type f 2>/dev/null \
  | grep -v dogfood-1036 \
  | head -100
# 既知不要 path は除外
```

### 2. ai-skills/review-flow/SKILL.md の 10 観点を全 PF に適用

10 観点 (要約):

1. 変数 lifecycle (flowParameter / action / step / tx / loop / global) の scope と参照タイミング整合
2. TX (transactionScope) 内 step の DB I/O / 失敗時 rollback target
3. runIf 条件式の型 (boolean になるか) と参照 variable の lifecycle
4. 補償 (compensation) ペアの整合 (commit 系 step と rollback 系 step の対応)
5. event 双方向 (publish ↔ subscribe) の topic / payload schema 一致
6. response 分岐 (success / error / not_found 等) と outcome / errorMessage の整合
7. http / api 呼出の retry policy / timeout / idempotency-key 設計
8. workflow approval step の approvers / quorum / role 整合
9. cdc / batch / scheduled の destination + captureMode 妥当性
10. inputs/outputs の StructuredField 型と次 step 参照型の整合

詳細は `ai-skills/review-flow/SKILL.md` を直接読む。

### 3. 既知 pitfall 18 種の grep

`feedback_processflow_known_pitfalls_retail_2026_05_02.md` (memory 参照、AI からは直接 read 不可なら以下を流用):

- conv 参照リテラル化 (`@conv.X` を文字列リテラルに展開してしまう)
- JSON 内 kind 重複 (同 step 内に kind 2 つ)
- `screenTransition` と `httpRoute` の衝突
- `nextSeq()` 採番不能
- `rollbackOn` 欠落
- `lineage.purpose` 誤り
- loop 同名衝突
- 複数文 SQL (1 step に複数 SQL 詰込)
- ...

### 4. 各 PF を実行コンテキストで mental simulation

各 PF を 1 件読みながら:

- 開始 (action invoke) → step 1 → ... → 終了 まで mentally execute
- 各 step での変数定義 / 参照 / 上書きを stack 追跡
- 例外パス (response='error' 等) も同様に simulate

具体的 bug 検出:

- step N で参照する変数が step (N-1) までに定義されていない
- TX 内で `rollbackOn` 指定されていない step が失敗したら整合性が崩れる
- `runIf: "@var.x === 'A'"` が false なら以降 step が変数未定義状態で走る

### 5. 横断: examples / workspaces の network effect

複数 PF 間で:

- `commonProcess` の `refId` が存在しない PF
- `screenTransition.target` が存在しない screen
- `event.publish` topic に対する `subscribe` が存在しない (or 逆)

## 出力 format

各 finding を findings.jsonl に append (Axis 01 の format 同じ、`axis="02-process-flow-runtime"`)。

`evidence_paths` には対象 PF の path を必ず入れる。

## classification 指針

- PF JSON の内容修正 (変数名 typo / step kind 誤り / 参照先 fix) → **issue** (canonical example は慎重に、人間レビュー要)
- 同パターン (例: dashboard-kpi-summary.json の typo を 5 PF に展開) → **issue** で 1 集約 (鉄則 3 同根)
- spec md の例コードが古い → **auto-fix**
- schema 側に新規 step kind が必要 → **spec-pending**

## 完了判定

10 観点 × 対象 PF 全件を 1 巡走査し、新規 finding が前回 round より減って 0 件で `completed`。
