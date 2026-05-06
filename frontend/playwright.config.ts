import { defineConfig, devices } from "@playwright/test";

// worktree 環境では VITE_PORT で別 port を指定可能 (#703 R-5 D-2 port 競合解決)
const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5173", 10);
const BASE_URL = `http://localhost:${VITE_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // テスト前に dev サーバーを自動起動
  webServer: {
    command: `npm run dev -- --port ${VITE_PORT}`,
    url: BASE_URL,
    reuseExistingServer: true, // 既存サーバーが起動中ならそれを再利用 (worktree 環境でも安全)
    timeout: 30000,
  },
});
