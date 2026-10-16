/**
 * 参照の付け替え (UI 改善提案 第 3 弾 #60): 参照元のダイアログから、選んだ参照元の参照を、別の対象へ付け替える。元に戻せる。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `replace-references-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("参照の付け替え", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("選んだ参照元だけを、別のテーブルへ付け替えられ、元に戻せる (付け替え元のテーブルは残る)", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/customer-master");
    await page.getByTestId("references-open-btn").click();
    const dialog = page.getByTestId("references-dialog");
    const count = async () => Number((((await dialog.getByTestId("references-summary").textContent()) ?? "").match(/(\d+) か所/) ?? [])[1]);
    await expect(dialog.getByTestId("references-summary")).toBeVisible({ timeout: 15000 });
    const before = await count();
    expect(before).toBeGreaterThan(0);

    await dialog.getByTestId("replace-open").click();
    const panel = dialog.getByTestId("replace-panel");
    await expect(panel.getByTestId("replace-to")).toBeVisible();
    // 付け替え先を選ぶまで、実行できない
    await expect(panel.getByTestId("replace-run")).toBeDisabled();
    await panel.getByTestId("replace-to").selectOption("product-master");
    const files = panel.locator('[data-testid^="replace-file-"]');
    expect(await files.count()).toBeGreaterThan(0);
    // 先頭の参照元だけを選ぶ
    for (let i = 1; i < (await files.count()); i++) await panel.locator(".references-replace-files li label").nth(i).click(); // 行の文字をクリック (チェックが切り替わる)
    await expect(panel.getByTestId("replace-run")).toBeEnabled();
    await panel.getByTestId("replace-run").click();
    await expect(panel.getByTestId("replace-done")).toBeVisible({ timeout: 15000 });
    // 参照されている数が減った (選んだ参照元の分)
    await expect.poll(count).toBeLessThan(before);

    // 元に戻す
    await panel.getByTestId("replace-undo").click();
    await expect.poll(count).toBe(before);
    await expect(panel.getByTestId("replace-done")).toHaveCount(0);
  });
});
