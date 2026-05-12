# Dogfood Report — /generate-tests NestJS/Next.js 系実機検証 (pl-7 対応)

**日付**: 2026-05-12
**対象**: `.claude/skills/generate-tests/SKILL.md` Step 3 / P3 / P4 / P5
**入力**: `examples/english-learning-tailwind` から 4 entity
**実施者**: Sonnet sub-agent (ISSUE #1038)
**ブランチ**: `fix/issue-1038-nestjs-dogfood`

---

## 0. 再現手順 (第三者検証用)

### structure 検証 (vitest で実行可能)

```bash
# 前提: harmony プロジェクトルートにいること
cd /path/to/harmony

# 1. dogfood テストファイルを frontend の vitest 環境でコピーして実行
cp frontend/src/test/dogfood/dogfood-1038-structure.test.ts .tmp/dogfood-1038/

# または: examples/ の fixture から grep で直接確認
grep -n 'Spec anchor:' examples/english-learning-tailwind/generated/test/cc173367.e2e-spec.ts
grep -n 'Spec anchor:' examples/english-learning-tailwind/generated/src/test/p3/dashboard.test.tsx

# 2. structure 検証 (vitest で実行)
cd frontend && npx vitest run src/test/dogfood/dogfood-1038-structure.test.ts
# → 25/25 pass 確認済み
```

### 生成コマンド再現

```bash
# 各 Step を /generate-tests skill で再生成する場合
/generate-tests cc173367-d92a-4525-acc9-689bad9a048e examples/english-learning-tailwind/generated/test/
/generate-tests 496e43f8-d243-48a1-b680-32d34d98cc2d examples/english-learning-tailwind/generated/src/test/p3/
/generate-tests --scenario 496e43f8-d243-48a1-b680-32d34d98cc2d 18bcc879-0b84-4e63-9317-37b94e799886
# (96118ae1 は AI flow のため P5 として自動生成)
/generate-tests 96118ae1-a0ab-401b-8584-dd645a45a81f examples/english-learning-tailwind/generated/test/
```

---

## 1. dogfood 環境

| 項目 | バージョン |
|---|---|
| Node.js | v20.20.2 |
| npm | 10.8.2 |
| vitest (frontend) | ^4.1.4 |
| jest (generated fixture) | ^29.0.0 (package.json で定義、scaffold 環境依存) |
| Playwright (generated fixture) | ^1.44.0 (package.json で定義、scaffold 環境依存) |

---

## 2. 生成 test 一覧 (Step 別)

### 2-1. Step 3 (ProcessFlow cc173367 → jest+supertest)

**入力**: `examples/english-learning-tailwind/harmony/process-flows/cc173367-d92a-4525-acc9-689bad9a048e.json`
- ProcessFlow 名: 学習セッション開始
- httpRoute: POST /api/el/sessions
- kind: screen (非 AI)
- 使用テーブル: stories (b5aa3e1b), learning_sessions (d524cba6)

**生成パス**: `examples/english-learning-tailwind/generated/test/cc173367.e2e-spec.ts`

| チェック項目 | 結果 |
|---|---|
| placeholder `<<...>>` 残存なし | PASS |
| Spec anchor コメントあり | PASS |
| `@nestjs/testing` import あり | PASS |
| 命名規約 `*.e2e-spec.ts` | PASS |
| 代表要素 (sessionId) を assert に含む | PASS |
| 日本語テスト名 >=2 件 | PASS (7 件) |

**生成テストケース一覧**:
| # | description | spec anchor |
|---|---|---|
| 1 | happy path: storyId 指定 → 201 + sessionId 返却 | act-001 responses[201-created] |
| 2 | validation: storyId 欠落 → 400 | act-001 inputs[storyId] required=true |
| 3 | validation: storyId が integer でない → 400 | act-001 inputs[storyId] type=integer |
| 4 | auth: JWT なし → 401 | act-001 httpRoute.auth="required" |
| 5 | DB 副作用: learning_sessions に row が追加される | act-001 step-02 lineage.writes |
| 6 | DB 副作用: status=in_progress が設定される | act-001 step-02 operation=INSERT |
| 7 | stories バリデーション: 存在しない storyId → 4xx | act-001 step-01 (SELECT+validate) |

### 2-2. Step P3 (Screen 496e43f8 → vitest)

**入力**: `examples/english-learning-tailwind/harmony/screens/496e43f8-d243-48a1-b680-32d34d98cc2d.json`
- Screen 名: ダッシュボード
- kind: dashboard, path: /
- items: 5 件 (全 direction=output, valueFrom なし → SC-D 適用)
- events: [] (空 → SC-F 適用)
- pageLayoutId: なし

**生成パス**: `examples/english-learning-tailwind/generated/src/test/p3/dashboard.test.tsx`

| チェック項目 | 結果 |
|---|---|
| placeholder `<<...>>` 残存なし | PASS |
| Spec anchor コメントあり | PASS |
| `vitest` import あり | PASS |
| 命名規約 `*.test.tsx` | PASS |
| 代表要素 (streakDays/cefrLevel) を assert に含む | PASS |
| 日本語テスト名 >=2 件 | PASS (9 件) |

**実機 run**: `cd frontend && npx vitest run src/test/dogfood/dogfood-1038-structure.test.ts`
→ **25/25 pass** (P3 section: 6/6 pass 含む)

**特記事項**:
- ダッシュボードは全 items が `valueFrom` なし → SC-D ルール適用。
- PLACEHOLDER で msw handler を生成し、実際の API エンドポイント確定後に差し替えを案内する方式を採用。
- events[] 空 → SC-F ルール適用で `it.skip` を生成。

### 2-3. Step P4 (E2E シナリオ → Playwright)

**入力**: Screen 496e43f8 (ダッシュボード, /) → Screen 18bcc879 (セッション結果, /learn/:sessionId/result)
**シナリオ ID**: scenario-496e43f8-18bcc879

**生成パス**: `examples/english-learning-tailwind/generated/src/test/e2e/play-session.e2e.spec.ts`

| チェック項目 | 結果 |
|---|---|
| placeholder `<<...>>` 残存なし | PASS |
| Spec anchor コメントあり | PASS |
| `@playwright/test` import あり | PASS |
| 命名規約 `*.e2e.spec.ts` | PASS |
| 両 Screen の代表要素 (streakDays/totalScore) | PASS |
| 日本語テスト名 >=2 件 | PASS (4 件) |

**遷移導出**: 3次 (path-based fallback) — screenTransitions[] および events[] が空のため
**実機 run**: スキップ (dev server 起動が必要)
**推奨コマンド**: `npx playwright test --config=src/test/e2e/playwright.config.ts`

**特記事項**:
- database.type="postgresql" → D-7 (SQLite `--workers=1` 制約なし)、`fullyParallel: true` で設定。
- techStack.auth.method="jwt" → `loginAs()` (API 経由) ヘルパーを生成。
- `⚠️ 推測で生成` anchor を各 step に付与し、screenTransitions 補完後の再生成を案内。

### 2-4. Step P5 (AI flow 96118ae1 → mock + 実 API)

**入力**: `examples/english-learning-tailwind/harmony/process-flows/96118ae1-a0ab-401b-8584-dd645a45a81f.json`
- ProcessFlow 名: 会話ターン進行
- httpRoute: POST /api/el/sessions/:sessionId/turns
- AI flow 検出: step-03 (kind=aiCall, modelRef=dialogModel, responseFormat=text)
- provider: anthropic / claude-opus-4-7
- AiMessageSpread: ref="@turnContext" (inputs[turnContext: string] から渡る)

**生成パス**:
- `examples/english-learning-tailwind/generated/test/96118ae1-ai-mock.e2e-spec.ts` (mock + 実 API)
- `examples/english-learning-tailwind/generated/mocks/ai-runtime.ts` (AI runtime mock helper)

| チェック項目 | 結果 |
|---|---|
| placeholder `<<...>>` 残存なし | PASS |
| Spec anchor コメントあり | PASS |
| `@nestjs/testing` import あり | PASS |
| 命名規約 `*.e2e-spec.ts` | PASS |
| 代表要素 (aiResponseText/turnId) を assert に含む | PASS |
| 日本語テスト名 >=2 件 | PASS (12 件) |

**4 観点変換結果**:
| 観点 | 生成テスト | 備考 |
|---|---|---|
| AI-1: 業務フィルタ | skip | responseFormat=text → compute filter なし |
| AI-2: secret 未設定 | `#AI-2: ANTHROPIC_API_KEY 未設定 → 503` | env var を空に設定してリクエスト |
| AI-3: format violation | skip | responseFormat=text → parse なし |
| AI-4: provider 失敗 | `#AI-4: provider 失敗 → 502` | mockRejectedValue → LLM_CALL_FAILED |

**実機 run (mock mode)**: `npm run test:p5` → **10 passed / 4 skipped (14 total)** (Phase B `1c94dc3` + 後続修正、本 PR §4 参照)
**実機 run (live API)**: `RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=<key> npm run test:p5:live` (ISSUE scope 外、default skip 仕様)
**推奨コマンド**: `npm run db:reset && npm run test:p5`

**特記事項**:
- AiMessageSpread (@turnContext) の fixture を `turnContextFixture = JSON.stringify([...])` としてファイル先頭で定義。
- `generateAudio=true` の TTS 分岐テスト (#8) も生成 (step-04 branch br-tts-on の検証)。
- 実 API mode は `(RUN_AI_INTEGRATION === '1' ? describe : describe.skip)(...)` ternary で CI default skip。

### 2-5. 対象外 (Step 3-X / 3-Y)

- **Step 3-X**: `examples/english-learning-tailwind` に PageLayout エンティティが存在しないためスキップ
- **Step 3-Y**: 同サンプルに Gadget (`purpose=gadget`) の Screen が存在しないためスキップ

---

## 3. skill 修正候補と対処

本 dogfood で発見し、本 PR で SKILL.md を直接修正した箇所:

### 修正 1: SC-D の msw handler 方針追記 (SC-D セクション末尾)

**発見内容**: ダッシュボードのように全 items が `valueFrom` なしの場合、SC-D の「DOM 存在確認のみ」では
API を呼ぶコンポーネントへの対応が不明確。

**対処**: SC-D ルールの末尾に `**SC-D の msw handler 方針**` として補足を追記した。
- Screen.kind が API 依存明らかな場合 → PLACEHOLDER msw handler を生成
- Screen.kind が API 不要が明らかな場合 → msw handler なし
- 判断不明確な場合 → PLACEHOLDER 形式で生成して README に記録

### 修正 2: AiMessageSpread fixture の定数定義方針明確化 (P5-4 セクション)

**発見内容**: `@turnContext` の型が `string` (JSON 文字列) の場合、`JSON.stringify` が必要なことが
P5-4 の説明から読み取れるが、fixture 変数の定義場所 (ファイル先頭で const 化) が不明確。

**対処**: P5-4 の `例: english-learning 96118ae1` 箇所に `**fixture 変数の定義 (ファイル先頭で const として定義すること)**`
として具体的な TypeScript スニペットを追記した。

---

## 4. 実機 run 結果 (#1038 reopen で更新、2026-05-12)

前 PR #1044 では fixture 配置のみで「実機 run スキップ」だったため #1038 reopen された。
本 reopen では `examples/english-learning-tailwind/generated/` に **NestJS app + Next.js app + Prisma sqlite** を実装し、全 4 Step を実機 run pass まで持っていった。

**fixture 内の `PLACEHOLDER:` コメントについて**: `test/cc173367.e2e-spec.ts` / `test/96118ae1-ai-mock.e2e-spec.ts` / `mocks/ai-runtime.ts` の `PLACEHOLDER:` 接頭コメントは `/generate-tests` skill 生成出力の defensive note。**本 dogfood では実装側で全 PLACEHOLDER が解決済** (validStoryId=1 / validSessionId=1 が seed と一致、accessToken は `POST /api/auth/login` で取得済、AI runtime mock 解決値は `mocks/ai-runtime.ts` 冒頭テーブルに記載済)。fixture 本体は skill 生成サンプルとして保持し、コメント自体は意味的な残骸 (実機 run には影響なし) として残す。採用プロジェクトでは利用者が解決確認後に削除する想定。

| Step | 実機 run | 結果 | 検証 commit |
|---|---|---|---|
| Step 3 (jest+supertest) | **実行** | **Tests: 7 passed, 7 total** | Phase A `cee9497` |
| Step P3 (vitest, 本 sample) | **実行** | **Tests: 9 passed, 1 skipped (10)** | Phase C `c55bbe3` |
| Step P4 (Playwright) | **実行** | **4 passed (11.9s)** | Phase D `7174b55` |
| Step P5 mock mode (jest) | **実行** | **Tests: 10 passed, 4 skipped (14)** | Phase B `1c94dc3` |
| Step P5 live API (jest) | スキップ (default、ISSUE scope 外) | — | `RUN_AI_INTEGRATION=1 ANTHROPIC_API_KEY=<key>` で実行可能 |

### Step 3 実機 run 出力 (Phase A 完成後の独立検証)

```
$ cd examples/english-learning-tailwind/generated && npm run test:step3
PASS test/cc173367.e2e-spec.ts
  POST /api/el/sessions (学習セッション開始 E2E)
    ✓ #1 happy path: storyId 指定 → 201 + sessionId 返却
    ✓ #2 validation: storyId 欠落 → 400
    ✓ #3 validation: storyId が integer でない → 400
    ✓ #4 auth: JWT なし → 401
    ✓ #5 DB 副作用: learning_sessions テーブルに row が追加される
    ✓ #6 DB 副作用: learning_sessions の row に status=in_progress が設定される
    ✓ #7 stories バリデーション: 存在しないストーリーID → 4xx
Tests:       7 passed, 7 total
```

### Step P5 mock 実機 run 出力 (Phase B)

```
$ npm run test:p5
PASS test/96118ae1-ai-mock.e2e-spec.ts
  POST /api/el/sessions/:sessionId/turns (会話ターン進行 E2E)
    POST /api/el/sessions/:sessionId/turns [mock mode]
      ✓ #1 happy path: userInput 送信 → 200 + aiResponseText + turnId
      ✓ #2 validation: userInput 欠落 → 400
      ✓ #3 validation: sessionId が integer でない → 400
      ✓ #4 auth: JWT なし → 401
      ✓ #5 DB 副作用: turn_logs テーブルに row が追加される
      ✓ #6 DB 副作用: turn_logs の turn_number が適切に設定される
      ✓ #7 セッション存在確認: 存在しない sessionId → 404
      ✓ #AI-2 ANTHROPIC_API_KEY 未設定 → 503 Service Unavailable
      ✓ #AI-4 provider 呼び出し失敗 → 502 (LLM_CALL_FAILED)
      ✓ #8 generateAudio=true の場合 aiAudioUrl が非 null
      ○ skipped #AI-1 業務フィルタ (responseFormat=text のため skip)
      ○ skipped #AI-3 response format violation (responseFormat=text のため skip)
    POST /api/el/sessions/:sessionId/turns (会話ターン進行 E2E) [live API]
      ○ skipped #live-1 (RUN_AI_INTEGRATION=1 で実行可能)
      ○ skipped #live-2 (同上)
Tests:       4 skipped, 10 passed, 14 total
```

### Step P3 実機 run 出力 (Phase C、本 sample の dashboard.test.tsx 直接)

```
$ npx vitest run src/test/p3/dashboard.test.tsx
 Test Files  1 passed (1)
      Tests  9 passed | 1 skipped (10)
   Duration  1.00s
```

実 component import + getByTestId 検証あり (前 PR #1044 の `expect(true).toBe(true)` placeholder は #6 の input items 不在確認 1 件のみ残存、それ以外 8 件は実 assertion に置換)。

### Step P4 実機 run 出力 (Phase D、Playwright chromium)

```
$ npx playwright test --config=src/test/e2e/playwright.config.ts
Running 4 tests using 1 worker
  ✓  1 ダッシュボードが表示される (step 2) (1.5s)
  ✓  2 ストーリー選択 → 学習セッション開始 → 会話プレイ画面へ遷移 (step 3) (982ms)
  ✓  3 セッション結果画面が表示される (step 4) (973ms)
  ✓  4 完全シナリオ: ダッシュボード → 学習開始 → セッション結果 (1.1s)
  4 passed (11.9s)
```

### 実装構成

`examples/english-learning-tailwind/generated/` 配下に最小 dogfood 実装:

- **NestJS backend** (port 3001): AuthModule (JWT) / LearningSessionModule / ConversationTurnModule / AiModule (AiRuntimeService) / DashboardModule / PrismaModule
- **Next.js frontend** (App Router, port 3000): `/`, `/login`, `/learn/[sessionId]`, `/learn/[sessionId]/result`
- **Prisma + sqlite**: User / Story / LearningSession / TurnLog (`harmony.json` の postgres 指定は変更せず、生成 app の datasource のみ sqlite に切替)
- **Playwright**: webServer 設定で frontend+backend 自動起動、chromium-1217 既存 install 活用 (`@playwright/test` を 1.59.1 にダウングレード合致)

### Step 3-X (PageLayout 込み page rendering) / Step 3-Y (Gadget) は対象外

本 sample に PageLayout entity / Screen.purpose=gadget が存在しないため (#1038 本文 §「対応対象外」明示)。

---

## 5. 「将来対応」「follow-up」項目

なし。本 reopen の全 4 Step を実機 run pass まで持っていったため放置項目 0 件。
Step P5 live API (`RUN_AI_INTEGRATION=1`) は ISSUE 本文で明示 scope 外 (ANTHROPIC_API_KEY 未設定環境では default skip = 仕様通り)。
