/**
 * 汎用定義の編集: 他の画面と同じ「閲覧中 → 編集開始 → 編集中」。開いただけでは触れず、保存・破棄ができる。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `gd-edit-${Date.now()}`;
const PATH = "/generic-definition/data-contract/OrderForm";
let ws: OpenedWorkspace;

test.describe("汎用定義の編集", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("開いただけでは触れず、編集開始 → 変更 → 保存で、再び開いても残る @regression", async ({ page }) => {
    await ws.gotoActive(page, PATH);
    const purpose = page.locator("textarea").first();
    await expect(purpose).toBeVisible({ timeout: 10000 });
    await expect(purpose).toBeDisabled();
    await expect(page.getByTestId("edit-mode-save")).toHaveCount(0);

    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled(); // 変更がないあいだは押せない
    await expect(purpose).toBeEnabled();
    const before = await purpose.inputValue();
    await purpose.fill(`${before} (追記)`);
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();
    await expect(page.getByTestId("edit-mode-changes")).toBeVisible();
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByText("保存しました")).toBeVisible({ timeout: 10000 });

    await ws.gotoActive(page, PATH);
    await expect(page.locator("textarea").first()).toHaveValue(`${before} (追記)`, { timeout: 10000 });
  });

  test("破棄すると、最後に保存した内容へ戻って閲覧に戻る @regression", async ({ page }) => {
    await ws.gotoActive(page, PATH);
    const purpose = page.locator("textarea").first();
    await expect(purpose).toBeVisible({ timeout: 10000 });
    const saved = await purpose.inputValue();
    await page.getByTestId("edit-mode-start").click();
    await purpose.fill("捨てる変更");
    await page.getByTestId("edit-mode-discard").click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 10000 });
    await expect(purpose).toHaveValue(saved);
    await expect(purpose).toBeDisabled();
  });
});
