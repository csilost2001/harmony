# Classification rules — finding → auto-fix / issue / spec-pending

各 axis Agent は finding を発見したら **必ず** 以下のルールで self-classify して findings.jsonl の `classification` field を埋める。判定が境界線の場合は **保守側 = issue 起票** に倒す。

## 判定フローチャート

```
finding 発見
  │
  ├─ schemas/v3/*.json の変更が必要?
  │    └─ YES → classification = "spec-pending"
  │
  ├─ docs/spec/*.md の振る舞い記述 (例: "X したら Y する") の変更?
  │    └─ YES → classification = "spec-pending"
  │
  ├─ public API (MCP tool / wsBridge message / 公開関数 signature) の変更?
  │    └─ YES → classification = "spec-pending"
  │
  ├─ fix diff が ≤ 30 行 + tsc/vitest 影響なし + 自明な修正 (typo / 言い換え / 例追加 / 型注釈) ?
  │    └─ YES → classification = "auto-fix"
  │
  └─ それ以外 (実装バグ / test gap / 軽微改善) → classification = "issue"
```

## カテゴリ詳細

### auto-fix (即 commit)

**境界**: 30 行以内の diff、build/test に影響なし、人間レビュー不要レベル。

**典型例**:

- `docs/spec/*.md` の typo / 言い換え / 例追加 (振る舞い記述は変えない)
- TS JSDoc の言い回し更新 (例: "Uuid" → "EntityId" 同期、`#1332` の M3 fix のような sync)
- 未使用 import / 未使用 variable の削除
- 明らかな lint 違反 (eslint で `--fix` が効くもの)
- 既存 test の `toBe` → `toEqual` 軽微補正 (assertion 強化)
- comment 内の古いリンク / ISSUE 番号の更新

**NG (auto-fix にしてはいけない)**:

- ❌ 実装ロジックの変更 (たとえ 1 行でも)
- ❌ schemas/v3/*.json の触る
- ❌ test の skip 解除 / 期待値変更
- ❌ public API signature 変更
- ❌ dependency 追加 / 削除

### issue (集約 ISSUE に sub-section 追加)

**境界**: 1-3 時間で fix 可能だが、人間 or 別 AI の review を経てから main に入れたいレベル。

**典型例**:

- 実装バグ (null check 漏れ / race condition / FS error path 未処理)
- test gap (covered function に対する vitest spec 未整備)
- 軽微な refactor 提案 (`as any` → 型付け、cast hack 解消)
- e2e click-path の抜け
- security 観点の指摘 (path traversal 可能性 / prototype pollution 余地)
- パフォーマンス問題 (明らかに O(n²) で許容範囲外)

**集約 ISSUE の作り方**:

軸単位で 1 ISSUE。タイトル: `release-review: <axis> findings (<branch>)`、body は `## 提案 A` `## 提案 B` ... 形式で個別 finding を sub-section 化。

ラベル: `release-review`, `release-review-issue`.

### spec-pending (個別 ISSUE 起票 + 着手禁止)

**境界**: 設計者承認なしには触れない範囲。リリース後 or 別 RFC で扱う。

**典型例**:

- `schemas/v3/*.json` の構造変更が必要 (新 field 追加 / required 化 / pattern 変更)
- `docs/spec/*.md` の振る舞い記述変更 (例: "Y したら Z"を"Y したら W"に)
- public API の signature 変更 (MCP tool 引数 / wsBridge message format)
- 大規模 refactor (1 PR で収まらない)
- フレームワーク全体の設計変更

**起票方法**:

個別 ISSUE。タイトル: `spec-pending: <title> (release-review)`、ラベル: `release-review`, `spec-pending`, `blocked`.

body には:

- 発見軸 / 発見 round
- 影響範囲 (file:line + 関連 ISSUE / spec doc)
- なぜ spec-pending か (上記境界のどれに該当するか)
- 提案する解決方向 (推奨 1 つ + 代替案、設計者が判断する材料)
- **着手禁止 marker**: `## ⚠️ 着手禁止 - 設計者承認待ち` を冒頭に明示

## 境界事例 (判断に迷ったら issue に倒す)

| 状況 | 判定 |
|---|---|
| TS 型に `as unknown as TypeX` cast が残っている (legacy) → 型付けすれば消える | **issue** (実装変更を伴う) |
| examples/*/screens/*.json の screen.kind が新 enum 値を使っていない | **spec-pending** (enum 定義変更要なら) or **issue** (既存 enum で表現可能なら) |
| docs/spec/screen-items.md の例コードが古い field 名を使っている | **auto-fix** (例の更新は振る舞い変更ではない) |
| test file の expect 値が "明らかに" 間違っている (実装が正しい) | **issue** (test 修正は人間レビュー要、auto-fix 禁止) |
| ESLint warning の `prefer-const` | **auto-fix** (`--fix` で機械的) |
| 関数 signature に optional param を追加すれば既存呼出全部互換 | **issue** (たとえ互換でも API 変更は review 要) |
| process-flow.v3.schema.json の description 更新だけ | **spec-pending** (schemas/*.json governance、touch 自体禁止) |

## 各 axis Agent の出力 format

各 finding は findings.jsonl に 1 行 = 1 JSON で append:

```json
{
  "axis": "03-type-contract",
  "round": 2,
  "severity": "must|should|nit",
  "classification": "auto-fix|issue|spec-pending",
  "file": "frontend/src/store/tableStore.ts:142",
  "title": "tableStore.upsert で `as any` cast が残存",
  "body": "...詳細な指摘内容、再現手順 / 影響範囲 / 推奨 fix...",
  "fix_diff": "...auto-fix 時のみ unified diff or before/after を文字列で...",
  "evidence_paths": ["...", "..."],
  "discovered_at": "2026-05-27T15:00:00.000Z"
}
```

- `severity`: must (release blocker) / should (release 前に直したい) / nit (リリース後でも可)
- `fix_diff`: auto-fix 時のみ必須、orchestrator が apply-fix で適用する

## orchestrator 側の追加チェック (Agent self-classify への二重検証)

orchestrator が aggregate 時に **必ず** 以下を再確認:

1. classification = `auto-fix` でも、`fix_diff` を parse して以下のいずれかに当たれば降格 → `issue`:
   - schemas/v3/*.json への touch
   - 30 行超の diff
   - tsc / vitest が失敗 (apply 試行 → rollback)
2. classification = `issue` でも、内容が schemas governance / public API 変更を伴うと検出したら昇格 → `spec-pending`
3. 重複 finding (同 file:line + 類似 title) は merge (skip)
