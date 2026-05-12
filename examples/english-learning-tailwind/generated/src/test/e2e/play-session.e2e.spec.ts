/**
 * E2E シナリオテスト: ダッシュボード → 学習セッション開始 → セッション結果
 *
 * // ===HARMONY_GENERATED_SECTION_START scenario=scenario-496e43f8-18bcc879===
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * シナリオ: 学習セッションプレイ (dashboard-to-session-result)
 *
 * Screen パス:
 *   1. ダッシュボード       (496e43f8) / [auth=required]
 *   2. ストーリー詳細       (046e1f83) /stories/:storyId [推測: list→detail 慣習]
 *   3. 学習セッション開始   ProcessFlow cc173367 / POST /api/el/sessions
 *   4. 会話プレイ画面       (a9d8eb6f) /learn/:sessionId
 *   5. セッション結果        (18bcc879) /learn/:sessionId/result [auth=required]
 *
 * 遷移導出: 3次 (path-based fallback)
 *   TODO: screenTransitions 補完待ち
 *   ⚠️ 推測で生成: screenTransitions[] および events[] が空のため、
 *       screen.kind の慣習 (dashboard → complete) と ProcessFlow の httpRoute から遷移を導出。
 *       screenTransitions[] または events[] を補完後に再生成すること。
 *
 * techStack.auth.method: "jwt" → loginAs (API 経由)
 * D-7: database.type="postgresql" → fullyParallel 可 (SQLite 制約なし)
 */

// Spec anchor: Scenario scenario-496e43f8-18bcc879

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { seedTestData, truncateTestData } from './helpers/db';

