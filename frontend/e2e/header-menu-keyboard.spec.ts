/**
 * ヘッダーのメニュー: 区分ごとに並び、キーボード (↑↓ / Home / End / Enter / Esc) だけで開いて選べる。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `header-menu-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("ヘッダーメニュー", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  test("区分の見出しが並び、↑↓ と Enter で画面を開ける @regression", async ({ page }) => {
    await ws.gotoActive(page, "/screen/list");
    await page.locator(".header-menu-btn").click();
    const labels = page.locator(".header-menu-section-label");
    await expect(labels).toHaveText(["画面", "処理", "データ", "規約・定義", "出力", "設定"]);
    // 開いたとき、いまの画面 (画面一覧) の項目にカーソルがある
    await expect(page.locator(".header-menu-item.active")).toBeFocused();
    await expect(page.locator(".header-menu-item.active")).toContainText("画面一覧");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".header-menu-item:focus")).toContainText("ページレイアウト一覧");
    await page.keyboard.press("End");
    await expect(page.locator(".header-menu-item:focus")).toContainText("AI 設定");
    await page.keyboard.press("Home");
    await expect(page.locator(".header-menu-item:focus")).toContainText("ダッシュボード");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter"); // ダッシュボードの 2 つ下 = 画面一覧
    await expect(page).toHaveURL(/\/w\/[^/]+\/screen\/list$/);
    await expect(page.locator(".header-menu-dropdown")).toHaveCount(0);
  });

  test("Esc で閉じて、メニューのボタンへ戻る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/screen/list");
    await page.locator(".header-menu-btn").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".header-menu-dropdown")).toHaveCount(0);
    await expect(page.locator(".header-menu-btn")).toBeFocused();
  });
});
