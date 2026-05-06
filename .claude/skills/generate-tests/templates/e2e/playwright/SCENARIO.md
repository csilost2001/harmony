# SCENARIO.md — Playwright E2E マルチ画面シナリオテスト構造規約

`/generate-tests` スキルが `--scenario` 引数またはシナリオ起動時に生成する
Playwright E2E スペックファイルの構造規約とコードテンプレートを定義する。

対象 techStack:
- `frontend.framework = "next"` + `frontend.library = "react"` (E2E は常に Playwright — D-6 確定)
- SQLite 環境では `--workers=1` 必須 (D-7)

---

## 1. Section 構成 (8 sections)

| Section | 内容 |
|---------|------|
| **scenario** | シナリオ概要と spec anchor header |
| **setup-teardown** | `beforeAll` / `afterAll` / `beforeEach` / `afterEach` |
| **auth-flow** | ログイン helper 呼び出し + cookie/localStorage セット |
| **navigation** | `page.goto(<screenPath>)` + URL 検証 |
| **dom-assertion** | `data-testid` 要素 query + 値確認 |
| **api-mock** | `page.route()` または `page.request` で API モック/ベリファイ |
| **db-cleanup** | Prisma seed / truncate ヘルパー呼び出し |
| **playwright-config** | `playwright.config.ts` 雛形 |

---

## 2. ファイル先頭 header (D-1 / D-4 anchor)

```typescript
/**
 * E2E シナリオテスト: <シナリオ名>
 *
 * // ===HARMONY_GENERATED_SECTION_START scenario=<scenarioId>===
 * // このコメントブロックは /generate-tests スキル再実行時に overwrite される。
 * // anchor の外側 (人手追記 assertion) は保護される。
 * // ===HARMONY_GENERATED_SECTION_END===
 *
 * シナリオ: <シナリオ名>
 * 対象画面: <screenId-1> → <screenId-2> → ... → <screenId-N>
 * 遷移導出: <1次: screenTransitions / 2次: events.handlerFlowId / 3次: path-based>
 *
 * === screen path index ===
 * <screenId-1>: path="<path1>" (screen: <名前1>)
 * <screenId-2>: path="<path2>" (screen: <名前2>)
 * ...
 *
 * === scenario step mapping ===
 *
 * step 1: ログイン (<loginScreenId>)
 *   → POST /auth/login → JWT 取得 → cookies / localStorage セット
 *
 * step 2: <画面名1> 表示 (<screenId1>)
 *   // Spec: Screen <screenId1> via screenTransition <transitionId>
 *   → page.goto('<path1>') → data-testid 要素確認
 *
 * step N: <操作名>
 *   // Spec: Scenario <scenarioId> step:<N>
 *   → <操作内容>
 *
 * === 申し送り事項 ===
 * SCENARIO-1: screenTransitions が空のため path-based fallback で遷移導出。
 *             #864 (events[] 補完) + screenTransitions 補完後に再生成すること。
 */
```

---

## 3. import 規約

```typescript
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { seedTestData, truncateTestData } from './helpers/db';
```

---

## 4. setup-teardown テンプレート

### 4-1. test.describe + beforeAll / afterAll

```typescript
test.describe('<シナリオ名> E2E', () => {
  let context: BrowserContext;
  let page: Page;

  // ===HARMONY_GENERATED_SECTION_START scenario=<scenarioId>===

  test.beforeAll(async ({ browser }) => {
    // 認証済みコンテキストを作成
    context = await browser.newContext();
    page = await context.newPage();

    // テストデータ初期化 (D-7: SQLite --workers=1 前提)
    await seedTestData();
  });

  test.afterAll(async () => {
    await truncateTestData();
    await context.close();
  });

  // ===HARMONY_GENERATED_SECTION_END===

  test.beforeEach(async () => {
    // 各テストの前にログイン状態をリセット (必要に応じて)
    await loginAs(page, { username: '<TEST_USERNAME>', password: '<TEST_PASSWORD>' });
  });

  test.afterEach(async () => {
    // 各テスト後のクリーンアップ (テスト間独立性確保)
    // 特定テストで作成したリソースは test 内の try/finally で cleanup
  });

  // テストケース群 ...
});
```

