/**
 * playwright.config.worktree.ts — ワークツリー用 Playwright 設定 (#703 R-5)
 *
 * main worktree (port 5173) と共存するため port 5174 を使用する。
 *
 * Usage:
 *   npx playwright test --config playwright.config.worktree.ts
 *
 * (vite.config.worktree.ts でサーバーを起動してから実行するか、
 *  webServer.command でワークツリー用 vite を自動起動する)
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx vite --config vite.config.worktree.ts`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
