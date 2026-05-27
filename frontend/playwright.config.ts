import { defineConfig, devices } from "@playwright/test";

// worktree 環境では VITE_PORT で別 port を指定可能 (#703 R-5 D-2 port 競合解決)
const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5173", 10);
const BASE_URL = `http://localhost:${VITE_PORT}`;
const cliIncludesEndurance = process.argv.some((arg) => arg.includes("@endurance"));
const includeEndurance = process.env.E2E_INCLUDE_ENDURANCE === "1" || cliIncludesEndurance;

export default defineConfig({
  testDir: "./e2e",
  // e2e/__fixtures__/builders/*.test.ts は Vitest テストのため Playwright から除外
  testMatch: /.*\.spec\.ts$/,
  // #1359: lockdown-routing.spec.ts は専用 config (playwright.lockdown.config.ts) で
  // backend を `DESIGNER_DATA_DIR` 付き lockdown モードで起動した状態でのみ通る。
  // 主 config の backend は通常モードのため本 spec は必ず fail する → 主 config から除外。
  // 実行は `npm run test:e2e:lockdown` で別途。
  testIgnore: /lockdown-routing\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // #930: @endurance はデフォルトで除外、明示 grep または E2E_INCLUDE_ENDURANCE=1 で実行
  grepInvert: includeEndurance ? undefined : /@endurance/,
  retries: process.env.CI ? 1 : 0,
  // #1359 Phase 3: 並列 worker 数を 2 に既定化 (旧: workers: 1)。
  // Phase 1 (固定 path → worker prefix 化) + Phase 2 (recentStore atomic write による
  // workers > 1 race 解消) + tab-management の dispatchEvent fallback 整備で workers=2
  // 並列実行に必要な infra が整った。実機計測 (workers=2) で fail 数は本シリーズ前の
  // 11 → 6 まで減少、残 6 件は #1342 の pre-existing fail (step-ops×2 / folder-picker×3 +
  // 偶発 flake×1) で本シリーズスコープ外。`undefined` で CPU 数依存 auto-detect ではなく
  // 明示 `2` を採用したのは、開発機 CPU 数によるばらつきを排し runtime 性質を再現可能に
  // するため。CI 化される将来は `process.env.CI ? 4 : 2` 等への調整余地あり。
  workers: 2,
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
  // edit-session e2e (#904) では backend も必要。
  // reuseExistingServer: true なので既存サーバーがあれば再利用され、多重起動しない。
  // backend を手動で別ターミナルで起動している場合は自動 spawn は行われない。
  webServer: [
    {
      command: `npm run dev -- --port ${VITE_PORT}`,
      url: BASE_URL,
      reuseExistingServer: true, // 既存サーバーが起動中ならそれを再利用 (worktree 環境でも安全)
      timeout: 30000,
    },
    {
      command: "cd ../backend && HARMONY_E2E_NO_AUTO_ACTIVATE=1 npm run dev",
      url: "http://localhost:5179",
      reuseExistingServer: true, // 既存 backend があれば再利用 (常駐 backend に接続)
      timeout: 30000,
      // backend 起動失敗は e2e test の skip (MCP 接続チェック) で吸収するため ignoreHTTPSErrors は不要
      // edit-session specs は backend 起動確認を edit-mode-start の表示でチェックし、
      // 未接続の場合は test.skip() で graceful skip される
      // #959: HARMONY_E2E_NO_AUTO_ACTIVATE=1 で autoActivateOnStartup を skip し
      //       recent.lastActiveId の暗黙引き継ぎを断つ (spec が明示的 workspace.open で制御)
      env: { HARMONY_E2E_NO_AUTO_ACTIVATE: "1" },
    },
  ],
});
