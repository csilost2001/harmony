import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockdownWorkspacePath } from "./helpers/workspaceFixture.ts";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, "../..");
// #1359 Round 1 M-1: workspaceFixture.ts:lockdownWorkspacePath() は **worker index 非依存
// の stable path** を返す。lockdown config (playwright.lockdown.config.ts) と本 spec の
// path 構築を単一 source of truth に集約しつつ、controller process (`TEST_WORKER_INDEX`
// 未設定) と CI retry 後の spec worker (`TEST_WORKER_INDEX=1+`) の path mismatch を排除する。
const LOCKDOWN_WORKSPACE = lockdownWorkspacePath();

test.describe("lockdown routing", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    await fs.rm(LOCKDOWN_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(path.dirname(LOCKDOWN_WORKSPACE), { recursive: true });
    await fs.cp(path.join(REPO_ROOT, "examples", "retail"), LOCKDOWN_WORKSPACE, { recursive: true });
  });

  test.afterAll(async () => {
    await fs.rm(LOCKDOWN_WORKSPACE, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.alert = () => {};
      window.confirm = () => false;
    });
  });

  test("recent エントリなしの lockdown でも旧 URL / から dashboard へ遷移できる", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/w\/lockdown\/$/);
    await expect(page.locator(".dashboard-view")).toBeVisible();
    await expect(page.getByTestId("workspace-indicator-name")).not.toContainText("ワークスペース未選択");
    await expect(page.locator("text=ワークスペース情報を読み込み中")).toHaveCount(0);
    await expect(page.locator("text=ページを読み込み中")).toHaveCount(0);
  });

  test("lockdown の workspace.list は URL 用 active.id を返す", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/w\/lockdown\/$/);

    const state = await page.evaluate(async () => {
      const bridge = window.__mcpBridge;
      if (!bridge) throw new Error("mcpBridge not initialized");
      return bridge.request("workspace.list") as Promise<{
        active: { id: string | null; path: string; name: string | null } | null;
        workspaces: unknown[];
        lockdown: boolean;
      }>;
    });

    expect(state.lockdown).toBe(true);
    expect(state.workspaces).toHaveLength(0);
    expect(state.active?.id).toBe("lockdown");
  });
});
