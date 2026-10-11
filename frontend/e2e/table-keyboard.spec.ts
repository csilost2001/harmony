/**
 * テーブルのカラムを、キーボードだけで次々に入力する (Enter = 次の欄、Ctrl+Enter = 次のカラム)。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `table-keyboard-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("テーブルのカラムのキーボード入力", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("Enter で次の欄、Ctrl+Enter で次のカラム、最後は新しいカラムを追加できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order-item");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const rows = page.locator(".columns-data-list .data-list-row");
    const before = await rows.count();

    // 最後の行から Ctrl+Enter 連打で、新しいカラムが追加され、物理名の欄にカーソルが入る
    await rows.last().dblclick();
    const detail = page.getByTestId("column-detail");
    await expect(detail).toBeVisible();
    await page.keyboard.press("Control+Enter");
    await expect(rows).toHaveCount(before + 1, { timeout: 5000 });
    await expect(detail.locator("input[type=text]").first()).toBeFocused();

    // 物理名 → Enter → 表示名 → Enter → データ型 (select) へ
    await page.keyboard.type("memo_text");
    await page.keyboard.press("Enter");
    await page.keyboard.type("メモ");
    await page.keyboard.press("Enter");
    await expect(detail.locator("select").first()).toBeFocused();
    await expect(rows.last()).toContainText("memo_text");
    await expect(rows.last()).toContainText("メモ");

    // Esc で入力欄から出ると、矢印キーが一覧の操作に戻る
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();

    // Ctrl+Shift+Enter は前のカラムへ (入力欄の中で)
    await detail.locator("input[type=text]").first().focus();
    await page.keyboard.press("Control+Shift+Enter");
    await expect(rows.nth(before)).not.toHaveClass(/selected/);
    await expect(rows.nth(before - 1)).toHaveClass(/selected/);
  });

  test("画面項目の表は Enter / ↑↓ で上下の行の同じ列へ移り、最後の行の Enter で行を追加する @regression", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const rows = page.locator(".screen-items-table tbody > tr").filter({ has: page.locator('input[aria-label$="のラベル"]') });
    const before = await rows.count();
    expect(before).toBeGreaterThan(2);

    // 1 行目のラベル欄から Enter で 2 行目のラベル欄へ、Shift+Enter で戻る
    const label = (i: number) => rows.nth(i).locator('input[aria-label$="のラベル"]');
    await label(0).focus();
    await page.keyboard.press("Enter");
    await expect(label(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(label(2)).toBeFocused();
    await page.keyboard.press("Shift+Enter");
    await expect(label(1)).toBeFocused();

    // 最後の行のラベル欄で Enter → 行が増え、新しい行の項目 ID 欄へ
    await label(before - 1).focus();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(before + 1, { timeout: 5000 });
    await expect(rows.nth(before).locator('input[aria-label$="の項目 ID"]')).toBeFocused();
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();
  });
});
