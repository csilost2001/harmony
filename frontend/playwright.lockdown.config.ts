import { defineConfig, devices } from "@playwright/test";
import { lockdownWorkspacePath } from "./e2e/helpers/workspaceFixture.ts";

const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5183", 10);
const MCP_PORT = parseInt(process.env.DESIGNER_MCP_PORT ?? "5189", 10);
const BASE_URL = `http://localhost:${VITE_PORT}`;
// #1359: workspaceFixture.ts:lockdownWorkspacePath() を経由することで、本 config と
// lockdown-routing.spec.ts の path 構築を 1 つの helper に集約する。webServer.env は
// controller process 起動時に評価される (worker spawn 前) ため、worker index は常に
// "0" で解決される (本 config は workers: 1 固定、line 15 参照)。
const LOCKDOWN_WORKSPACE = lockdownWorkspacePath();

export default defineConfig({
  testDir: "./e2e",
  testMatch: /lockdown-routing\.spec\.ts$/,
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
  webServer: [
    {
      command: `VITE_DESIGNER_MCP_PORT=${MCP_PORT} npm run dev -- --port ${VITE_PORT}`,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 30000,
      env: { VITE_DESIGNER_MCP_PORT: String(MCP_PORT) },
    },
    {
      command: `cd ../backend && DESIGNER_MCP_PORT=${MCP_PORT} DESIGNER_DATA_DIR="${LOCKDOWN_WORKSPACE}" npm run dev`,
      url: `http://localhost:${MCP_PORT}`,
      reuseExistingServer: true,
      timeout: 30000,
      env: {
        DESIGNER_MCP_PORT: String(MCP_PORT),
        DESIGNER_DATA_DIR: LOCKDOWN_WORKSPACE,
      },
    },
  ],
});
