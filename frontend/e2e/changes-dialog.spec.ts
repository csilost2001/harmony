/**
 * 保存前の「変更点」: 読み込んだ内容から何が変わったかを一覧で確かめられる。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `changes-dialog-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("変更点ダイアログ", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("変更するまでボタンは出ず、変更すると一覧に出る。保存すると消える @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order-item");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("edit-mode-changes")).toHaveCount(0);

    // 最初のカラムの表示名を書き換える
    const rows = page.locator(".columns-data-list .data-list-row");
    await rows.first().dblclick();
    const detail = page.getByTestId("column-detail");
    const nameInput = detail.locator("input[type=text]").nth(1);
    await nameInput.fill("書き換えた表示名");
    await expect(page.getByTestId("edit-mode-changes")).toBeVisible();

    await page.getByTestId("edit-mode-changes").click();
    const dialog = page.getByTestId("changes-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("changes-summary")).toContainText("変更 1");
    await expect(dialog).toContainText("カラム");
    await expect(dialog).toContainText("表示名");
    await expect(dialog).toContainText("書き換えた表示名");

    // Esc で閉じる (編集内容は残る)
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();

    // 保存すると、変更点はなくなる (ボタンも消える)
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled({ timeout: 10000 });
    await expect(page.getByTestId("edit-mode-changes")).toHaveCount(0);
  });
});
