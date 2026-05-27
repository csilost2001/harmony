import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { lockdownWorkspacePath } from "./e2e/helpers/workspaceFixture.ts";

const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5183", 10);
const MCP_PORT = parseInt(process.env.DESIGNER_MCP_PORT ?? "5189", 10);
const BASE_URL = `http://localhost:${VITE_PORT}`;
// #1359: workspaceFixture.ts:lockdownWorkspacePath() を経由することで、本 config と
// lockdown-routing.spec.ts の path 構築を 1 つの helper に集約する。
// 本 helper は **worker index 非依存の stable path** を返す (Round 1 Must-fix M-1):
// webServer.env は controller process (= worker spawn 前) で評価され `TEST_WORKER_INDEX`
// 未設定だが、CI retry 後の spec worker は `TEST_WORKER_INDEX=1+` で起動し得るため、
// worker prefix 経由にすると config と spec の path が retry 時のみ mismatch する。
// 本 config の `workers: 1` 設定 (下の defineConfig 参照) で並行 write は発生しないため
// worker prefix は不要 = stable path で一致を担保する。
const LOCKDOWN_WORKSPACE = lockdownWorkspacePath();

// #1342 Proposal A: webServer 起動前に LOCKDOWN_WORKSPACE を seed する。
// backend は `DESIGNER_DATA_DIR` 配下に `harmony.json` が無いと `process.exit(1)` する
// (workspaceState.ts S-011) ため、spec の beforeAll では間に合わない (webServer 起動
// timeout になる)。Playwright globalSetup も webServer 開始より後に実行されるため、
// config module 読み込み時 (= webServer spawn より前) に同期 fs API で seed する。
// `--config playwright.lockdown.config.ts` 経由でしか import されないため副作用 OK。
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "..");
fs.rmSync(LOCKDOWN_WORKSPACE, { recursive: true, force: true });
fs.mkdirSync(path.dirname(LOCKDOWN_WORKSPACE), { recursive: true });
fs.cpSync(path.join(REPO_ROOT, "examples", "retail"), LOCKDOWN_WORKSPACE, { recursive: true });

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
