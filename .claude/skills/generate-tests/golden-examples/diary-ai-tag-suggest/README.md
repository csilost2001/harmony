# golden-examples/diary-ai-tag-suggest

diary アプリ (`examples/diary/harmony.json`) の AIタグ提案フロー
(`examples/diary/harmony/process-flows/a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d.json`) を題材にした
`/generate-tests` スキルの P5 (AI flow mock + 実 API 切替) ゴールデン出力。

**対象 ProcessFlow**: `a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d` (AIタグ提案)

---

## ファイル構成

```
diary-ai-tag-suggest/
  ai-tag-suggest.e2e-spec.ts  — mock mode (6 tests) + live API mode (2 tests)
  mocks/
    claude-api.ts             — Claude API mock helper (jest.spyOn ベース)
  README.md                   — 本ファイル (PLACEHOLDER 解決表 + 切替方法 + 再 invocation 例)
```

---

## AI flow 検出結果

| step.id | kind | systemRef | AI 系? | 備考 |
|---|---|---|---|---|
| `step-03` | externalSystem | `claudeApi` | ✅ | Claude AI API (名前に "claude" を含む) |

### externalSystems catalog (a9b0c1d2 ProcessFlow より)

```json
{
  "claudeApi": {
    "name": "Claude AI API",
    "baseUrl": "@env.CLAUDE_API_BASE_URL",
    "auth": { "kind": "bearer", "tokenRef": "@secret.claudeApiKey" },
    "timeoutMs": 30000,
    "retryPolicy": { "maxAttempts": 2, "backoff": "exponential", "initialDelayMs": 1000 }
  }
}
```

---

## 4 観点変換結果 (P5)

| 観点 | テスト # | assertion |
|---|---|---|
| AI-1: 信頼度フィルタ (threshold = 0.6) | #5, #6 | `below-threshold` 除外 / `exact-threshold` 採用 / 空配列 |
| AI-2: API key 未設定 → 503 | #7 | `expect(res.status).toBe(503)` |
| AI-3: malformed JSON → 500 | #8 | `expect(res.status).toBe(500)` |
| AI-4: 502 retry × 2 → spy 2 回 → 最終 502 | #9 | `expect(spy).toHaveBeenCalledTimes(2)` |

---

## PLACEHOLDER 解決表

各 PLACEHOLDER は diary アプリの実装に合わせて置換すること。

| PLACEHOLDER | 解決元 | 現状値 | #解決後の差替えポイント |
|---|---|---|---|
| `AI_TAG_SUGGEST_THRESHOLD` | `step-04.expression` リテラル | `0.6` | `#859` 解決後: `conventions.ai.tagSuggestThreshold` catalog 参照 |
| `CLAUDE_API_BASE_URL` | `externalSystems.claudeApi.baseUrl` | `https://api.anthropic.com` | `#859` 解決後: `@env` catalog から解決 |
| `CLAUDE_API_KEY` | `secrets.claudeApiKey.name` | `process.env.CLAUDE_API_KEY` | — (env var は解決不要) |
| `AI_MODEL_LITERAL` | `step-03.httpCall.body` の `model` | `'claude-opus-4-7'` | `#859` 解決後: `@conv.ai.tagSuggestModel` |
| `ADMIN_USERNAME` | `apps/api/prisma/seed.ts` | `'testuser'` (PLACEHOLDER) | 実装確認して置換 |
| `ADMIN_PASSWORD` | `apps/api/prisma/seed.ts` | `'password'` (PLACEHOLDER) | 実装確認して置換 |
| `HTTP_SERVICE_SPY_TARGET` | NestJS HttpService 実装 | `httpService.post` | `#865` 解決後: provider interface mock |

### ProcessFlow → step 参照解決ログ

| 参照 | ProcessFlow 内の場所 | 解決値 |
|---|---|---|
| `@env.CLAUDE_API_BASE_URL` | `context.catalogs.externalSystems.claudeApi.baseUrl` | PLACEHOLDER `https://api.anthropic.com` |
| `@secret.claudeApiKey` | `context.catalogs.externalSystems.claudeApi.auth.tokenRef` | env var `CLAUDE_API_KEY` |
| threshold `0.6` | `actions[0].steps[3].expression` (`step-04`) のリテラル | `0.6` (固定値) |

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

**注意**: `--runInBand` は SQLite を使用しているため必須 (D-7)。

### 実 API mode

`RUN_AI_INTEGRATION=1` と `CLAUDE_API_KEY` を設定して実行する。
CI では **デフォルト skip** (describe.skipIf で除外)。手動 smoke 時のみ使用する。

```bash
# apps/api ディレクトリで実行
RUN_AI_INTEGRATION=1 CLAUDE_API_KEY=sk-ant-xxx npx jest ai-tag-suggest.e2e-spec.ts --runInBand

# または .env.test に設定
echo "RUN_AI_INTEGRATION=1" >> .env.test
echo "CLAUDE_API_KEY=sk-ant-xxx" >> .env.test
npx jest ai-tag-suggest.e2e-spec.ts --runInBand
```

