/**
 * ErrorBoundary 防御層 E2E テスト (#123)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   tab JSON の不正シナリオ自体は addInitScript で localStorage 直接書き込みで再現。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const dummyProject = {
  version: 1, name: "error-boundary-test",
  screens: [], groups: [], edges: [], tables: [],
};

const WS_KEY = "issue-926-error-boundary";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("起動時 localStorage バリデーション", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("不正エントリ混在のタブJSONでもヘッダーが見え、有効なタブだけ残る", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "harmony-open-tabs",
        JSON.stringify([
          { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
          { id: "legacy-xxx", type: "legacy-unknown-type", resourceId: "x", label: "古い形式" },
          { garbage: true },
          null,
        ])
      );
      localStorage.setItem("harmony-active-tab", "dashboard:main");
    });
    await ws.gotoActive(page, "/");
    await expect(page.locator(".common-header")).toBeVisible();
    await expect(page.locator(".app-error-fallback")).toHaveCount(0);
    await expect(page.locator(".tabbar-tab")).toHaveCount(1);
    await expect(page.locator(".tabbar-tab")).toContainText("ダッシュボード");
  });

  test("パース不能な JSON でもクラッシュせずアプリは起動する", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("harmony-open-tabs", "{{{ not json");
      localStorage.setItem("harmony-active-tab", "design:xxx");
    });
    await ws.gotoActive(page, "/");
    await expect(page.locator(".common-header")).toBeVisible();
    await expect(page.locator(".app-error-fallback")).toHaveCount(0);
    await expect(page.locator(".tabbar-tab")).toContainText("ダッシュボード");
  });

  test("孤立した /screen/design/:id URL でも AppErrorFallback を出さない", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "harmony-open-tabs",
        JSON.stringify([
          { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
        ])
      );
      localStorage.setItem("harmony-active-tab", "dashboard:main");
    });
    await ws.gotoActive(page, "/screen/design/non-existent-screen-id");
    await expect(page.locator(".common-header")).toBeVisible();
    await expect(page.locator(".app-error-fallback")).toHaveCount(0);
  });
});
