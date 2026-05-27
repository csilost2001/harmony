# Axis 06 — test coverage gap

## scope

vitest / playwright spec の **網羅率と質** を確認。public function に対する unit test の有無、e2e の click-path 抜け、test の偽陽性 (skip / 弱い assertion / 不適切 expect)。

## 必須 step

### 1. vitest 全 spec の一覧

```bash
find frontend/src backend/src -name "*.test.ts" -o -name "*.test.tsx" 2>/dev/null | wc -l
# 対応する非 test ファイル数
find frontend/src backend/src -name "*.ts" -o -name "*.tsx" | grep -v test | wc -l
# 比率を見る
```

### 2. public export と test の対応

```bash
# 各 .ts の export を列挙
grep -rnE "^export (async )?function" frontend/src/store/ frontend/src/utils/ backend/src/ 2>&1 | head -100
# 対応する test 内 import / describe を grep
```

特定 store / util に対して test が無い / test が 1 件しかない / happy path のみで edge case を assert していない、を検出。

### 3. test 内の skip / fixme / todo

```bash
grep -rnE "(it|test|describe)\.skip|\.skip\(|skipIf|test\.fixme" frontend/src backend/src 2>&1 | head -30
# 過去 #1299 で test.skip + 別 ISSUE 化が鉄則 0 違反として記録 (feedback_completion_blocker_weak_assertions.md)
```

skip / fixme / todo 化された test が release blocker かどうか個別判定。

### 4. 弱い assertion の grep

```bash
# `not.toBe(error)` 等 (実質的に何も verify しない)
grep -rnE "not\.toBe\(|not\.toEqual\(.*null\)|not\.toBeUndefined" frontend/src/**/*.test.* backend/src/**/*.test.* 2>&1 | head -30
# `expect(x).toBeDefined()` のみ (中身を見ていない)
grep -rnE "expect\([^)]+\)\.toBeDefined\(\)" frontend/src/**/*.test.* backend/src/**/*.test.* 2>&1 | head -30
```

### 5. playwright e2e spec の click-path 網羅

```bash
ls frontend/e2e/*.spec.ts | head -30
# 主要 UI 画面 (画面一覧 / 画面フロー / 処理フロー / テーブル定義 / 等) に対する spec の有無
```

`AGENTS.md` の Tab policy 表に列挙された各 view に対し、最低 1 e2e spec が存在するか:

```
DashboardView / FlowEditor / ScreenListView / Designer / ScreenItemsView / TableListView /
TableEditor / ErDiagram / ProcessFlowListView / ProcessFlowEditor / SequenceListView /
SequenceEditor / ViewListView / ViewEditor / ViewDefinitionListView / ViewDefinitionEditor /
PageLayoutListView / PageLayoutEditor / PageLayoutDesigner / GadgetListView /
GenericDefinitionCatalogView / GenericDefinitionListView / GenericDefinitionEditor /
ExtensionsPanel / ConventionsCatalogView / TechStackView / WorkspaceListView /
WorkspaceSelectView / CodexSettingsView
```

### 6. AJV validate を経由しない test の検出

```bash
# AJV を import している test
grep -rl "ajv\|Ajv\|validate.*schema" frontend/src/**/*.test.* backend/src/**/*.test.* 2>&1 | head -20
# AJV 経由しない fixture builder が schema 違反を許容する余地
```

### 7. tsconfig.test.json の include スコープ

```bash
cat frontend/tsconfig.test.json
# 過去 #1353 で v3-types.test.ts + src/test のみが typecheck 対象、他 .test.tsx は対象外と確認済
# 他 test file への include 拡張要否を評価
```

## 出力 format

findings.jsonl に append。`evidence_paths` には対象 test file path / 対応 source file path を必ず含める。

## classification 指針

- skip / fixme 化されている test を解除 / 修正 → **issue** (test 動作変更、review 要)
- 弱い assertion を強い assertion に → **issue**
- 不足 test の追加 → **issue**
- tsconfig.test.json の include 拡張 → **issue** (build config 変更、影響範囲評価要)
- test JSDoc / コメント追加 → **auto-fix**
- e2e spec の新規追加 → **issue**

## 完了判定

vitest spec 一覧 / e2e spec 一覧 / skip-fixme 一覧 / 弱い assertion / 主要 view e2e の 5 領域を 1 巡し、findings.jsonl 0 件追加で `completed`。
