/**
 * backend backend (WebSocket bridge) 起動下で、実ワークスペースを使った
 * 主要画面遷移の smoke test。#818
 */
import { test, expect, type Page } from "@playwright/test";
import { isMcpRunning, sendBrowserRequest } from "./mcp/_helpers";
import {
  cleanupRealWorkspaces,
  copyExampleWorkspace,
  type RealWorkspaceFixture,
} from "./helpers/realWorkspace";

let mcpAvailable = false;
let english: RealWorkspaceFixture;
let retail: RealWorkspaceFixture;

async function openAddWorkspaceDialog(page: Page): Promise<void> {
  await page.locator("button").filter({ has: page.locator(".bi-plus-lg") }).first().click();
  await expect(page.locator(".tbl-modal")).toBeVisible();
}

async function addWorkspaceFromSelect(page: Page, workspacePath: string): Promise<void> {
  await page.goto("/workspace/select");
  await openAddWorkspaceDialog(page);
  await page.locator(".tbl-modal input[type='text']").fill(workspacePath);
  // 400ms debounce + inspectWorkspace RPC を待つ → status: ready → primary 「開く」 が出る
  const primaryBtn = page.locator(".tbl-modal .tbl-btn-primary");
  await expect(primaryBtn).toBeVisible({ timeout: 10000 });
  await expect(primaryBtn).toBeEnabled();
  await primaryBtn.click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/$/);
  await expect(page.locator(".dashboard-view")).toBeVisible();
}

async function registerWorkspace(path: string): Promise<void> {
  await sendBrowserRequest("workspace.open", { path });
}

async function goToWorkspaceList(page: Page): Promise<void> {
  await page.goto("/workspace/list");
  await expect(page).toHaveURL("/workspace/list");
  await expect(page.getByTestId("data-list")).toBeVisible();
}

async function currentWorkspaceRoot(page: Page): Promise<string> {
  const pathname = await page.evaluate(() => location.pathname);
  const match = pathname.match(/^\/w\/[^/]+/);
  if (!match) throw new Error(`workspace URL expected, got ${pathname}`);
  return match[0];
}

async function openWorkspaceFromListByButton(page: Page, workspacePath: string): Promise<void> {
  const card = page.locator("[data-row-id]", { hasText: workspacePath }).first();
  await expect(card).toBeVisible();
  await card.click();
  await page.locator(".table-list-actions .tbl-btn").filter({ has: page.locator(".bi-folder2-open") }).last().click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/$/);
  await expect(page.locator(".dashboard-view")).toBeVisible();
}

async function openWorkspaceFromListByDoubleClick(page: Page, workspacePath: string): Promise<void> {
  const card = page.locator("[data-row-id]", { hasText: workspacePath }).first();
  await expect(card).toBeVisible();
  await card.dblclick();
  await expect(page).toHaveURL(/\/w\/[^/]+\/$/);
  await expect(page.locator(".dashboard-view")).toBeVisible();
}

async function openWorkspaceFromListByEnter(page: Page, workspacePath: string): Promise<void> {
  const card = page.locator("[data-row-id]", { hasText: workspacePath }).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(card).toHaveClass(/selected/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/w\/[^/]+\/$/);
  await expect(page.locator(".dashboard-view")).toBeVisible();
}

async function navigateFromHeader(page: Page, label: string, expectedUrl: RegExp, contentSelector: string): Promise<void> {
  await page.locator(".header-menu-btn").click();
  await page.locator(".header-menu-item").filter({ hasText: label }).click();
  await expect(page).toHaveURL(expectedUrl);
  await expect(page.locator(contentSelector)).toBeVisible();
}

async function openFirstResource(page: Page, listPath: string, editorUrl: RegExp, editorSelector: string): Promise<void> {
  await page.goto(listPath);
  await expect(page.getByTestId("data-list")).toBeVisible();
  const item = page.locator("[data-row-id]").first();
  await expect(item).toBeVisible();
  await item.dblclick();
  await expect(page).toHaveURL(editorUrl);
  await expect(page.locator(editorSelector).first()).toBeVisible();
  await expect(page.locator(".tabbar-tab.active")).toBeVisible();
}

test.describe("workspace navigation smoke with backend backend", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    english = await copyExampleWorkspace("english-learning", "issue-818-english-learning");
    retail = await copyExampleWorkspace("retail", "issue-818-retail");
    await registerWorkspace(english.workspacePath);
    await registerWorkspace(retail.workspacePath);
  });

  test.afterAll(async () => {
    if (!mcpAvailable) return;
    await cleanupRealWorkspaces(["issue-818-english-learning", "issue-818-retail"]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend backend (port 5179) is not running");
  });

  test("workspace/select から実ワークスペースを追加してダッシュボードへ遷移できる", async ({ page }) => {
    await addWorkspaceFromSelect(page, english.workspacePath);
  });

  test("workspace/list から開くボタン・ダブルクリック・Enter で切り替えできる", async ({ page }) => {
    await goToWorkspaceList(page);
    await openWorkspaceFromListByButton(page, english.workspacePath);

    await goToWorkspaceList(page);
    await openWorkspaceFromListByDoubleClick(page, retail.workspacePath);

    await goToWorkspaceList(page);
    await openWorkspaceFromListByEnter(page, english.workspacePath);
  });

  test("HeaderMenu の主要項目から各 singleton 画面へ遷移できる", async ({ page }) => {
    await addWorkspaceFromSelect(page, english.workspacePath);
    const wsPrefix = /\/w\/[^/]+/;

    await navigateFromHeader(page, "画面フロー", new RegExp(`${wsPrefix.source}/screen/flow$`), ".flow-root");
    await navigateFromHeader(page, "画面一覧", new RegExp(`${wsPrefix.source}/screen/list$`), ".screen-list-page");
    await navigateFromHeader(page, "テーブル一覧", new RegExp(`${wsPrefix.source}/table/list$`), ".table-list-page");
    await navigateFromHeader(page, "ER図", new RegExp(`${wsPrefix.source}/table/er$`), ".er-diagram, .er-diagram-page, .er-page");
    await navigateFromHeader(page, "処理フロー一覧", new RegExp(`${wsPrefix.source}/process-flow/list$`), ".process-flow-page");
    await navigateFromHeader(page, "拡張管理", new RegExp(`${wsPrefix.source}/extensions$`), ".extensions-panel, .extensions-page");
    await navigateFromHeader(page, "ダッシュボード", new RegExp(`${wsPrefix.source}/$`), ".dashboard-view");
  });

  test("一覧から画面・テーブル・処理フローの個別エディタを開ける", async ({ page }) => {
    await addWorkspaceFromSelect(page, english.workspacePath);
    const wsRoot = await currentWorkspaceRoot(page);
    const wsPrefix = "/w/[^/]+";

    await openFirstResource(
      page,
      `${wsRoot}/screen/list`,
      new RegExp(`${wsPrefix}/screen/design/[^/]+$`),
      ".designer-root, [data-testid='puck-editor-container']",
    );

    await openFirstResource(
      page,
      `${wsRoot}/table/list`,
      new RegExp(`${wsPrefix}/table/edit/[^/]+$`),
      ".table-editor-page",
    );

    await openFirstResource(
      page,
      `${wsRoot}/process-flow/list`,
      new RegExp(`${wsPrefix}/process-flow/edit/[^/]+$`),
      ".process-flow-page",
    );
  });
});
