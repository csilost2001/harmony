/**
 * 規約カタログ編集ビュー (#317) の基本 E2E
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const dummyProject = {
  version: 1, name: "conventions-ui",
  screens: [], groups: [], edges: [], tables: [], processFlows: [],
};

const WS_KEY = "issue-926-conventions-catalog";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("規約カタログ編集ビュー (#317)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
    await ws.gotoActive(page, "/conventions/catalog");
    await expect(page.locator(".conventions-catalog-view")).toBeVisible({ timeout: 10000 });
  });

  test("13 カテゴリタブが 3 グループで見える (#555)", async ({ page }) => {
    const tabs = page.locator(".conventions-category-tab");
    await expect(tabs).toHaveCount(13);
    await expect(tabs.nth(0)).toContainText("メッセージ");
    await expect(tabs.nth(1)).toContainText("正規表現");
    await expect(tabs.nth(2)).toContainText("制限値");
    await expect(tabs.nth(3)).toContainText("役割");
    await expect(tabs.nth(4)).toContainText("権限");
    const groupLabels = page.locator(".conventions-tab-group-label");
    await expect(groupLabels.nth(0)).toContainText("入力バリデーション");
    await expect(groupLabels.nth(1)).toContainText("役割・権限");
    await expect(groupLabels.nth(2)).toContainText("プロダクト規約");
  });

  test("regex タブで新規エントリ追加 + pattern 入力", async ({ page }) => {
    await page.locator(".conventions-category-tab", { hasText: "正規表現" }).click();
    const newKeyInput = page.locator(".conventions-new-key-input");
    await newKeyInput.fill("test-regex-pattern");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "test-regex-pattern" })).toBeVisible();
    const patternInput = page.locator('.conventions-table input[placeholder="^[A-Za-z0-9]+$"]').first();
    await patternInput.fill("^\\d{4}$");
    await expect(patternInput).toHaveValue("^\\d{4}$");
  });

  test("msg タブで新規エントリ追加 + template 入力", async ({ page }) => {
    const newKeyInput = page.locator(".conventions-new-key-input");
    await newKeyInput.fill("testMsg");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "testMsg" })).toBeVisible();
    const templateInput = page.locator('.conventions-table input[placeholder*="必須入力"]').first();
    await templateInput.fill("{label}はテストです");
    await expect(templateInput).toHaveValue("{label}はテストです");
  });

  test("重複キーの追加はボタン disabled", async ({ page }) => {
    await page.locator(".conventions-category-tab", { hasText: "制限値" }).click();
    const newKeyInput = page.locator(".conventions-new-key-input");
    await newKeyInput.fill("dupKey");
    const addBtn = page.locator(".conventions-entries button:has-text('追加')");
    await addBtn.click();
    await newKeyInput.fill("dupKey");
    await expect(addBtn).toBeDisabled();
  });

  test("削除ボタンでエントリが消える", async ({ page }) => {
    await page.locator(".conventions-category-tab", { hasText: "正規表現" }).click();
    await page.locator(".conventions-new-key-input").fill("willDelete");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toBeVisible();
    const row = page.locator(".conventions-table tr").filter({ has: page.locator(".conventions-key-badge", { hasText: "willDelete" }) });
    await row.locator('button[aria-label="削除"]').click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toHaveCount(0);
  });
});
