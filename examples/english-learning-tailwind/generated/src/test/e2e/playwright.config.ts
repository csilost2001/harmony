import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * Playwright E2E 設定
 *
 * database.type = "sqlite" → workers=1, fullyParallel=false (共有 DB 競合防止)
 * techStack.auth.method = "jwt" → 認証は loginAs() (API 経由) ヘルパーで処理
 *
 * webServer: Playwright framework が dev server lifecycle を管理
 * (feedback_no_ai_managed_dev_server.md は AI Bash background spawn の禁止規約 — Playwright webServer は対象外)
 */

// Project root = generated/ (3 levels up from src/test/e2e/)
const projectRoot = path.resolve(__dirname, '../../../');
const dbPath = path.resolve(projectRoot, 'prisma/dev.db');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.spec.ts',

  // sqlite 共有 DB のため並列実行禁止
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',

  globalSetup: path.resolve(__dirname, 'global-setup.ts'),

  use: {
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

  webServer: [
    {
      command: `DATABASE_URL=file:${dbPath} npm run start:backend`,
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      cwd: projectRoot,
    },
    {
      command: 'npm run start:frontend',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      cwd: projectRoot,
    },
  ],
});
