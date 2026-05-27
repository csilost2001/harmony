# Axis 04 — backend storage / lock / draft

## scope

`backend/src/projectStorage.ts` を中心に、ファイル永続化層の **race / FS error path / lock immutability / draft persistence / uuid preserve** を網羅検査。

## 必須 step

### 1. read / write / list 関数の全列挙

```bash
grep -nE "^export (async )?function (read|write|list|delete)" backend/src/projectStorage.ts | head -50
```

各関数について以下を check:

- argument の path traversal 防御 (`assertPathContained` が呼ばれているか)
- error path (ENOENT / EACCES / parse error) の handling
- concurrent write 時の race (lock or atomic rename を使っているか)

### 2. `readEntityAndEnsureUuid` 全 entity bulk path coverage

7 top-level entity (Screen / Table / ProcessFlow / Sequence / View / ViewDefinition / PageLayout) ごとに:

- single read 経路 ✓
- bulk list 経路 ✓
- `.design.json` companion file 除外 (Screen / PageLayout のみ) ✓

```bash
grep -nE "preserveOrAssignUuid|readEntityAndEnsureUuid" backend/src/projectStorage.ts
# uuid persist が必要な経路から漏れていないか
```

### 3. uuid immutability 確認

```bash
# preserveOrAssignUuid で existing uuid vs supplied の不一致 throw が機能
grep -A 5 "uuid immutability violation" backend/src/projectStorage.ts
```

regression test の有無:

```bash
grep -rnE "uuid.*immutab|immutab.*uuid" backend/src/ 2>&1 | head -10
# 各 entity に対する 2nd read uuid 不変 assertion test があるか
```

### 4. edit-session-draft の path safety

```bash
# data/.drafts/ 関連
grep -rnE "draft.*Dir|\.drafts" backend/src/ 2>&1 | head -20
# lock / TTL / cleanup path がどう実装されているか
```

### 5. wsBridge の broadcast / unicast

```bash
grep -nE "broadcast|sendTo|unicast" backend/src/wsBridge.ts 2>&1 | head -30
# 他クライアントへ意図せず leak する message が無いか
```

### 6. tools.ts の MCP handler error wrapping

```bash
grep -nE "throw new McpError" backend/src/tools.ts backend/src/handlers/*.ts | wc -l
# error path で McpError 以外を throw しているもの (=未 wrap) を検出
```

### 7. workspace lockdown / DESIGNER_DATA_DIR mode

```bash
grep -rnE "lockdown|DESIGNER_DATA_DIR" backend/src/ 2>&1 | head -10
# lockdown 時の recent への書き込み禁止が enforce されているか
```

## 出力 format

findings.jsonl に append。本軸は backend 中心なので `evidence_paths` に backend test file も含める。

## classification 指針

- race condition / 概念上の bug 修正 → **issue** (実装ロジック変更、review 要)
- error path 強化 (ENOENT → graceful null return 等) → **issue**
- uuid preserve のテスト追加 → **issue** (test だけなら自動化可能だが、test の妥当性 review 要)
- `assertPathContained` 抜けの追加 → **issue** (security 強化、Axis 07 と重複なら統合)
- backend tools.ts の 1 つの handler error wrap 抜け → **issue**
- docs/spec/workspace.md の例コード古さ → **auto-fix**
- backend/src/projectStorage.ts の関数 JSDoc 追加 → **auto-fix** (純粋 doc 追加なら)

## 完了判定

`projectStorage.ts` / `wsBridge.ts` / `tools.ts` / handler files / draft-related files の 5 領域を 1 巡しfindings.jsonl 0 件追加で `completed`。

## 注意

backend test (`backend/src/*.test.ts`) は **regression test として整備されているか** も確認。`projectStorageDataDir.test.ts` のような厚い test がある一方、未整備の関数も多い可能性。
