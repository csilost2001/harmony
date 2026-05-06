/**
 * 処理フロー一覧 (/process-flow/list) E2E テスト — #133
 */

import { test, expect, type Page } from "@playwright/test";

const dummyGroups = [
  {
    id: "ag-0001",
    name: "ログイン処理",
    type: "screen",
    actionCount: 3,
    screenId: "screen-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ag-0002",
    name: "月次集計バッチ",
    type: "batch",
    actionCount: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ag-0003",
    name: "共通バリデーション",
    type: "common",
    actionCount: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: dummyGroups,
  updatedAt: new Date().toISOString(),
};

async function setupActionList(page: Page) {
  await page.addInitScript(({ project, groups }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    for (const g of groups) {
      localStorage.setItem(`process-flow-${g.id}`, JSON.stringify({ ...g, actions: [] }));
    }
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("list-view-mode:process-flow-list");
  }, { project: dummyProject, groups: dummyGroups });
  await page.goto("/process-flow/list");
  await expect(page.locator(".process-flow-page")).toBeVisible();
}

test.describe("処理フロー一覧", () => {
  test("カード既定、表切替・種別フィルタ・ダブルクリック遷移", async ({ page }) => {
    await setupActionList(page);
    await expect(page.locator(".data-list-layout-grid")).toHaveCount(1);
    await expect(page.locator(".data-list-card")).toHaveCount(3);
    // 表切替
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".data-list-row")).toHaveCount(3);
    // カードに戻して種別フィルタ
    await page.getByRole("button", { name: "カード表示" }).click();
    await page.getByRole("button", { name: /^バッチ \(/ }).click();
    await expect(page.locator(".data-list-card")).toHaveCount(1);
    await expect(page.locator(".filter-bar")).toBeVisible();
    // ダブルクリックで遷移
    await page.locator(".data-list-card").first().dblclick();
    await expect(page).toHaveURL(/\/w\/[^/]+\/process-flow\/edit\//);
  });

  test("削除マークで ghost 表示、保存で確定", async ({ page }) => {
    await setupActionList(page);
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    await page.getByTestId("list-save-btn").click();
    await expect(page.locator(".data-list-card")).toHaveCount(2);
  });

  test("Ctrl+D で複製", async ({ page }) => {
    await setupActionList(page);
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Control+d");
    // 複製は即時永続化 → reload 後に 4 件
    await expect(page.locator(".data-list-card")).toHaveCount(4);
  });
});
