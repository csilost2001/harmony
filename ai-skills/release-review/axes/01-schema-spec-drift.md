# Axis 01 — schema-spec drift

## scope

`schemas/v3/*.json` (canonical) / `docs/spec/*.md` (人間向け仕様書) / `frontend/src/types/v3/*.ts` (TS 型) / `examples/<project>/**/*.json` (canonical サンプル) の **四重照合**。

主な検出対象:

- schema の field / pattern / required と TS 型の `interface` 定義の乖離
- spec md の言及 field / 値域と schema 実体の乖離
- examples の実 JSON が schema validate を通らない or TS 型として parse できない
- TS JSDoc が古い field 名 / 旧用語を使い続けている (#1332 M3 type fix のような状況)

## 必須 step

### 1. schema 一覧と top-level keys を網羅

```bash
ls schemas/v3/*.json
# 各 schema の $defs / required / properties を機械的に列挙
for f in schemas/v3/*.v3.schema.json; do
  echo "=== $f ==="
  jq -r '.["$defs"] // {} | keys[]' "$f"
done
```

### 2. TS 型ファイルとの cross-check

```bash
ls frontend/src/types/v3/*.ts
# 各 schema の top-level $defs と対応する TS interface があるか
# 例: schemas/v3/process-flow.v3.schema.json の "Step" → frontend/src/types/v3/process-flow.ts の Step type
```

主要照合ポイント:

- `EntityMeta` (common.v3) の required = `["id", "uuid", "name", "createdAt", "updatedAt"]` と TS interface fields の照合
- 各 entity の id field の brand 型 (`ScreenId` / `TableId` / ...) が schema の `$ref` 先と一致
- discriminated union の `kind` enum 値が両側で完全一致

### 3. docs/spec/*.md の振る舞い記述 vs schema 実体

```bash
ls docs/spec/*.md | head -30
# 各 spec md 内の "X field は Y" / "required" / "pattern" 言及を grep
grep -nE "required|optional|pattern|enum" docs/spec/*.md | head -50
# schema 側の対応定義と突合
```

### 4. examples の AJV validate

```bash
cd frontend
npx vitest run src/types/v3/v3-types.test.ts samples-v3.schema.test.ts 2>&1 | tail -20
# 失敗があれば schema drift
```

`npm run validate:samples -- ../examples/<project-id>` も走らせて runtime 契約検証 (test と別の validator)。

### 5. TS JSDoc の古い用語 grep

過去 #1332 で blind spot だったパターン:

```bash
# "対象 X の Uuid" 系の旧用語が残っていないか
grep -rnE "対象.+の\s*[Uu]uid|→\s*Uuid|: Uuid\b" frontend/src/types/v3/ docs/spec/ 2>&1 | grep -v "uuid:" | head -30

# "Brand<Uuid, ..." (intersection が never に潰れる古い brand パターン)
grep -rnE "Brand<Uuid," frontend/src/ backend/src/ 2>&1
```

### 6. schemas/v3/README.md と各 schema の $defs 列挙突合

README に列挙されている型一覧が実 schema と一致しているか:

```bash
grep -oE "EntityId|EntityMeta|Uuid|LocalId|Identifier|...|TestAssertion" schemas/v3/README.md | sort -u
# 各 schema の $defs と diff
```

## 出力 format

各 finding を findings.jsonl に append:

```json
{
  "axis": "01-schema-spec-drift",
  "round": <N>,
  "severity": "must|should|nit",
  "classification": "spec-pending|issue|auto-fix",
  "file": "path:line",
  "title": "<軸内で unique な短い見出し>",
  "body": "<該当 schema / TS / md / example の差分内容、再現コマンド、推奨 fix>",
  "fix_diff": "<auto-fix 時のみ>",
  "evidence_paths": ["..."],
  "discovered_at": "<ISO>"
}
```

## classification 指針 (本軸特化)

- schemas/v3/*.json の field 追加 / required 化 / pattern 変更 → **spec-pending** 必須
- docs/spec/*.md の振る舞い記述変更 (例: "X したら Y" → "X したら Z") → **spec-pending**
- docs/spec/*.md の typo / 例追加 / 言い回し改善 → **auto-fix**
- TS JSDoc の旧用語 → **auto-fix** (#1332 M3 patches と同じパターン)
- TS interface field の追加 / 削除 / 型変更 → **issue** (schema 側が canonical なので、schema と一致させる調整は実装変更 = review 要)
- examples の JSON 修正 (schema validate を通すための field 追加 / 修正) → **issue** (canonical サンプルなので慎重に)

## 完了判定 (このラウンドの)

- 上記 6 step を 1 巡実施し、新規 finding が前回 round より減って 0 件に達したら `completed` status で終了
- 同じ finding を 2 巡連続で報告するのは NG (重複検出は orchestrator 側で merge するが、Agent 側でも `evidence_paths` で前回 round と比較)

## previous round context

orchestrator から渡される `previous rounds findings (本軸): N 件` を尊重。N=0 で再 dispatch された場合は「サンプリング軸を変えて再 grep」(例: 前回は common.v3 中心、今回は process-flow.v3 中心) で網羅性を上げる。
