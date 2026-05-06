/**
 * 画面一覧 (/screen/list) E2E テスト — #133
 */

import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [
    {
      id: "screen-0001",
      name: "ログイン画面",
      type: "login",
      description: "",
      path: "/login",
      position: { x: 100, y: 100 },
      size: { width: 240, height: 140 },
      hasDesign: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "screen-0002",
      name: "ダッシュボード",
      type: "dashboard",
      description: "",
      path: "/dashboard",
      position: { x: 400, y: 100 },
      size: { width: 240, height: 140 },
      hasDesign: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "screen-0003",
      name: "ユーザー一覧",
      type: "list",
      description: "",
      path: "/users",
      position: { x: 700, y: 100 },
      size: { width: 240, height: 140 },
      hasDesign: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  groups: [],
  edges: [],
  tables: [],
  updatedAt: new Date().toISOString(),
};

async function setupScreenList(page: Page) {
  await page.addInitScript((project) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("list-view-mode:screen-list");
  }, dummyProject);
  await page.goto("/screen/list");
  await expect(page.locator(".screen-list-page")).toBeVisible();
}

test.describe("画面一覧", () => {
  test("カード既定で 3 件、表切替可、検索絞り込み", async ({ page }) => {
    await setupScreenList(page);
    await expect(page.locator(".data-list-card")).toHaveCount(3);
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".data-list-row")).toHaveCount(3);
    await page.getByRole("button", { name: "カード表示" }).click();
    await page.locator(".screen-list-search input").fill("ログイン");
    await expect(page.locator(".data-list-card")).toHaveCount(1);
  });

  test("ダブルクリックで画面デザイナーへ遷移", async ({ page }) => {
    await setupScreenList(page);
    const card = page.locator(".data-list-card").first();
    await card.dblclick();
    await expect(page).toHaveURL(/\/w\/[^/]+\/screen\/design\//);
  });

  test("Delete で ghost 表示、リセットで戻る", async ({ page }) => {
    await setupScreenList(page);
    page.on("dialog", (d) => d.accept());
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    await page.getByTestId("list-reset-btn").click();
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(0);
  });

  test("HeaderMenu に「画面一覧」が出て active", async ({ page }) => {
    await setupScreenList(page);
    await page.locator(".header-menu-btn").click();
    await expect(page.locator(".header-menu-item.active", { hasText: "画面一覧" })).toBeVisible();
  });
});