### 4-2. SQLite --workers=1 設定 (D-7)

> **重要**: SQLite は並列実行すると DB ロック衝突が発生する。
> `playwright.config.ts` で `workers: 1` を設定し、`--workers=1` フラグで実行すること。
> Postgres/MySQL なら並列可。`fullyParallel: false` も合わせて設定する。

---

## 5. auth-flow テンプレート

### 5-1. API 経由ログイン (推奨: 高速)

```typescript
// helpers/auth.ts で定義 (Section 8 参照)

// test 内での使い方:
test.beforeEach(async () => {
  /**
   * Spec: Scenario <scenarioId> step:1
   *   auth-flow: POST /auth/login → JWT → cookies セット
   */
  await loginAs(page, { username: 'testuser', password: 'password' });
});
```

### 5-2. UI 経由ログイン (フォールバック)

```typescript
// ログイン画面が必要なシナリオの場合:
async function loginViaUI(page: Page, username: string, password: string) {
  /**
   * Spec: Scenario <scenarioId> step:1
   *   auth-flow: ログイン画面 UI 操作 (API 経由が失敗した場合の fallback)
   */
  await page.goto('/login');
  await page.fill('[data-testid="username"]', username);
  await page.fill('[data-testid="password"]', password);
  await page.click('[data-testid="loginButton"]');
  await page.waitForURL('/');  // ログイン後のリダイレクト先
}
```

---

## 6. navigation テンプレート

### 6-1. screenTransitions 由来の遷移 (1次ソース)

```typescript
/**
 * Spec: Screen <fromScreenId> via screenTransition <transitionId>
 *   from: <fromScreenName> (<fromPath>)
 *   to: <toScreenName> (<toPath>)
 *   trigger: <trigger (button click / link / etc.)>
 */
// 前画面でアクション実行
await page.click('[data-testid="<triggerItemId>"]');
// 遷移先画面の確認
await page.waitForURL('<toPath>');
expect(page.url()).toContain('<toPath>');
```

### 6-2. events.handlerFlowId 由来の遷移 (2次ソース)

```typescript
/**
 * Spec: Scenario <scenarioId> step:<N>
 *   遷移導出: events.handlerFlowId=<flowId> → ProcessFlow 完了後の next screen
 *   ProcessFlow: <flowName> (<flowId>)
 *   httpRoute: <method> <path>
 */
// ProcessFlow を発火するボタンをクリック
await page.click('[data-testid="<triggerItemId>"]');
// API 完了後の画面遷移を待機
await page.waitForURL('<nextScreenPath>');
```

### 6-3. path-based 推測遷移 (3次 fallback)

```typescript
/**
 * Spec: Scenario <scenarioId> step:<N>
 * TODO: screenTransitions 補完待ち
 *   遷移導出: path-based fallback (list→detail / detail→form / form→list の慣習)
 *   from: <fromScreenName> (kind=<fromKind>, path=<fromPath>)
 *   to: <toScreenName> (kind=<toKind>, path=<toPath>)
 *   ⚠️ 推測で生成: screenTransitions[] または events[] を補完後に再生成すること
 */
// PLACEHOLDER: 実際の遷移 trigger element に置き換える
await page.click('[data-testid="PLACEHOLDER_TRIGGER"]');
await page.waitForURL('<toPath>');
```

---

## 7. dom-assertion テンプレート

### 7-1. 要素存在確認

```typescript
/**
 * Spec: Screen <screenId> item:<itemId>
 *   direction=<direction>, type=<type>
 *   data-testid="<itemId>"
 */
await expect(page.getByTestId('<itemId>')).toBeVisible();
```

### 7-2. テキスト値確認

```typescript
/**
 * Spec: Screen <screenId> item:<itemId>
 *   direction=output → 表示値確認
 */
await expect(page.getByTestId('<itemId>')).toHaveText('<expectedText>');
// または正規表現
await expect(page.getByTestId('<itemId>')).toContainText('<partialText>');
```

### 7-3. input 値確認

```typescript
/**
 * Spec: Screen <screenId> item:<inputItemId>
 *   direction=input, type=<type>
 */
await expect(page.getByTestId('<inputItemId>')).toHaveValue('<expectedValue>');
```

