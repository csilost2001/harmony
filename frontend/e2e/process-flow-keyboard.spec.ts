/**
 * 処理フローの工程を、キーボードだけで辿る・挿入する・インデントする (docs/spec/process-flow-keyboard.md)。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `pf-keyboard-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("処理フローのキーボード操作", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("↑↓ で工程を辿り、Insert で種類を打ち込んで挿入し、そのまま入力できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const headers = page.locator(".step-card-header");
    await expect(headers.first()).toBeVisible();
    const before = await page.locator(".step-card").count();

    // 1 番目の工程の見出しへ → ↓ で 2 番目へ
    await headers.first().focus();
    await expect(headers.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(headers.nth(1)).toBeFocused();
    await expect(page.locator(".step-card.selected")).toHaveCount(1);

    // Insert → 「DB」と打って Enter: 2 番目の後ろに DB アクセスが入り、説明欄にカーソルが移る
    await page.keyboard.press("Insert");
    await expect(page.getByTestId("step-insert-menu")).toBeVisible();
    await page.getByTestId("step-insert-input").fill("DB");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("step-insert-menu")).toHaveCount(0);
    await expect(page.locator(".step-card")).toHaveCount(before + 1);
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["TEXTAREA", "INPUT"]).toContain(focusedTag);
    await page.keyboard.type("在庫を確認する");
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();

    // Esc で入力欄から工程の見出しへ戻る
    await page.keyboard.press("Escape");
    const focusedIsHeader = await page.evaluate(() => document.activeElement?.classList.contains("step-card-header"));
    expect(focusedIsHeader).toBe(true);
  });

  test("Tab でインデント、Shift+Tab でアウトデントできる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const topBefore = await page.locator(".step-card-wrapper:not(.sub-steps .step-card-wrapper)").count();
    const second = page.locator(".step-card-wrapper:not(.sub-steps .step-card-wrapper) > .step-card > .step-card-header").nth(1);
    await second.focus();
    const id = await second.evaluate((el) => el.closest(".step-card")?.getAttribute("data-step-id"));
    await page.keyboard.press("Tab");
    // 直前の工程の中へ入る: 親の工程の .sub-steps の中に入れ子になる
    await expect(page.locator(`.sub-steps .step-card[data-step-id="${id}"]`)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(`.step-card[data-step-id="${id}"] > .step-card-header`)).toBeFocused({ timeout: 5000 });
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(`.sub-steps .step-card[data-step-id="${id}"]`)).toHaveCount(0, { timeout: 5000 });
    expect(topBefore).toBeGreaterThan(0);
  });
});
