// playwright.config.ts
//
// diary アプリ E2E テスト — Playwright 設定
//
// PLACEHOLDER 解決表:
//   PLAYWRIGHT_BASE_URL : Next.js dev server の URL (default: http://localhost:3000)
//   testDir             : E2E スペックファイルの配置ディレクトリ
//
// 実行方法:
//   # 事前に以下を手動起動しておくこと (AI は dev server を spawn しない)
//   cd backend && npm run dev       # Harmony backend (port 5179)
//   cd apps/api && npm run dev      # NestJS API (port 3001)
//   cd apps/web && npm run dev      # Next.js (port 3000)
//
//   # E2E テスト実行 (SQLite: --workers=1 必須 D-7)
//   npx playwright test --workers=1
//
//   # 特定スペックのみ実行
//   npx playwright test post-lifecycle --workers=1
//
//   # ヘッドフル実行 (デバッグ時)
//   npx playwright test --headed --workers=1

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',

  // SQLite --workers=1 必須 (D-7)
  // SQLite は並列実行すると DB ロック競合が発生する。
  // Postgres/MySQL の場合は fullyParallel: true, workers: undefined に変更可。
  fullyParallel: false,
  workers: 1,

  // CI 設定
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    // Next.js dev server の URL
    // 環境変数 PLAYWRIGHT_BASE_URL で上書き可能
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

    // ヘッドレス設定 (CI では headless: true、ローカルでは false も可)
    headless: !!process.env.CI,

    // スクリーンショット / トレース (失敗時のみ)
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',

    // タイムアウト設定 (ネットワーク遅延を考慮)
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  // テストタイムアウト (1 シナリオあたり)
  timeout: 60_000,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // CI では単一ブラウザで十分
    // 複数ブラウザでのテストが必要な場合はコメントアウトを外す:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // ========= webServer セクション (手動起動前提のためコメントアウト) =========
  // AI は dev server を spawn しない原則 (feedback_no_ai_managed_dev_server.md)
  // 事前に以下を手動起動してください:
  //   cd apps/api && npm run dev   (NestJS API port 3001)
  //   cd apps/web && npm run dev   (Next.js port 3000)
  //
  // 自動起動が必要な場合はコメントアウトを外す:
  // webServer: [
  //   {
  //     command: 'cd apps/api && npm run start:dev',
  //     url: 'http://localhost:3001/api/health',
  //     reuseExistingServer: !process.env.CI,
  //     timeout: 60_000,
  //   },
  //   {
  //     command: 'cd apps/web && npm run dev',
  //     url: 'http://localhost:3000',
  //     reuseExistingServer: !process.env.CI,
  //     timeout: 60_000,
  //   },
  // ],
  // =========================================================================
});
