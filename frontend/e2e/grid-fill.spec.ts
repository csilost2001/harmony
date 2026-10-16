/**
 * 表のオートフィル (UI 改善提案 第 3 弾 #53): セルの右下の四角を、上下へドラッグして値を埋める。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `grid-fill-${Date.now()}`;
let ws: OpenedWorkspace;

async function startEditing(page: Page) {
  const start = page.getByTestId("edit-mode-start");
  await expect(start).toBeVisible({ timeout: 15000 });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

test.describe("表のオートフィル", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("四角を下へドラッグすると、同じ値で埋まる。Ctrl を押しながらだと、末尾の数字が 1 つずつ進む", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    const rows = page.locator(".screen-items-table tbody tr[data-grid-row]");
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    const label = (i: number) => rows.nth(i).locator('input[placeholder="例: メールアドレス"]');

    await label(0).fill("項目1");
    await label(0).focus();
    const handle = page.getByTestId("grid-fill-handle");
    await expect(handle).toBeVisible();
    const drag = async (toRow: number, ctrl: boolean) => {
      const h = (await handle.boundingBox())!;
      const t = (await label(toRow).boundingBox())!;
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      if (ctrl) await page.keyboard.down("Control");
      await page.mouse.down();
      await page.mouse.move(t.x + 20, t.y + t.height / 2, { steps: 8 });
      await page.mouse.up();
      if (ctrl) await page.keyboard.up("Control");
    };

    // 同じ値で埋める (0 → 2 行目まで)
    await drag(2, false);
    await expect(label(1)).toHaveValue("項目1");
    await expect(label(2)).toHaveValue("項目1");

    // Ctrl: 連番で埋める (0 行目を元に、1〜3 行目)
    await label(0).focus();
    await expect(handle).toBeVisible();
    await drag(3, true);
    await expect(label(1)).toHaveValue("項目2");
    await expect(label(2)).toHaveValue("項目3");
    await expect(label(3)).toHaveValue("項目4");
  });
});
