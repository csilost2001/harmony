# Axis 03 — type contract integrity

## scope

TS 型の **brand drift / cast hack / `as any` / 不適切 `unknown` の濫用** を全 grep + sabotage で検出。型レベル regression gate の機能性を実機で verify。

## 必須 step

### 1. cast hack の全 grep

```bash
# `as any` (must-fix 級)
grep -rnE "\bas\s+any\b" frontend/src backend/src 2>&1 | grep -vE "// (eslint-disable|expected|fixme).*as any" | head -50

# `as unknown as <SomeType>` (legacy migration pattern、解消できるか check)
grep -rnE "as\s+unknown\s+as\s+\w+" frontend/src backend/src 2>&1 | head -50

# `as <SomeBrandType>` で UUID string を brand に強引キャストしているもの
grep -rnE '"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"\s+as\s+\w*Id' frontend/src backend/src 2>&1 | head -30
```

### 2. brand 型 sabotage で gate を verify

```bash
cd frontend
# 1. base brand 縮退 sabotage
cat > /tmp/sabotage-base.patch <<EOF
--- a/src/types/v3/common.ts
+++ b/src/types/v3/common.ts
@@ -40,1 +40,1 @@
-export type EntityId = Brand<string, "EntityId">;
+export type EntityId = Brand<string, "Uuid">;
EOF
git apply /tmp/sabotage-base.patch
npx tsc --noEmit -p tsconfig.test.json 2>&1 | head -5
git apply -R /tmp/sabotage-base.patch
# 期待: TS2578 unused @ts-expect-error が出る (gate が functional)
# 出なければ gate が壊れている → issue
```

(複数 sabotage variant を試す。詳細は #1353 5 巡目 review log 参照)

### 3. `unknown` の濫用検出

```bash
# function 引数 / 戻り値 で `unknown` を使っている箇所
grep -rnE ":\s*unknown(\s*\)|\s*[,;]|\s*=>)" frontend/src backend/src 2>&1 | head -50
# 大半は legitimate (boundary 型) だが、関数内部での `as unknown` 経由 narrowing は要 review
```

### 4. discriminated union の exhaustive check 漏れ

```bash
# switch (x.kind) で default / never assertion 無いもの
grep -rnE "switch\s*\(.*\.kind\s*\)" frontend/src backend/src 2>&1 | head -30
# 各 hit を Read で確認、`default:` or `_: never = x; throw ...` パターンが無ければ issue
```

### 5. process-flow.ts / screen-item.ts の Step / Effect 型と schema の `kind` enum 完全一致

```bash
# TS 側
grep -nE "kind:\s*\"[a-zA-Z]+\"" frontend/src/types/v3/process-flow.ts | head -30
# schema 側
jq -r '..|.kind?|.enum?//empty' schemas/v3/process-flow.v3.schema.json | sort -u
# diff
```

### 6. `null` vs `undefined` の境界

```bash
# Optional field を意図しているのに `: T | null` になっている (schema は通常 `optional`)
grep -rnE ":\s*\w+\s*\|\s*null\b" frontend/src/types/v3/ 2>&1 | head -30
```

## 出力 format

各 finding は findings.jsonl に append。`evidence_paths` には sabotage patch / TS gate test の path も含める。

## classification 指針

- `as any` 解消 (型付け or @ts-expect-error 化) → **issue** (実装変更を伴う)
- 未使用 `as unknown as` キャスト削除 → **auto-fix** (純粋削除なら 1-2 行)
- brand 型 sabotage gate が壊れている → **issue** (regression gate 強化、優先 high)
- discriminated union exhaustive 化 → **issue**
- `: T | null` → `?: T` の修正 → **issue** (API 変更扱い、慎重)
- schemas/v3/*.json の新 enum 値追加 → **spec-pending**

## 完了判定

cast / unknown / brand drift / exhaustive 抜けの 4 観点を 1 巡し、新規 0 件で `completed`。

## 注意

過去 #1353 review log で:

- ScreenId vs TableId の brand sabotage は捕捉できたが、ViewId / ViewDefinitionId / SequenceId / ProcessFlowId / PageLayoutId / ProjectId の narrow discriminator 取り違えは v3-types.test.ts では検出されないことが Nit として記録されている (`feedback_unified_review_prompt_for_multi_ai.md` 関連)
- 本軸 round 2 以降で「n^2 ペア完全網羅」を assert する追加 test を提案する候補

本軸は brand 系の hygiene を集中的に上げる。