### 7-4. リスト件数確認

```typescript
/**
 * Spec: Screen <screenId> item:<listItemId>
 *   direction=output, type=array → 件数確認
 */
const items = page.getByTestId('<listItemId>');
await expect(items).toHaveCount(<expectedCount>);
```

---

## 8. api-mock テンプレート

### 8-1. page.route() で API をインターセプト

```typescript
// テスト内またはbeforeEachで設定
await page.route('**/api/<path>', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ <mockData> }),
  });
});
```

### 8-2. API 呼び出しを waitForResponse で検証

```typescript
/**
 * Spec: Scenario <scenarioId> step:<N>
 *   API verify: <method> <path> が正しい body で呼ばれること
 */
const [response] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('<apiPath>') && resp.request().method() === '<METHOD>'),
  page.click('[data-testid="<triggerItemId>"]'),
]);

expect(response.status()).toBe(<expectedStatus>);
const body = await response.json();
expect(body).toMatchObject({ <expectedBody> });
```

### 8-3. Request body の確認

```typescript
const [request] = await Promise.all([
  page.waitForRequest(req => req.url().includes('<apiPath>') && req.method() === 'POST'),
  page.click('[data-testid="<submitButton>"]'),
]);

const postBody = request.postDataJSON();
expect(postBody).toMatchObject({
  <field>: '<expectedValue>',
});
```

---

## 9. db-cleanup テンプレート

### 9-1. beforeEach seed

```typescript
test.beforeEach(async () => {
  // DB を known state にリセット (テスト間独立性)
  await seedTestData({
    users: [{ username: 'testuser', password: 'password', role: 'user' }],
    // ... 必要な seed data
  });
});
```

### 9-2. afterEach truncate

```typescript
test.afterEach(async () => {
  // テストデータの削除 (外部キー依存順に削除)
  await truncateTestData();
});
```

### 9-3. test 内 cleanup (特定リソース)

```typescript
test('投稿作成 → 詳細表示', async () => {
  let createdPostId: number | undefined;

  try {
    // 投稿作成操作
    // ...
    createdPostId = <取得した ID>;

    // assertions
    // ...
  } finally {
    // cleanup: 作成した投稿を削除
    if (createdPostId) {
      await helpers.deletePost(createdPostId);
    }
  }
});
```

---

## 10. playwright-config 雛形 (Section 8)

> **注意**: AI は `npm run dev` を background spawn しない (memory `feedback_no_ai_managed_dev_server.md`)。
> 事前に `backend` と `frontend` を手動起動しておくこと。
> `playwright.config.ts` の `webServer` セクションは雛形として提示するが、
> **コメントアウト状態で提供**する。自動起動が必要な場合は手動でコメントアウトを外すこと。

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',

  // SQLite --workers=1 必須 (D-7)
  // Postgres/MySQL の場合は fullyParallel: true, workers: undefined に変更可
  fullyParallel: false,
  workers: 1,

  // CI 環境設定
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    // Next.js dev server の URL
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

    // ヘッドレス設定 (CI では headless: true)
    headless: !!process.env.CI,

    // スクリーンショットは失敗時のみ
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // CI では単一ブラウザのみ
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
  ],

  // ========= webServer セクション (手動起動前提のためコメントアウト) =========
  // AI は dev server を spawn しない原則 (feedback_no_ai_managed_dev_server.md)
  // 事前に以下を手動起動してください:
  //   cd backend && npm run dev    (port 5179)
  //   cd apps/api && npm run dev   (NestJS API port 3001)
  //   cd apps/web && npm run dev   (Next.js port 3000)
  //
  // webServer: [
  //   {
  //     command: 'cd apps/api && npm run dev',
  //     url: 'http://localhost:3001/health',
  //     reuseExistingServer: !process.env.CI,
  //   },
  //   {
  //     command: 'cd apps/web && npm run dev',
  //     url: 'http://localhost:3000',
  //     reuseExistingServer: !process.env.CI,
  //   },
  // ],
  // =========================================================================
});
```

---

## 11. auth helper テンプレート (helpers/auth.ts)

```typescript
// helpers/auth.ts
import { type Page } from '@playwright/test';

export interface LoginCredentials {
  username: string;
  password: string;
}