**コスト**: 実 API mode テスト 1 回あたり最大 `512 tokens` 消費 (step-03 `max_tokens` より)。

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

  # 別 job または手動トリガーで live API smoke
  smoke-ai:
    if: github.event_name == 'workflow_dispatch'
    steps:
      - name: Run AI integration smoke (live API)
        run: cd apps/api && npx jest ai-tag-suggest.e2e-spec.ts --runInBand
        env:
          RUN_AI_INTEGRATION: '1'
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
```

---

## mental invocation の記録

このゴールデン出力は以下の `/generate-tests` invocation に対応する:

```
/generate-tests a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d
```

### invocation 時の AI の処理フロー

1. `harmony.json` から `entities.processFlows[]` を確認 → `a9b0c1d2-...` が ProcessFlow と判定
2. `techStack.backend.framework = "nestjs"` → P1/P2/P5 ルートへ
3. `a9b0c1d2-....json` を Read → `step-03.kind = "externalSystem"`, `systemRef = "claudeApi"` を検出
4. `externalSystems.claudeApi.name = "Claude AI API"` → 名前に "claude" を含む → **AI flow 判定**
5. P5 セクション追加: externalSystems catalog から `retryPolicy`, `secrets` を抽出
6. `step-04.expression` からリテラル threshold `0.6` を抽出
7. 4 観点 (AI-1〜AI-4) のテストを生成
8. `describe.skipIf(process.env.RUN_AI_INTEGRATION !== '1')` で live mode を保護
9. README に PLACEHOLDER 解決表と #859/#865 の差替えポイントを記録

### golden との一致確認

- step-03 の `systemRef: "claudeApi"` → mock target: `httpService.post` spy ✅
- `retryPolicy.maxAttempts: 2` → `spy.toHaveBeenCalledTimes(2)` ✅
- `retryPolicy.backoff: "exponential"` → `jest.useFakeTimers()` で delay スキップ ✅
- threshold `0.6` → `AI_TAG_SUGGEST_THRESHOLD = 0.6` const 化 ✅
- `@secret.claudeApiKey` → `secrets.claudeApiKey.name = "CLAUDE_API_KEY"` 解決 ✅
- `@env.CLAUDE_API_BASE_URL` → PLACEHOLDER + #859 解決後差替えノート ✅

---

## 残り 3 つの AI flow に対する再 invocation 例

diary アプリには他に 3 つの AI flow がある。以下の invocation で同様のゴールデンを生成できる:

### AI文章校正 (c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f)

```
/generate-tests c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f
```

- step-03: kind=externalSystem, systemRef=claudeApi
- step-04: JSON.parse → corrected + changes (no threshold filter)
- AI-1 相当: なし (信頼度フィルタ不使用)
- AI-2〜AI-4 は AIタグ提案と同じパターンで生成可能
- **差異**: `max_tokens: 4096` (AIタグ提案の 512 より大きい) → live mode タイムアウト調整

### AI画像alt生成 (b0c1d2e3-f4a5-4b6c-8d7e-8f9a0b1c2d3e)

```
/generate-tests b0c1d2e3-f4a5-4b6c-8d7e-8f9a0b1c2d3e
```

- step-05: kind=externalSystem, systemRef=claudeApi (Vision API)
- step-06: compute → `@aiResponse.content[0].text` (no JSON.parse)
- AI-3 相当: content[0].text が空 / undefined の場合のエラー処理
- **差異**: images (multimodal) → mock body に `content: [{ type: "image", ... }]` が含まれる
- step-07: DB UPDATE (photos.alt) → P2 DB 副作用テストも追加

### AI要約生成 (f7a8b9c0-d1e2-4f3a-8b4c-5d6e7f8a9b0c)

```
/generate-tests f7a8b9c0-d1e2-4f3a-8b4c-5d6e7f8a9b0c
```

- step-04: kind=externalSystem, systemRef=claudeApi
- step-05: compute → `@aiResponse.content[0].text` (no JSON.parse)
- AI-3 相当: content[0].text が空 / undefined の場合のエラー処理
- step-06: DB UPDATE (posts.summary) → P2 DB 副作用テストも追加
- **差異**: `TX 外 (idempotent)` → txBoundary なし

---

## #859 / #865 解決後の差替えポイント

### #859 解決後 (@conv.ai.* / @env.* 参照サポート)

1. `AI_TAG_SUGGEST_THRESHOLD` const を削除
2. threshold を conventions catalog から取得:
   ```typescript
   const threshold = await conventionsService.get('ai.tagSuggestThreshold'); // 0.6
   ```
3. `CLAUDE_API_BASE_URL` PLACEHOLDER を削除
4. baseUrl を @env catalog から解決 (framework が自動解決)
5. AI model 名を `@conv.ai.tagSuggestModel` から解決

### #865 解決後 (AI provider 抽象化)

1. `mocks/claude-api.ts` の spy target を変更:
   ```typescript
   // Before (現状): HttpService を直接 mock
   jest.spyOn(httpService, 'post')
   
   // After (#865 解決後): provider 抽象化 interface を mock
   jest.spyOn(aiProvider, 'complete')
   // or
   jest.spyOn(aiProvider, 'createMessage')
   ```
2. mock helper 内の `AxiosResponse` 型を provider response 型に変更
3. RxJS Observable ラッパーが不要になる可能性 (provider が Promise を返す場合)
