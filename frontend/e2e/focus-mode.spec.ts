/**
 * 入力専用モード (UI 改善提案 第 5 弾 #98): Ctrl+Alt+F でヘッダーとタブを畳み、戻せる。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `focus-mode-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("入力専用モード", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("Ctrl+Alt+F でヘッダー・タブが消え、本文が広がる。右上のボタンと同じキーで戻せる。コマンドパレットからも", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    const header = page.locator(".common-header");
    const tabbar = page.locator(".tabbar");
    await expect(header).toBeVisible({ timeout: 15000 });
    const before = (await page.locator("#app-main").boundingBox())!;

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+Alt+f");
    await expect(header).toBeHidden();
    await expect(tabbar).toBeHidden();
    const exit = page.getByTestId("focus-mode-exit");
    await expect(exit).toBeVisible();
    expect((await page.locator("#app-main").boundingBox())!.y).toBeLessThan(before.y);

    await exit.click();
    await expect(header).toBeVisible();
    await expect(exit).toHaveCount(0);

    // コマンドパレットから
    await page.keyboard.press("Control+k");
    await page.keyboard.type(">入力専用");
    await page.keyboard.press("Enter");
    await expect(header).toBeHidden();
    await page.keyboard.press("Control+Alt+f");
    await expect(header).toBeVisible();
  });
});
