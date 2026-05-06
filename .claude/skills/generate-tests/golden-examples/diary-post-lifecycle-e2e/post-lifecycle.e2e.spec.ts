/**
 * E2E シナリオテスト: 投稿ライフサイクル (login → 一覧 → 作成 → 詳細 → 編集 → 削除)
 *
 * // ===HARMONY_GENERATED_SECTION_START scenario=post-lifecycle===
 * // このコメントブロックは /generate-tests スキル再実行時に overwrite される。
 * // anchor の外側 (人手追記 assertion) は保護される。
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * シナリオ: 投稿ライフサイクル
 * 対象画面:
 *   a5088d22-4ad8-4615-a4c5-447ff9cdd280 (ログイン, kind=login, path=/login)
 *   → 31d56212-b654-46dc-b004-096c7382c404 (投稿一覧, kind=list,   path=/)
 *   → 531619ae-0f5f-4f55-8043-03e5a9ef6670 (投稿編集, kind=form,   path=/post/edit/:id?)  ← 新規作成
 *   → ffec74d0-6c21-45f7-a387-167ac8819255 (投稿詳細, kind=detail, path=/post/:id)
 *   → 531619ae-0f5f-4f55-8043-03e5a9ef6670 (投稿編集, kind=form,   path=/post/edit/:id?)  ← 編集
 *   → 31d56212-b654-46dc-b004-096c7382c404 (投稿一覧, kind=list,   path=/)  ← 削除後
 *
 * 遷移導出: 3次 path-based fallback
 *   diary の entities.screenTransitions[] = [] (空配列)
 *   events[] も未補完 (#864 OPEN)
 *   → kind 慣習 (list→form(新規) / form→detail / detail→form(編集) / form→list) で推測
 *
 * === screen path index ===
 *   ログイン        : path="/login"        (kind=login)
 *   投稿一覧        : path="/"             (kind=list)
 *   投稿編集(新規)  : path="/post/edit"    (:id? なしで新規作成)
 *   投稿詳細        : path="/post/:id"     (:id は作成した投稿 ID)
 *   投稿編集(編集)  : path="/post/edit/:id" (作成した投稿 ID)
 *
 * === シナリオ step mapping ===
 *
 * step 1: ログイン (a5088d22...)
 *   // Spec: Scenario post-lifecycle step:1
 *   → loginAs(page, { username, password }) — API 経由 JWT 取得
 *
 * step 2: 投稿一覧 表示 (31d56212...)
 *   // Spec: Scenario post-lifecycle step:2
 *   // TODO: screenTransitions 補完待ち
 *   → page.goto('/') → data-testid="posts" 確認
 *
 * step 3: 新規投稿作成 フォーム表示 (531619ae...)
 *   // Spec: Scenario post-lifecycle step:3
 *   // TODO: screenTransitions 補完待ち
 *   → page.goto('/post/edit') → フォームフィールド確認
 *
 * step 4: 投稿フォーム送信
 *   // Spec: Scenario post-lifecycle step:4 via ProcessFlow 投稿作成 (0671b051...)
 *   → フォーム入力 → 送信ボタン → POST /api/posts → 詳細画面へ遷移
 *
 * step 5: 投稿詳細 表示 (ffec74d0...)
 *   // Spec: Scenario post-lifecycle step:5
 *   // TODO: screenTransitions 補完待ち
 *   → URL /post/:id 確認 → 入力したタイトル/本文を DOM で確認
 *
 * step 6: 投稿編集 フォーム表示 (531619ae...)
 *   // Spec: Scenario post-lifecycle step:6
 *   // TODO: screenTransitions 補完待ち
 *   → 編集ボタンクリック → /post/edit/:id へ遷移 → 既存値がフォームに入っている確認
 *
 * step 7: 投稿内容 更新
 *   // Spec: Scenario post-lifecycle step:7 via ProcessFlow 投稿更新 (b3a1c2d4...)
 *   → フォーム上書き → 保存 → PATCH /api/posts/:id → 詳細画面へ遷移
 *
 * step 8: 投稿削除
 *   // Spec: Scenario post-lifecycle step:8 via ProcessFlow 投稿削除 (c4d5e6f7...)
 *   → 詳細画面の削除ボタン → DELETE /api/posts/:id → 一覧画面へ遷移
 *
 * step 9: 削除後 投稿一覧 確認
 *   // Spec: Scenario post-lifecycle step:9
 *   → URL "/" 確認 → 削除した投稿が一覧に存在しないこと確認
 *
 * === 申し送り事項 ===
 * SCENARIO-1: entities.screenTransitions[] が空のため 3次 path-based fallback で遷移導出。
 *             #864 (events[] 補完) + screenTransitions 補完後に /generate-tests --scenario
 *             を再実行し、TODO コメントを解消すること。
 * SCENARIO-2: auth helper の POST /api/auth/login エンドポイントおよびレスポンスフィールド名
 *             (accessToken) は PLACEHOLDER。diary アプリの実装に合わせて調整すること。
 * SCENARIO-3: data-testid 属性名は PLACEHOLDER。コンポーネント実装に合わせて置換が必要。
 * SCENARIO-4: ProcessFlow httpRoute (POST /api/posts, PATCH /api/posts/:id, DELETE /api/posts/:id)
 *             は diary の ProcessFlow JSON から推定。実際のルートパスを確認すること。
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { seedTestData, truncateTestData, deletePost } from './helpers/db';

// ===HARMONY_GENERATED_SECTION_START scenario=post-lifecycle===

/**
 * テスト用定数
 * PLACEHOLDER: テスト環境の認証情報および入力値に置換すること
 */
