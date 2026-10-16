/**
 * 表の行の並べ替え (UI 改善提案 第 3 弾 #48): 行頭のつまみのドラッグ・Alt+↑↓。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `row-reorder-${Date.now()}`;
let ws: OpenedWorkspace;

async function startEditing(page: Page) {
  const start = page.getByTestId("edit-mode-start");
  await expect(start).toBeVisible({ timeout: 15000 });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

test.describe("表の行の並べ替え", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("画面項目の表: Alt+↓ で 1 つ下へ。つまみのドラッグで別の行の後ろへ。Ctrl+Z で戻る", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    const rows = page.locator(".screen-items-table tbody tr[data-grid-row]");
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    const idOf = (i: number) => rows.nth(i).locator('input[placeholder="例: email"]');
    const ids = async () => (await rows.locator('input[placeholder="例: email"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).slice(0, 4);
    const before = await ids();

    // キー: Alt+↓ で、いまの行が 1 つ下へ。フォーカスも行について行く
    await idOf(0).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(ids).toEqual([before[1], before[0], before[2], before[3]]);
    await expect(idOf(1)).toBeFocused();

    // ドラッグ: 先頭の行のつまみを、3 行目の下半分へ
    const target = rows.nth(2);
    const box = (await target.boundingBox())!;
    await rows.nth(0).getByTestId("row-grip-0").dragTo(target, { targetPosition: { x: 40, y: box.height - 3 } });
    await expect.poll(ids).toEqual([before[0], before[2], before[1], before[3]]);

    // 取り消し (1 回の Ctrl+Z で、ドラッグの前に戻る)
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(ids).toEqual([before[1], before[0], before[2], before[3]]);
  });

  test("テーブルのカラム (表で編集): Alt+↑↓ とつまみのドラッグで並べ替えられる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart-item");
    await startEditing(page);
    await page.getByTestId("columns-grid-toggle").click();
    const grid = page.getByTestId("column-grid");
    await expect(grid).toBeVisible({ timeout: 10000 });
    const rows = page.getByTestId("column-grid-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    const names = async () => (await rows.locator('input[aria-label$="行目の物理名"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).slice(0, 4);
    const before = await names();
    await rows.nth(0).locator('input[aria-label$="の表示名"]').focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(names).toEqual([before[1], before[0], before[2], before[3]]);
    const box = (await rows.nth(3).boundingBox())!;
    await rows.nth(0).getByTestId("row-grip-0").dragTo(rows.nth(3), { targetPosition: { x: 40, y: box.height - 3 } });
    await expect.poll(names).toEqual([before[0], before[2], before[3], before[1]]);
  });
});
