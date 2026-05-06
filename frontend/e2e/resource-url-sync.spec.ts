/**
 * resource-url-sync.spec.ts (#124)
 *
 * /screen/design/:id の URL to タブ同期の堅牢性テスト。
 * - URL 解決中の空領域が出ないこと (ResourceLoading 表示)
 * - 存在しないリソースはダッシュボードへフォールバックすること
 */

import { test, expect, type Page } from "@playwright/test";

const SCREEN_A = "screen-aaaa-0001";

const projectWithScreen = {
  version: 1,
  name: "E2E",
  screens: [
    {
      id: SCREEN_A,
      name: "画面A",
      type: "form",
      description: "",
      path: "/a",
      position: { x: 0, y: 0 },
      size: { width: 200, height: 100 },
      hasDesign: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  groups: [],
  edges: [],
  updatedAt: new Date().toISOString(),
};

async function setupStorage(page: Page, opts: { tabs: unknown[]; active: string; project?: unknown }) {
  await page.addInitScript((o) => {
    if (o.project) localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(o.project));
    localStorage.setItem("harmony-open-tabs", JSON.stringify(o.tabs));
    localStorage.setItem("harmony-active-tab", o.active);
    // alert は goto をブロックするので握り潰す
    window.alert = () => {};
  }, opts);
}

test("デザイン URL 解決中でもヘッダーは生き残り、タブが確定する", async ({ page }) => {
  await setupStorage(page, {
    project: projectWithScreen,
    tabs: [
      { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
    ],
    active: "dashboard:main",
  });

  await page.goto(`/screen/design/${SCREEN_A}`);
  await expect(page.locator(".common-header")).toBeVisible();
  await expect(page.locator(".tabbar-tab")).not.toHaveCount(0);
});

test("存在しないスクリーン ID の URL はダッシュボードにフォールバックされエラーログに記録される", async ({ page }) => {
  await setupStorage(page, {
    project: projectWithScreen,
    tabs: [
      { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
    ],
    active: "dashboard:main",
  });

  await page.goto("/screen/design/non-existent-screen-id-xxxx");
  await expect(page).toHaveURL(/\/w\/[^/]+\/$/);
  await expect(page.locator(".common-header")).toBeVisible();

  const errorLog = await page.evaluate(() => {
    const raw = localStorage.getItem("designer-error-log");
    return raw ? JSON.parse(raw) : [];
  });
  expect(errorLog.length).toBeGreaterThan(0);
  expect(errorLog.some((e: { message: string }) => /見つかりません/.test(e.message))).toBe(true);
});