/**
 * API 経由ログイン helper (推奨: UI 経由より高速)
 * POST /auth/login → JWT 取得 → cookies / localStorage にセット
 */
export async function loginAs(page: Page, credentials: LoginCredentials): Promise<void> {
  // API 経由でトークンを取得
  const response = await page.request.post('/api/auth/login', {
    data: {
      username: credentials.username,
      password: credentials.password,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `ログイン失敗: ${response.status()} ${await response.text()}`,
    );
  }

  const { accessToken } = await response.json() as { accessToken: string };

  // JWT を localStorage にセット (Next.js アプリの auth 方式に応じて調整)
  await page.evaluate((token: string) => {
    localStorage.setItem('accessToken', token);
  }, accessToken);

  // または cookie にセット:
  // await page.context().addCookies([{
  //   name: 'accessToken',
  //   value: accessToken,
  //   url: page.url(),
  // }]);
}

/**
 * UI 経由ログイン (フォールバック: API が /auth/login を提供しない場合)
 */
export async function loginViaUI(page: Page, credentials: LoginCredentials): Promise<void> {
  await page.goto('/login');
  await page.fill('[data-testid="username"]', credentials.username);
  await page.fill('[data-testid="password"]', credentials.password);
  await page.click('[data-testid="loginButton"]');
  // ログイン後のリダイレクト先まで待機
  await page.waitForURL(url => !url.includes('/login'));
}

/**
 * ログアウト helper
 */
export async function logout(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('accessToken');
  });
}
```

---

## 12. db helper テンプレート (helpers/db.ts)

```typescript
// helpers/db.ts
import { PrismaClient } from '@prisma/client';

// DATABASE_URL 絶対パス対応 (Spike L-6 知見)
const dbUrl =
  process.env.DATABASE_URL ??
  `file:${require('path').resolve(process.cwd(), 'prisma/dev.db')}`;

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

export interface SeedOptions {
  users?: Array<{
    username: string;
    email?: string;
    password: string;
    role?: string;
  }>;
  // 追加 seed データ型をここに拡張
}

/**
 * テストデータ seed
 * beforeEach / beforeAll で呼び出す
 */
export async function seedTestData(options: SeedOptions = {}): Promise<void> {
  // デフォルト seed データ
  const { users = [{ username: 'testuser', password: 'hashed_password', email: 'test@example.com' }] } = options;

  // PLACEHOLDER: 実際の seed ロジックを実装
  // seed.ts の createUser / createPost 等のヘルパーを再利用することを推奨
  //
  // 例:
  // for (const user of users) {
  //   await prisma.user.upsert({
  //     where: { username: user.username },
  //     update: {},
  //     create: {
  //       username: user.username,
  //       email: user.email ?? `${user.username}@test.example`,
  //       password: user.password,
  //       role: user.role ?? 'user',
  //     },
  //   });
  // }
}

/**
 * テストデータ truncate
 * afterEach / afterAll で呼び出す
 * 外部キー依存順に削除すること
 */
export async function truncateTestData(): Promise<void> {
  // PLACEHOLDER: テーブル定義に合わせた削除順序に変更すること
  // 外部キー依存の逆順で削除 (child → parent)
  //
  // 例 (diary アプリ):
  // await prisma.postTag.deleteMany({});
  // await prisma.photo.deleteMany({});
  // await prisma.post.deleteMany({});
  // await prisma.tag.deleteMany({});
  // await prisma.user.deleteMany({});

  await prisma.$disconnect();
}

export { prisma };
```

---

## 13. screen path 解決ロジック

シナリオ生成時に harmony.json の `entities.screens[]` を index 化する。

```typescript
// AI がシナリオ生成時に内部的に行う処理 (スキル実行時の変換ロジック)

// harmony.json から screen path index を構築
const screenPathIndex: Record<string, { name: string; path: string; kind: string }> = {};
for (const screen of harmonyJson.entities.screens) {
  screenPathIndex[screen.id] = {
    name: screen.name,
    path: screen.path,
    kind: screen.kind,
  };
}

