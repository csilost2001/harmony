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

  test("元に戻す・やり直しができ、何を戻したかを知らせる。入力中の連続した変更は 1 回分 (UI 改善提案 第 5 弾 #85・#86) @regression", async ({ page }) => {
    await ws.gotoActive(page, PATH);
    const purpose = page.locator("textarea").first();
    await expect(purpose).toBeVisible({ timeout: 10000 });
    await page.getByTestId("edit-mode-start").click();
    const original = await purpose.inputValue();
    await expect(page.getByTestId("gd-undo")).toBeDisabled();
    // 1 回の入力 (連続した文字) = 1 回分。末尾へカーソルを置いて打つ
    await purpose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" 追記A", { delay: 30 });
    await page.waitForTimeout(900); // 入力が止まると、履歴に積まれる
    await page.keyboard.type(" 追記B", { delay: 30 });
    await expect(page.getByTestId("gd-undo")).toBeEnabled();

    await page.getByTestId("gd-undo").click();
    await expect(purpose).toHaveValue(`${original} 追記A`);
    await expect(page.getByText(/元に戻しました: .*目的/)).toBeVisible();
    await page.getByTestId("gd-undo").click();
    await expect(purpose).toHaveValue(original);
    await expect(page.getByTestId("gd-undo")).toBeDisabled();
    await page.getByTestId("gd-redo").click();
    await expect(purpose).toHaveValue(`${original} 追記A`);
    await expect(page.getByText(/やり直しました: /)).toBeVisible();

    // Ctrl+Z (入力欄の外で)
    await page.locator("h2").first().click();
    await page.keyboard.press("Control+z");
    await expect(purpose).toHaveValue(original);
  });
});
