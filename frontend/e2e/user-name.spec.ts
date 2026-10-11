/**
 * 利用者名: ヘッダーで設定でき、編集セッションの表示名として他の人から見える。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `user-name-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("利用者名", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("名前を設定すると、編集中の表示名になり、再読み込みしても残る @regression", async ({ page, browser }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.getByTestId("user-name-button")).toContainText("ゲスト");
    await page.getByTestId("user-name-button").click();
    await page.getByTestId("user-name-input").fill("山田 太郎");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("user-name-pop")).toHaveCount(0);
    await expect(page.getByTestId("user-name-button")).toContainText("山田 太郎");

    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.getByTestId("user-name-button")).toContainText("山田 太郎");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    // 自分には「あなた」と出る。別のブラウザ (別の人) からは、設定した名前で見える
    const other = await browser.newContext();
    try {
      const page2 = await other.newPage();
      await ws.gotoActive(page2, "/process-flow/edit/order-confirm");
      await page2.getByTestId("esd-toggle-btn").click();
      await expect(page2.getByTestId("esd-dropdown")).toContainText("山田 太郎 が編集中", { timeout: 15000 });
    } finally {
      await other.close();
    }
  });
});
