# golden-examples/diary-ai-tag-suggest

diary アプリ (`examples/diary/harmony.json`) の AIタグ提案フロー
(`examples/diary/harmony/process-flows/a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d.json`) を題材にした
`/generate-tests` スキルの P5 (AI flow mock + 実 API 切替、Phase 2-B) ゴールデン出力。

**対象 ProcessFlow**: `a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d` (AIタグ提案)

**AI step kind**: `aiCall` + `responseFormat=structuredObject` (Phase 2-A 移行済、PR #937)

---

## ファイル構成

```
diary-ai-tag-suggest/
  ai-tag-suggest.e2e-spec.ts  — mock mode (9 tests) + live API mode (2 tests)
  mocks/
    ai-runtime.ts             — AI runtime service mock helper (provider 中立)
  README.md                   — 本ファイル (PLACEHOLDER 解決表 + 切替方法 + 再 invocation 例)
```

---

## AI flow 検出結果

| step.id | kind | modelRef | responseFormat | 備考 |
|---|---|---|---|---|
| `step-03` | `aiCall` | `tagSuggestModel` | `structuredObject` | TagSuggestResult schema 準拠 |

### modelEndpoints catalog 解決 (project + flow merge 済)

`step.modelRef = "tagSuggestModel"` → `examples/diary/harmony/catalogs/external.json` (project level) より:

```json
{
  "tagSuggestModel": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "auth": { "kind": "bearer", "tokenRef": "@secret.anthropicApiKey" },
    "defaults": { "temperature": 0.5, "maxTokens": 512 }
  }
}
```

### secrets catalog 解決

`auth.tokenRef = "@secret.anthropicApiKey"` → `secrets.anthropicApiKey`:

```json
{
  "anthropicApiKey": {
    "source": "env",
    "name": "ANTHROPIC_API_KEY"
  }
}
```

→ テストで参照する env var: `process.env.ANTHROPIC_API_KEY`

---

## 4 観点変換結果 (Phase 2-B)

| 観点 | テスト # | assertion | 備考 |
|---|---|---|---|
| AI-1: 業務フィルタ (threshold = 0.6) | #5, #6 | `below-threshold` 除外 / `exact-threshold` 採用 / 空配列 | compute step step-04 が @aiResponse.object.tags.filter(...) で適用 |
| AI-2: ANTHROPIC_API_KEY 未設定 → 503 | #7 | `expect(res.status).toBe(503)` | auth.kind=bearer 前提 |
| AI-3: format violation (structuredObject) | #8 | `expect(res.status).toBe(502)` | runtime schema 検証失敗 → 502 |
| AI-4: provider 失敗 → 502 | #9 | `expect(res.status).toBe(502)` | outcomes.failure.action=abort → 502-ai-error |

---

## responseFormat 別の mock 戦略

本フローの step-03 は `responseFormat={kind: "structuredObject", schema: TagSuggestResult}` のため
`mockAiStructured(svc, object)` を使う。other variant の場合は以下 (mocks/ai-runtime.ts 参照):

| step.responseFormat.kind | mock helper | 期待 mock object |
|---|---|---|
| `text` (default) | `mockAiText(svc, "<text>")` | `{ text }` |
| `json` | `mockAiJson(svc, <object>)` | `{ object, raw }` |
| `structuredObject` | `mockAiStructured(svc, <object>)` | `{ object, raw }` (object は schema 準拠) |
| `streaming` | `mockAiStreaming(svc, "<text>")` | `{ text }` (assembled) |

---

## PLACEHOLDER 解決表 (Phase 2-C 確定後)

各 PLACEHOLDER は diary アプリの実装に合わせて置換すること。
`AI_RUNTIME_*` は Phase 2-C で確定済の固定契約なので置換不要 (本 golden は確定値を直接埋め込み)。

| 項目 | 解決元 | 現状値 | 備考 |
|---|---|---|---|
| AI runtime クラス名 | **Phase 2-C 確定 (固定契約)** | `AiRuntimeService` | `/generate-code` 出力 `<出力先>/src/ai/ai-runtime.service.ts` |
| AI runtime method | **Phase 2-C 確定 (固定契約)** | `invoke` | spec `outputBinding 値構造` の正規化形式を返す |
| import path (e2e-spec から) | **Phase 2-C 確定 (固定契約)** | `../src/ai/ai-runtime.service` | apps/api 標準配置 |
| `AI_TAG_SUGGEST_THRESHOLD` | `step-04.expression` リテラル | `0.6` | `#859` 解決後: `@conv.limit.tagSuggestThreshold` catalog 参照 |
| `ANTHROPIC_API_KEY` | `secrets.anthropicApiKey.name` | `process.env.ANTHROPIC_API_KEY` | — (env var は解決不要) |
| `AI_PROVIDER` | `modelEndpoints.tagSuggestModel.provider` | `anthropic` | provider 切替時は catalog 編集で完結 |
| `AI_MODEL_NAME` | `modelEndpoints.tagSuggestModel.model` | `claude-opus-4-7` | 同上 |
| `ADMIN_USERNAME` | `apps/api/prisma/seed.ts` | `'testuser'` (PLACEHOLDER) | 実装確認して置換 |
| `ADMIN_PASSWORD` | `apps/api/prisma/seed.ts` | `'password'` (PLACEHOLDER) | 同上 |

### ProcessFlow → step 参照解決ログ

| 参照 | ProcessFlow 内の場所 | 解決値 |
|---|---|---|
| `step.modelRef` | `actions[0].steps[2].modelRef` | `"tagSuggestModel"` → project catalog で解決 |
| `@secret.anthropicApiKey` | modelEndpoints.tagSuggestModel.auth.tokenRef | env var `ANTHROPIC_API_KEY` |
| `@conv.limit.tagSuggestThreshold` | `actions[0].steps[3].expression` (`step-04`) | リテラル `0.6` (#859 解決後 catalog 参照) |
| `aiResponse.object.tags` | `actions[0].steps[3].expression` | step-03 outputBinding.name から解決 |

---

## mock vs 実 API 切替方法

### mock mode (default)

通常の `jest` / `npx jest` 実行で mock mode が有効。API キーは不要。

```bash
# apps/api ディレクトリで実行
cd apps/api
npx jest ai-tag-suggest.e2e-spec.ts --runInBand

# または
npx jest --testPathPattern=ai-tag-suggest --runInBand
```

**注意**:
- `--runInBand` は SQLite を使用しているため必須 (D-7)。
- Phase 2-C 確定後、`aiRuntime = moduleFixture.get<AiRuntimeService>(AiRuntimeService)` で DI 取得済。
  `/generate-code` で `<出力先>/src/ai/ai-runtime.service.ts` が生成されていれば本 golden はそのまま動作する。
- 本 golden の TypeScript ファイル (`mocks/ai-runtime.ts` / `ai-tag-suggest.e2e-spec.ts`) は
  **harmony 本 repo の tsc 対象外** (`frontend/tsconfig.app.json` の `include` は `src` のみ)。
  `import { AiRuntimeService } from '../src/ai/ai-runtime.service'` は **生成後の apps/api プロジェクト
  内で解決される想定** であり、harmony repo 内には実装ファイル本体は存在しない (テンプレート参照前提)。

### 実 API mode

`RUN_AI_INTEGRATION=1` と `ANTHROPIC_API_KEY` を設定して実行する。
CI では **デフォルト skip** (ternary パターン `(cond ? describe : describe.skip)(...)` で除外)。
手動 smoke 時のみ使用する。
`describe.skipIf` は Vitest 専用 API で jest では TypeError になるため、jest + vitest 両互換の
ternary パターンを採用している。

```bash
# apps/api ディレクトリで実行
RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=sk-ant-xxx npx jest ai-tag-suggest.e2e-spec.ts --runInBand

# または .env.test に設定
echo "RUN_AI_INTEGRATION=1" >> .env.test
echo "ANTHROPIC_API_KEY=sk-ant-xxx" >> .env.test
npx jest ai-tag-suggest.e2e-spec.ts --runInBand
```

**コスト**: 実 API mode テスト 1 回あたり最大 `512 tokens` 消費
(modelEndpoint.defaults.maxTokens より)。

---

## CI 設定例

実 API mode テストを CI から除外する標準的な設定:

### GitHub Actions

```yaml
# .github/workflows/test.yml
jobs:
  test:
    steps:
      - name: Run unit + integration tests (mock mode only)
        run: cd apps/api && npx jest --runInBand
        # RUN_AI_INTEGRATION は設定しない → live API テストは skip

  smoke-ai:
    if: github.event_name == 'workflow_dispatch'
    steps:
      - name: Run AI integration smoke (live API)
        run: cd apps/api && npx jest ai-tag-suggest.e2e-spec.ts --runInBand
        env:
          RUN_AI_INTEGRATION: '1'
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

---

## mental invocation の記録

このゴールデン出力は以下の `/generate-tests` invocation に対応する:

```
/generate-tests a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d
```

### invocation 時の AI の処理フロー (Phase 2-B)

1. `harmony.json` から `entities.processFlows[]` を確認 → `a9b0c1d2-...` が ProcessFlow と判定
2. `techStack.backend.framework = "nestjs"` → P1/P2/P5 ルートへ
3. `a9b0c1d2-....json` を Read → `step-03.kind = "aiCall"`, `modelRef = "tagSuggestModel"` を検出 → P5 起動
4. `examples/diary/harmony/catalogs/external.json` (project level) を読み、flow level catalog と merge
5. `merged.modelEndpoints.tagSuggestModel` から provider / model / auth を抽出
6. `step.responseFormat.kind = "structuredObject"` を検出 → mockAiStructured を選択
7. `step-04.expression` から threshold リテラル `0.6` を抽出 (AI-1 適用)
8. `step.outcomes.failure` から responseId="502-ai-error" を解決 → AI-4 期待 status=502
9. 4 観点 (AI-1〜AI-4) のテストを生成 (text/streaming なら AI-3 を skip)
10. ternary パターン `(process.env.RUN_AI_INTEGRATION === '1' ? describe : describe.skip)(...)` で live mode を保護
11. README に PLACEHOLDER 解決表 (AI_RUNTIME_* は Phase 2-C 確定済として固定契約セクションに記載) を記録

### golden との一致確認

- step-03 の `kind: "aiCall"` + `modelRef: "tagSuggestModel"` → mock target: `aiRuntime` (`AiRuntimeService` 実 type) ✅
- step-03 の `responseFormat.kind: "structuredObject"` → `mockAiStructured(...)` ヘルパー使用 ✅
- step-04 expression リテラル `0.6` → `AI_TAG_SUGGEST_THRESHOLD = 0.6` const 化 ✅
- step.outcomes.failure (action="abort") → 間接解決: catalog.errors.AI_API_ERROR.responseId="502-ai-error" → responses["502-ai-error"].status=502 (catalog に entry が無い場合は AI の慣例として 502 default) ✅
- `@secret.anthropicApiKey` → `secrets.anthropicApiKey.name = "ANTHROPIC_API_KEY"` 解決 ✅
- modelEndpoint.defaults.maxTokens=512 → live mode コスト記録 ✅

---

## 残り 3 つの AI flow に対する再 invocation 例

diary アプリには他に 3 つの AI flow がある。以下の invocation で同様のゴールデンを生成できる:

### AI要約生成 (f7a8b9c0-d1e2-4f3a-8b4c-5d6e7f8a9b0c)

```
/generate-tests f7a8b9c0-d1e2-4f3a-8b4c-5d6e7f8a9b0c
```

- step-04: `kind=aiCall`, `modelRef=summarizeModel`, **responseFormat=text** (default)
- step-05: `compute → @aiResponse.text`
- AI-1: 適用なし (信頼度フィルタ不使用、text 加工のみ)
- AI-3: **skip** (responseFormat=text のため runtime parse 不要)
- AI-4: provider 失敗 → 502-ai-error
- step-06: DB UPDATE (posts.summary) → P2 DB 副作用テストも追加
- 差異: `TX 外 (idempotent)` → transactionScope に含まれない、modelEndpoint.defaults.maxTokens=512 (#1221 で旧 txBoundary 廃止)

### AI画像alt生成 (b0c1d2e3-f4a5-4b6c-8d7e-8f9a0b1c2d3e)

```
/generate-tests b0c1d2e3-f4a5-4b6c-8d7e-8f9a0b1c2d3e
```

- step-05: `kind=aiCall`, `modelRef=altTextModel`, **responseFormat=text**, **vision input**
- messages[1].content に `{ type: "image", source: { kind: "url", url: "@targetImageUrl" } }` (#939 提案 B)
- @targetImageUrl は step-04 で `@photoRow.url ?? @inputs.imageUrl` から算出
- → fixture: `photoId` 経由 (DB seed) または `imageUrl` 直接指定の 2 通り
- step-06: `compute → @aiResponse.text`
- AI-1: 適用なし、AI-3: skip、AI-4: 502-ai-error
- step-07: DB UPDATE (photos.alt) → P2 DB 副作用テストも追加
- 差異: vision input のため fixture 戦略が AiImageSource variant 別に分岐

### AI文章校正 (c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f)

```
/generate-tests c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f
```

- step-03: `kind=aiCall`, `modelRef=proofreadModel`, **responseFormat=structuredObject**
- responseFormat.schema = ProofreadResult `{ corrected: string, changes: ChangeItem[] }`
- step-04: `return → { corrected: @aiResponse.object.corrected, changes: @aiResponse.object.changes }`
- AI-1: 適用なし (filter 処理なし、object 全体を return)
- AI-3: **適用** (structuredObject schema 違反 → 502)
- AI-4: provider 失敗 → 502-ai-error
- 差異: `modelEndpoint.defaults.maxTokens=4096` (タグ提案の 512 より大きい) → live mode タイムアウト調整

---

## english-learning sample の参考 (会話ターン進行)

english-learning project の `96118ae1-a0ab-401b-8584-dd645a45a81f.json` (会話ターン進行) は
`aiCall` + `AiMessageSpread` を使う唯一の sample。

```
/generate-tests 96118ae1-a0ab-401b-8584-dd645a45a81f
```

- step-03: `kind=aiCall`, `modelRef=dialogModel`, responseFormat=text (default)
- messages[1] = `{ kind: "spread", ref: "@turnContext", description: "..." }`
- @turnContext は action input (string 型、過去 turns の DialogTurn[] JSON)
- → fixture: request body に `turnContext: JSON.stringify([{role,content},...])` を含める
- AI-1: 適用なし (text 加工のみ)、AI-3: skip、AI-4: 502-llm-failed
- step-04 (TTS) は english-learning 拡張 stepKind のため P5 対象外 (本層は core stepKind のみ)

---

## 将来拡張の差替えポイント

### Phase 2-C 完了状況 (2026-05-08)

Phase 2-C で AI runtime 契約は確定済 (`AiRuntimeService.invoke` + import `../src/ai/ai-runtime.service`)。
本 golden は確定値を直接埋め込み、PLACEHOLDER 注記は撤去した:

- `mocks/ai-runtime.ts`: `import type { AiRuntimeService } from '../src/ai/ai-runtime.service';` (実 type)
- `mocks/ai-runtime.ts`: `jest.spyOn(svc, 'invoke')` (`as any` 撤去)
- `ai-tag-suggest.e2e-spec.ts`: `aiRuntime = moduleFixture.get<AiRuntimeService>(AiRuntimeService);`

### 今後の追加観点候補

1. AI-4-b (retry 回数 assertion):
   - `modelEndpoint.retryPolicy` が将来 spec 拡張されたら、SDK 内部 retry を `spy.toHaveBeenCalledTimes(N)` で検証
2. aiAgent: maxIterations 超過パスの assertion (現状 Phase 2-B では未対応、別 ISSUE 候補)
3. structuredObject: AJV strict mode での schema validation 検証

### #859 解決後 (@conv.* / @env.* 参照サポート)

1. `AI_TAG_SUGGEST_THRESHOLD` const を削除し conventions catalog から取得:
   ```typescript
   const threshold = await conventionsService.get('limit.tagSuggestThreshold'); // 0.6
   ```
2. provider 別の env var (e.g. OPENAI_API_KEY) に切替えても catalog 編集だけで完結
   (provider 切替は modelEndpoints.<key>.provider / model / auth を書き換える)
