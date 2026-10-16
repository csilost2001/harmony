/**
 * 保存の状態の見える化 (UI 改善提案 第 5 弾 #83): 原本に未反映の変更と、下書きの保存時刻を、保存ボタンのそばに出す。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `save-status-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("保存の状態", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("変更すると「原本に未反映 / 下書きは hh:mm にサーバへ保存済み」、保存すると「原本と同じ」になる", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    const start = page.getByTestId("edit-mode-start");
    await expect(start).toBeVisible({ timeout: 15000 });
    await start.click();
    const status = page.getByTestId("edit-mode-save-status");
    await expect(status).toContainText("原本と同じ");
    const label = page.locator(".screen-items-table tbody tr[data-grid-row]").first().locator('input[placeholder="例: メールアドレス"]');
    await label.fill("状態の検査");
    await expect(status).toContainText("原本に未反映");
    await expect(status).toContainText(/下書きは \d{2}:\d{2} にサーバへ保存済み/, { timeout: 10000 });
    await page.getByTestId("edit-mode-save").click();
    await expect(status).toContainText(/原本と同じ \(\d{2}:\d{2} に保存\)/, { timeout: 10000 });
  });
});
