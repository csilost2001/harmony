/**
 * resource-url-sync.spec.ts (#124)
 *
 * /screen/design/:id の URL to タブ同期の堅牢性テスト。
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const SCREEN_A = "screen-aaaa-0001";

const projectWithScreen = {
  version: 1,
  name: "E2E",
  screens: [
    { id: SCREEN_A, no: 1, name: "画面A", kind: "form", path: "/a", hasDesign: true },
  ],
  groups: [], edges: [],
};

const WS_KEY = "issue-926-resource-url-sync";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("resource-url-sync", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({ key: WS_KEY, project: projectWithScreen });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    // alert は goto をブロックするので握り潰す
    await page.addInitScript(() => {
      window.alert = () => {};
      localStorage.setItem("harmony-open-tabs", JSON.stringify([
        { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
      ]));
      localStorage.setItem("harmony-active-tab", "dashboard:main");
    });
  });

  test("デザイン URL 解決中でもヘッダーは生き残り、タブが確定する", async ({ page }) => {
    await ws.gotoActive(page, `/screen/design/${normalizeId(SCREEN_A)}`);
    await expect(page.locator(".common-header")).toBeVisible();
    await expect(page.locator(".tabbar-tab")).not.toHaveCount(0);
  });

  test("存在しないスクリーン ID の URL はダッシュボードにフォールバックされエラーログに記録される", async ({ page }) => {
    await ws.gotoActive(page, "/screen/design/non-existent-screen-id-xxxx");
    await expect(page).toHaveURL(/\/w\/[^/]+\/?$/);
    await expect(page.locator(".common-header")).toBeVisible();

    const errorLog = await page.evaluate(() => {
      const raw = localStorage.getItem("designer-error-log");
      return raw ? JSON.parse(raw) : [];
    });
    expect(errorLog.length).toBeGreaterThan(0);
    expect(errorLog.some((e: { message: string }) => /見つかりません/.test(e.message))).toBe(true);
  });
});