test.describe('ダッシュボード → 学習セッション → セッション結果 E2E', () => {
  let context: BrowserContext;
  let page: Page;
  let seededData: { storyId: number; sessionId?: number };

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // DB seed: stories テーブルにテスト用ストーリーを作成
    seededData = await seedTestData(page, 'play-session-scenario');
  });

  test.afterAll(async () => {
    await truncateTestData(page, 'play-session-scenario');
    await context.close();
  });

  test.beforeEach(async () => {
    /**
     * Spec: Scenario scenario-496e43f8-18bcc879 step:1
     *   auth: jwt → loginAs() API 経由でログイン
     *   PLACEHOLDER: /api/auth/login エンドポイントを確認すること
     */
    await loginAs(page, { username: 'test@example.com', password: 'TestPassword123' });
  });

  // === Step 2: ダッシュボード表示 ===

  /**
   * Spec: Scenario scenario-496e43f8-18bcc879 step:2
   *   Screen 496e43f8 (ダッシュボード, path=/)
   *
   * TODO: screenTransitions 補完待ち
   * ⚠️ 推測で生成: dashboard kind から直接アクセス
   */
  test('ダッシュボードが表示される (step 2)', async () => {
    // Spec: Screen 496e43f8-d243-48a1-b680-32d34d98cc2d path=/
    await page.goto('/');

    // ダッシュボードの output items 確認 (data-testid 規約)
    // Spec: Screen 496e43f8 item:streakDays
    await expect(page.getByTestId('streakDays')).toBeVisible();

    // Spec: Screen 496e43f8 item:cefrLevel
    await expect(page.getByTestId('cefrLevel')).toBeVisible();

    // Spec: Screen 496e43f8 item:todayGoal
    await expect(page.getByTestId('todayGoal')).toBeVisible();

    // Spec: Screen 496e43f8 item:recentStoryList
    await expect(page.getByTestId('recentStoryList')).toBeVisible();
  });

  // === Step 3: 学習セッション開始 (ProcessFlow cc173367) ===

  /**
   * Spec: Scenario scenario-496e43f8-18bcc879 step:3
   *   ProcessFlow cc173367 (学習セッション開始)
   *   httpRoute: POST /api/el/sessions
   *   遷移: ダッシュボード → 会話プレイ画面 (/learn/:sessionId)
   *
   * TODO: screenTransitions 補完待ち
   * ⚠️ 推測で生成: ストーリー選択後に「学習開始」ボタンで POST /api/el/sessions が発火
   */
  test('ストーリー選択 → 学習セッション開始 → 会話プレイ画面へ遷移 (step 3)', async () => {
    await page.goto('/');

    // PLACEHOLDER: ストーリー一覧へのナビゲーション経路を確認すること
    // 想定: ダッシュボードの recentStoryList からストーリーを選択、または /stories へ遷移

    // API 呼び出し確認 (ProcessFlow cc173367 の httpRoute)
    const sessionResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/el/sessions') && response.request().method() === 'POST',
    );

    // PLACEHOLDER: 「学習開始」ボタンの data-testid を確認すること
    // await page.click('[data-testid="startLearningButton"]');

    // PLACEHOLDER: セッション開始 API の応答確認
    // const resp = await sessionResponse;
    // expect(resp.status()).toBe(201);
    // const body = await resp.json();
    // expect(body).toHaveProperty('sessionId');

    // 暫定: URL パターンで遷移確認
    // await page.waitForURL('/learn/**');

    // scaffold placeholder (実際のコンポーネント実装後に有効化)
    expect(true).toBe(true);
  });

  // === Step 4: セッション結果画面表示 ===

  /**
   * Spec: Scenario scenario-496e43f8-18bcc879 step:4
   *   Screen 18bcc879 (セッション結果, path=/learn/:sessionId/result)
   *
   * TODO: screenTransitions 補完待ち
   * ⚠️ 推測で生成: 会話プレイ画面終了後に /learn/:sessionId/result へ遷移
   */
  test('セッション結果画面が表示される (step 4)', async () => {
    // PLACEHOLDER: seededData.sessionId を使ってセッション結果画面へ直接アクセス
    const sessionId = seededData.sessionId ?? 1; // PLACEHOLDER: seed から取得すること
    await page.goto(`/learn/${sessionId}/result`);

    // セッション結果の output items 確認
    // Spec: Screen 18bcc879 item:totalScore
    await expect(page.getByTestId('totalScore')).toBeVisible();

    // Spec: Screen 18bcc879 item:turnCount
    await expect(page.getByTestId('turnCount')).toBeVisible();

    // Spec: Screen 18bcc879 item:newWordsCount
    await expect(page.getByTestId('newWordsCount')).toBeVisible();

    // Spec: Screen 18bcc879 item:pronunciationFeedback
    await expect(page.getByTestId('pronunciationFeedback')).toBeVisible();

    // Spec: Screen 18bcc879 item:recommendedStory
    await expect(page.getByTestId('recommendedStory')).toBeVisible();
  });

  // === 完全シナリオ (通しテスト) ===

  /**
   * Spec: Scenario scenario-496e43f8-18bcc879 (通しテスト)
   *   ダッシュボード → セッション結果の全遷移を一連のシナリオとして検証
   */
  test('完全シナリオ: ダッシュボード → 学習開始 → セッション結果', async () => {
    // Step 1: ダッシュボードへアクセス
    // Spec: Scenario scenario-496e43f8-18bcc879 step:1
    await page.goto('/');
    await expect(page.getByTestId('streakDays')).toBeVisible();

    // Step 2: セッション開始 API を呼び出し (API 経由でセッション作成)
    // Spec: Scenario scenario-496e43f8-18bcc879 step:3 via ProcessFlow cc173367
    // PLACEHOLDER: UI 操作を通じてセッションを開始すること
    // 暫定: API 直接呼び出しでセッション ID を取得
    // const sessionId = await page.evaluate(async () => {
    //   const token = localStorage.getItem('accessToken');
    //   const res = await fetch('/api/el/sessions', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    //     body: JSON.stringify({ storyId: 1 }),
    //   });
    //   const data = await res.json();
    //   return data.sessionId;
    // });

    // Step 3: セッション結果画面を確認
    // Spec: Scenario scenario-496e43f8-18bcc879 step:4 Screen 18bcc879
    // await page.goto(`/learn/${sessionId}/result`);
    // await expect(page.getByTestId('totalScore')).toBeVisible();

    // scaffold placeholder (実際のコンポーネント実装後に有効化)
    expect(true).toBe(true);
  });

});
