/**
 * クイックオープン (Ctrl+K) の E2E。
 *
 * - Ctrl+K で開き、ID・名前・物理名で画面・テーブル・処理フロー・業務フロー・帳票を探せる
 * - 空白区切りで絞り込め、↑↓ Enter で開ける。Esc で閉じる
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `quick-open-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("クイックオープン", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("Ctrl+K で開き、名前や ID で探して Enter で開ける / Esc で閉じる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("quick-open")).toBeVisible();
    await expect(page.getByTestId("quick-open-input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-open")).toHaveCount(0);

    await page.getByTestId("quick-open-trigger").click();
    await page.getByTestId("quick-open-input").fill("納品書");
    await expect(page.locator('[data-testid="quick-open-item"][data-key="report:delivery-note"]')).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("report-editor")).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/report\/edit\/delivery-note/);
    await expect(page.getByTestId("quick-open")).toHaveCount(0);

    // 開いたものは、次に空のまま開いたとき先頭に出る (Ctrl+K → Enter で直前の場所に戻れる)
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("quick-open-item").first()).toHaveAttribute("data-key", "report:delivery-note");
    await page.keyboard.press("Escape");
  });

  test("種類をまたいで探せ、空白区切りで絞り込める (業務フロー・処理フロー・テーブル) @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("quick-open-input");
    const item = (key: string) => page.locator(`[data-testid="quick-open-item"][data-key="${key}"]`);

    await input.fill("order-to-shipment");
    await expect(item("business-flow:order-to-shipment")).toBeVisible();

    await input.fill("注文 テーブル");
    await expect(item("table:order")).toBeVisible();
    await expect(page.locator('[data-testid="quick-open-item"]:not([data-key^="table:"])')).toHaveCount(0);

    await input.fill("order-confirm");
    await expect(item("process-flow:order-confirm")).toBeVisible();
    await item("process-flow:order-confirm").click();
    await expect(page).toHaveURL(/\/process-flow\/edit\/order-confirm/);

    await page.keyboard.press("Control+k");
    await page.getByTestId("quick-open-input").fill("zzzzqqq");
    await expect(page.getByTestId("quick-open-empty")).toBeVisible();
  });

  test("↑↓ で選んで開ける。ページ (設計書) にも飛べる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("quick-open-input");
    await input.fill("一覧");
    const items = page.getByTestId("quick-open-item");
    await expect(items.nth(1)).toBeVisible();
    await expect(items.nth(0)).toHaveClass(/active/);
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toHaveClass(/active/);
    await expect(items.nth(0)).not.toHaveClass(/active/);
    await page.keyboard.press("ArrowUp");
    await expect(items.nth(0)).toHaveClass(/active/);

    await input.fill("設計書");
    await expect(items.first()).toHaveAttribute("data-key", "page:design-document");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/document/);
  });
});