// screen ID から path を解決
function resolveScreenPath(screenId: string): string {
  const screen = screenPathIndex[screenId];
  if (!screen) {
    return '/PLACEHOLDER_PATH';  // 解決失敗
  }
  // 動的パラメータは Playwright の正規表現で解決
  // 例: /post/:id → /post/1 (テストでは具体的な ID を使う)
  return screen.path.replace(/:(\w+)/g, '<$1_PLACEHOLDER>');
}
```

---

## 14. 遷移導出 3 段 fallback ロジック

```
遷移導出アルゴリズム (harmony.json → screenTransition chain):

1次ソース: screenTransitions[]
  if entities.screenTransitions.length > 0:
    → screenTransitions の from/to/trigger から遷移チェーンを構築
    → anchor: // Spec: Screen <fromId> via screenTransition <transitionId>

2次ソース: events[].handlerFlowId → ProcessFlow → next screen
  elif screen.events に handlerFlowId あり:
    → handlerFlowId の ProcessFlow を読み込み
    → ProcessFlow 完了後の画面遷移 (ProcessFlow.meta.nextScreen や httpRoute.redirectTo) から導出
    → anchor: // Spec: Scenario <id> step:<N> via events[].handlerFlowId

3次ソース: path-based 推測 (list→detail / detail→form / form→list)
  else:
    → screen.kind の慣習から遷移先を推測:
        "list"   → "detail" (一覧 → 詳細: list item クリック)
        "detail" → "form"   (詳細 → 編集: 編集ボタンクリック)
        "form"   → "list"   (編集 → 一覧: 保存/キャンセルで戻る)
        "login"  → "list"   (ログイン → トップ: 認証成功後)
    → anchor に TODO コメント明記:
        // TODO: screenTransitions 補完待ち
        // ⚠️ 推測で生成: screenTransitions[] または events[] を補完後に再生成すること

fallback で生成したシナリオは README の PLACEHOLDER 解決表に記録する。
```

---

## 15. /generate-tests 起動形式 (P4)

```
# フロー指定 (processFlow の screenTransitions チェーン展開)
/generate-tests <flowId>

# スクリーン指定シナリオ (2 画面間の E2E シナリオ)
/generate-tests --scenario <screenId-from> <screenId-to>

# シナリオ名指定
/generate-tests --scenario-name "<シナリオ名>" <screenId-1> <screenId-2> ... <screenId-N>
```

ルーティング判定 (Step 0 追加):
- `--scenario` フラグあり → P4 E2E シナリオ生成 (本テンプレート)
- `--scenario-name` フラグあり → P4 E2E シナリオ生成 (シナリオ名付き)
- フラグなし + UUID → 既存の ProcessFlow / Screen 判定 (P1/P2/P3) へ

---

## 16. 最終レポート形式 (P4)

```markdown
## /generate-tests 完了: <シナリオ名> (E2E シナリオ)

### 入力
- シナリオ: <シナリオ名>
- 対象画面: <screenId-1> → ... → <screenId-N>
- 遷移導出: <1次/2次/3次> (screenTransitions[] が空のため path-based fallback)

### screen path index
| screenId | name | path | kind |
|---|---|---|---|
| <id1> | <name1> | <path1> | <kind1> |
| ...

### 生成ファイル
- `<出力先>/<scenario-name>.e2e.spec.ts` (N 行, M テストステップ)
- `<出力先>/playwright.config.ts` (workers=1 設定)
- `<出力先>/helpers/auth.ts` (loginAs helper)
- `<出力先>/helpers/db.ts` (seed/truncate helper)
- `<出力先>/README.md` (PLACEHOLDER 解決表 + 起動方法)

### シナリオステップ一覧
| step | 画面 | 操作 | spec anchor | 遷移導出 |
|---|---|---|---|---|
| 1 | ログイン | loginAs() API 経由 | Scenario <id> step:1 | — |
| 2 | <name1> | page.goto('<path1>') | Screen <id1> via screenTransition <tid> | 1次 |
| ... | ... | ... | ... | ... |

### smoke 検証
- playwright 実行: ✓ N/N pass / スキップ (<理由>) / ❌ (<エラー詳細>)

### 申し送り
- SCENARIO-1: screenTransitions 空 → path-based fallback。補完後に再生成推奨。
- TODO: <PLACEHOLDER 解決が必要な箇所>
```