const TEST_USER = {
  username: 'testuser',
  password: 'password',  // PLACEHOLDER: 実際のテスト用パスワードに変更
};

const NEW_POST = {
  title: 'E2E テスト投稿タイトル',
  body: 'E2E テスト投稿本文。これはシナリオテスト用のサンプルコンテンツです。',
  status: 'draft' as const,
};

const UPDATED_POST = {
  title: 'E2E テスト投稿タイトル (更新済)',
  body: 'E2E テスト投稿本文 (更新済)。更新操作の確認用。',
};

// ===HARMONY_GENERATED_SECTION_END===

test.describe('投稿ライフサイクル E2E (login → 一覧 → 作成 → 詳細 → 編集 → 削除)', () => {
  let context: BrowserContext;
  let page: Page;
  let createdPostId: number | undefined;

  test.beforeAll(async ({ browser }) => {
    // 認証済みコンテキストを作成
    context = await browser.newContext();
    page = await context.newPage();

    // テストデータ初期化 (D-7: SQLite --workers=1 前提)
    await seedTestData({
      users: [
        {
          username: TEST_USER.username,
          email: `${TEST_USER.username}@example.com`,
          passwordHash: '$2b$10$PLACEHOLDER_HASH',  // PLACEHOLDER: 実際のハッシュに変更
          role: 'user',
        },
      ],
    });
  });

  test.afterAll(async () => {
    // テストデータのクリーンアップ
    await truncateTestData();
    await context.close();
  });

  test.beforeEach(async () => {
    /**
     * Spec: Scenario post-lifecycle step:1
     *   auth-flow: loginAs() — API 経由 JWT 取得 → localStorage セット
     *   techStack.auth.method = "jwt"
     */
    await loginAs(page, TEST_USER);
  });

  test.afterEach(async () => {
    // 各テストで作成した投稿のクリーンアップ
    if (createdPostId !== undefined) {
      try {
        await deletePost(createdPostId);
      } catch {
        // クリーンアップ失敗は無視 (既に削除済みの場合など)
      }
      createdPostId = undefined;
    }
  });

  // =========================================================================
  // step 2: 投稿一覧 表示確認
  // =========================================================================

  test('step 2: 投稿一覧画面が表示される', async () => {
    /**
     * Spec: Scenario post-lifecycle step:2
     * TODO: screenTransitions 補完待ち
     *   遷移導出: path-based fallback (ログイン後 → list kind の "/" へ)
     *   Screen: 31d56212-b654-46dc-b004-096c7382c404 (投稿一覧, kind=list, path=/)
     *   ⚠️ 推測で生成: screenTransitions[] または events[] を補完後に再生成すること
     */
    await page.goto('/');
    await expect(page).toHaveURL('/');

    /**
     * Spec: Screen 31d56212-b654-46dc-b004-096c7382c404 item:posts
     *   direction=output, type=array
     *   data-testid="posts" (親コンテナ)
     */
    // PLACEHOLDER: data-testid が "posts" でない場合は実装に合わせて変更
    await expect(page.getByTestId('posts')).toBeVisible();
  });

  // =========================================================================
  // step 3-4: 新規投稿作成
  // =========================================================================

  test('step 3-4: 新規投稿作成フォームを表示して投稿を作成できる', async () => {
    /**
     * Spec: Scenario post-lifecycle step:3
     * TODO: screenTransitions 補完待ち
     *   遷移導出: path-based fallback (list→form 慣習: 一覧の "新規作成" ボタン → /post/edit)
     *   Screen: 531619ae-0f5f-4f55-8043-03e5a9ef6670 (投稿編集, kind=form, path=/post/edit/:id?)
     *   ⚠️ 推測で生成: :id? なしで新規作成ページとして扱う
     */
    await page.goto('/post/edit');
    await expect(page).toHaveURL(/\/post\/edit/);

    /**
     * Spec: Screen 531619ae-0f5f-4f55-8043-03e5a9ef6670 item:title
     *   direction=input, type=string
     *   data-testid="title"
     * PLACEHOLDER: data-testid 名を実装に合わせて変更
     */
    await expect(page.getByTestId('title')).toBeVisible();

    /**
     * Spec: Screen 531619ae-0f5f-4f55-8043-03e5a9ef6670 item:body
     *   direction=input, type=text (長文)
     *   data-testid="body"
     * PLACEHOLDER: data-testid 名を実装に合わせて変更
     */
    await expect(page.getByTestId('body')).toBeVisible();

    /**
     * Spec: Scenario post-lifecycle step:4 via ProcessFlow 投稿作成 (0671b051-4acc-49cf-ba92-9fa29b47f671)
     *   ProcessFlow: 投稿作成 → httpRoute: POST /api/posts
     *   フォーム入力 → 送信 → API レスポンス → 詳細画面へ遷移
     */
    // フォーム入力
    await page.fill('[data-testid="title"]', NEW_POST.title);
    await page.fill('[data-testid="body"]', NEW_POST.body);

    // status フィールドがある場合 (PLACEHOLDER: 実装に合わせて調整)
    // await page.selectOption('[data-testid="status"]', NEW_POST.status);

    // API 呼び出しを監視しながら送信
    const [response] = await Promise.all([
      page.waitForResponse(
        resp =>
          resp.url().includes('/api/posts') &&
          resp.request().method() === 'POST',
      ),
      // PLACEHOLDER: 送信ボタンの data-testid を実装に合わせて変更
      page.click('[data-testid="submitButton"]'),
    ]);

    /**
     * Spec: Scenario post-lifecycle step:4
     *   ProcessFlow 投稿作成 (0671b051...) responses[201]
     *   POST /api/posts → 201 Created
     */
    expect(response.status()).toBe(201);

    const responseBody = await response.json() as { id: number; title: string };
    expect(responseBody).toHaveProperty('id');
    createdPostId = responseBody.id;  // afterEach cleanup 用

    // 作成後の詳細画面へ遷移確認
    await page.waitForURL(/\/post\/\d+/);
  });

  // =========================================================================
  // step 5: 投稿詳細 表示確認
  // =========================================================================

  test('step 5: 投稿詳細画面が表示され入力した内容が確認できる', async () => {
    /**
     * Spec: Scenario post-lifecycle step:5
     * TODO: screenTransitions 補完待ち
     *   遷移導出: path-based fallback (form→detail: 作成後 → /post/:id へリダイレクト)
     *   Screen: ffec74d0-6c21-45f7-a387-167ac8819255 (投稿詳細, kind=detail, path=/post/:id)
     *   ⚠️ 推測で生成: 作成後の自動リダイレクトを想定
     *
     * 前提: step 3-4 で投稿作成済みの場合、createdPostId が設定されている。
     *       独立テストとして実行する場合は別途テストデータを seed すること。
     */

    // テスト用に投稿を作成してから詳細画面へ
    // (このテストを独立実行する場合は beforeEach のログイン後に直接 URL を開く)
    // PLACEHOLDER: 実際のテストデータ設定方法に合わせて調整

    // 投稿を作成してから詳細画面に遷移 (事前条件を満たすための直接 API 呼び出し)
    const createResponse = await page.request.post('/api/posts', {
      headers: {
        // PLACEHOLDER: localStorage から token を取得する方法を確認
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('accessToken'))}`,
        'Content-Type': 'application/json',
      },
      data: NEW_POST,
    });
    expect(createResponse.status()).toBe(201);
    const { id: postId } = await createResponse.json() as { id: number };
    createdPostId = postId;

    // 詳細画面へ遷移
    await page.goto(`/post/${postId}`);
    await expect(page).toHaveURL(`/post/${postId}`);

    /**
     * Spec: Screen ffec74d0-6c21-45f7-a387-167ac8819255 item:title
     *   direction=output → 投稿タイトルの表示確認
     * PLACEHOLDER: data-testid="postTitle" は実装に合わせて変更
     */
    await expect(page.getByTestId('postTitle')).toContainText(NEW_POST.title);

    /**
     * Spec: Screen ffec74d0-6c21-45f7-a387-167ac8819255 item:body
     *   direction=output → 投稿本文の表示確認
     * PLACEHOLDER: data-testid="postBody" は実装に合わせて変更
     */
    await expect(page.getByTestId('postBody')).toContainText(NEW_POST.body);
  });

  // =========================================================================
  // step 6-7: 投稿編集
  // =========================================================================

  test('step 6-7: 投稿編集フォームで内容を更新できる', async () => {
    // 事前条件: 投稿を作成
    const createResponse = await page.request.post('/api/posts', {
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('accessToken'))}`,
        'Content-Type': 'application/json',
      },
      data: NEW_POST,
    });
    expect(createResponse.status()).toBe(201);
    const { id: postId } = await createResponse.json() as { id: number };
    createdPostId = postId;

    // 詳細画面から編集画面へ遷移
    await page.goto(`/post/${postId}`);

    /**
     * Spec: Scenario post-lifecycle step:6
     * TODO: screenTransitions 補完待ち
     *   遷移導出: path-based fallback (detail→form 慣習: 詳細の "編集" ボタン → /post/edit/:id)
     *   Screen: 531619ae-0f5f-4f55-8043-03e5a9ef6670 (投稿編集, kind=form, path=/post/edit/:id?)
     *   ⚠️ 推測で生成: 詳細画面の "editButton" をクリックして編集画面へ遷移
     */
    // PLACEHOLDER: 編集ボタンの data-testid を実装に合わせて変更
    await page.click('[data-testid="editButton"]');
    await page.waitForURL(`/post/edit/${postId}`);

    /**
     * Spec: Screen 531619ae-0f5f-4f55-8043-03e5a9ef6670 item:title
     *   direction=input — 既存の投稿タイトルがフォームに入っていること (pre-populate)
     */
    await expect(page.getByTestId('title')).toHaveValue(NEW_POST.title);

    /**
     * Spec: Scenario post-lifecycle step:7 via ProcessFlow 投稿更新 (b3a1c2d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d)
     *   ProcessFlow: 投稿更新 → httpRoute: PATCH /api/posts/:id
     *   フォーム上書き → 保存 → API レスポンス → 詳細画面へ遷移
     */
    // フォーム内容を上書き
    await page.fill('[data-testid="title"]', UPDATED_POST.title);
    await page.fill('[data-testid="body"]', UPDATED_POST.body);

    // 保存 API 呼び出しを監視
    const [updateResponse] = await Promise.all([
      page.waitForResponse(
        resp =>
          resp.url().includes(`/api/posts/${postId}`) &&
          (resp.request().method() === 'PATCH' || resp.request().method() === 'PUT'),
      ),
      page.click('[data-testid="submitButton"]'),
    ]);

    /**
     * Spec: ProcessFlow 投稿更新 (b3a1c2d4...) responses[200]
     *   PATCH /api/posts/:id → 200 OK
     */
    expect(updateResponse.status()).toBe(200);

    // 更新後に詳細画面に遷移して内容確認
    await page.waitForURL(`/post/${postId}`);
    await expect(page.getByTestId('postTitle')).toContainText(UPDATED_POST.title);
    await expect(page.getByTestId('postBody')).toContainText(UPDATED_POST.body);
  });

  // =========================================================================
  // step 8-9: 投稿削除
  // =========================================================================

  test('step 8-9: 投稿を削除すると一覧から消える', async () => {
    // 事前条件: 投稿を作成
    const createResponse = await page.request.post('/api/posts', {
      headers: {
        Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('accessToken'))}`,
        'Content-Type': 'application/json',
      },
      data: NEW_POST,
    });
    expect(createResponse.status()).toBe(201);
    const { id: postId } = await createResponse.json() as { id: number };
    createdPostId = postId;

    // 詳細画面に遷移
    await page.goto(`/post/${postId}`);
    await expect(page).toHaveURL(`/post/${postId}`);

    /**
     * Spec: Scenario post-lifecycle step:8 via ProcessFlow 投稿削除 (c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f)
     *   ProcessFlow: 投稿削除 → httpRoute: DELETE /api/posts/:id
     *   削除ボタンクリック → DELETE API → 一覧画面へ遷移
     * TODO: screenTransitions 補完待ち
     *   ⚠️ 推測で生成: 詳細画面の "deleteButton" をクリックして削除
     */
    // 削除 API 呼び出しを監視
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        resp =>
          resp.url().includes(`/api/posts/${postId}`) &&
          resp.request().method() === 'DELETE',
      ),
      // PLACEHOLDER: 削除ボタンの data-testid を実装に合わせて変更
      page.click('[data-testid="deleteButton"]'),
    ]);

    /**
     * Spec: ProcessFlow 投稿削除 (c4d5e6f7...) responses[200]
     *   DELETE /api/posts/:id → 200 OK
     */
    expect(deleteResponse.status()).toBe(200);

    /**
     * Spec: Scenario post-lifecycle step:9
     * TODO: screenTransitions 補完待ち
     *   遷移導出: path-based fallback (form/detail→list 慣習: 削除後 → "/" へリダイレクト)
     *   ⚠️ 推測で生成
     */
    // 削除後に一覧画面へ遷移
    await page.waitForURL('/');
    await expect(page).toHaveURL('/');

    /**
     * Spec: Screen 31d56212-b654-46dc-b004-096c7382c404 item:posts
     *   削除した投稿が一覧に存在しないことを確認
     */
    // 削除した投稿のタイトルが一覧に表示されないことを確認
    const postItems = page.getByTestId(`post-${postId}`);
    await expect(postItems).toHaveCount(0);

    // afterEach の cleanup は不要 (削除済み)
    createdPostId = undefined;
  });

  // =========================================================================
  // 完全シナリオ (step 1〜9 を 1 テストで通し実行)
  // =========================================================================

  test('完全シナリオ: login → 一覧 → 作成 → 詳細 → 編集 → 削除 の一連操作', async () => {
    /**
     * Spec: Scenario post-lifecycle step:1〜9 (通しテスト)
     *   全ステップを単一 test() 内で実行。各ステップに anchor コメントあり。
     *
     * このテストは UI スモークテストとして、シナリオ全体が動作することを確認する。
     * 各ステップの詳細検証は個別テストで行う。
     */

    // --- step 2: 投稿一覧 ---
    /**
     * Spec: Scenario post-lifecycle step:2
     * TODO: screenTransitions 補完待ち
     */
    await page.goto('/');
    await expect(page.getByTestId('posts')).toBeVisible();

    // --- step 3: 新規作成フォーム ---
    /**
     * Spec: Scenario post-lifecycle step:3
     * TODO: screenTransitions 補完待ち
     *   path-based fallback: list→form (/post/edit)
     */
    await page.goto('/post/edit');
    await expect(page.getByTestId('title')).toBeVisible();

    // --- step 4: 投稿送信 ---
    /**
     * Spec: Scenario post-lifecycle step:4 via ProcessFlow 投稿作成 (0671b051...)
     */
    await page.fill('[data-testid="title"]', NEW_POST.title);
    await page.fill('[data-testid="body"]', NEW_POST.body);

    const [createResp] = await Promise.all([
      page.waitForResponse(
        resp => resp.url().includes('/api/posts') && resp.request().method() === 'POST',
      ),
      page.click('[data-testid="submitButton"]'),
    ]);
    expect(createResp.status()).toBe(201);
    const { id: postId } = await createResp.json() as { id: number };
    createdPostId = postId;

    // --- step 5: 詳細画面 ---
    /**
     * Spec: Scenario post-lifecycle step:5
     * TODO: screenTransitions 補完待ち
     */
    await page.waitForURL(/\/post\/\d+/);
    await expect(page.getByTestId('postTitle')).toContainText(NEW_POST.title);

    // --- step 6: 編集フォームへ ---
    /**
     * Spec: Scenario post-lifecycle step:6
     * TODO: screenTransitions 補完待ち
     *   path-based fallback: detail→form (/post/edit/:id)
     */
    await page.click('[data-testid="editButton"]');
    await page.waitForURL(`/post/edit/${postId}`);
    await expect(page.getByTestId('title')).toHaveValue(NEW_POST.title);

    // --- step 7: 投稿更新 ---
    /**
     * Spec: Scenario post-lifecycle step:7 via ProcessFlow 投稿更新 (b3a1c2d4...)
     */
    await page.fill('[data-testid="title"]', UPDATED_POST.title);
    await page.fill('[data-testid="body"]', UPDATED_POST.body);

    const [updateResp] = await Promise.all([
      page.waitForResponse(
        resp =>
          resp.url().includes(`/api/posts/${postId}`) &&
          (resp.request().method() === 'PATCH' || resp.request().method() === 'PUT'),
      ),
      page.click('[data-testid="submitButton"]'),
    ]);
    expect(updateResp.status()).toBe(200);

    await page.waitForURL(`/post/${postId}`);
    await expect(page.getByTestId('postTitle')).toContainText(UPDATED_POST.title);

    // --- step 8: 投稿削除 ---
    /**
     * Spec: Scenario post-lifecycle step:8 via ProcessFlow 投稿削除 (c4d5e6f7...)
     */
    const [deleteResp] = await Promise.all([
      page.waitForResponse(
        resp =>
          resp.url().includes(`/api/posts/${postId}`) &&
          resp.request().method() === 'DELETE',
      ),
      page.click('[data-testid="deleteButton"]'),
    ]);
    expect(deleteResp.status()).toBe(200);

    // --- step 9: 削除後 一覧確認 ---
    /**
     * Spec: Scenario post-lifecycle step:9
     * TODO: screenTransitions 補完待ち
     *   path-based fallback: form→list (削除後 → "/")
     */
    await page.waitForURL('/');
    await expect(page.getByTestId(`post-${postId}`)).toHaveCount(0);

    createdPostId = undefined;  // 削除済みのため cleanup 不要
  });
});
