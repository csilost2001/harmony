import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  fullyParallel: false, // SQLite + seed reset 都合
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'test-results/html', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // webServer はコメントアウト — 手動起動前提
  // webServer: [
  //   { command: 'DATABASE_URL=file:./prisma/dev.db npx ts-node src/main.ts', port: 3001 },
  //   { command: 'npx next dev -p 3000', port: 3000 },
  // ],
});
