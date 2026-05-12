import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 設定
 *
 * database.type = "postgresql" → fullyParallel 可 (D-7: SQLite の場合のみ workers=1 必須)
 * techStack.auth.method = "jwt" → 認証は loginAs() (API 経由) ヘルパーで処理
 *
 * webServer はコメントアウト — AI は dev server を spawn しない
 * (feedback_no_ai_managed_dev_server.md 参照)
 * 手動で `npm run dev` (frontend) + `npm run dev` (backend) を起動してから実行すること。
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.spec.ts',

  // database.type="postgresql" → 並列実行可
  fullyParallel: true,
  workers: undefined, // デフォルト (CPU コア数に応じて自動)

  // sqlite の場合は以下を有効化:
  // fullyParallel: false,
  // workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',

  use: {
    // PLACEHOLDER: baseURL を確認すること (frontend dev server の URL)
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // webServer はコメントアウト — AI は dev server を spawn しない
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
