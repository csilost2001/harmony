/**
 * 変更した欄の強調と、欄ごとの取り消し (UI 改善提案 第 5 弾 #84): カラムの表で編集。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `changed-fields-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("変更した欄", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("保存した内容と違う欄に印が付き、↺ でその欄だけ戻せる。新しい行には「新規」が付く。保存すると印は消える", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart-item");
    await page.getByTestId("edit-mode-start").click();
    await page.getByTestId("columns-grid-toggle").click();
    const rows = page.getByTestId("column-grid-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".cg-changed")).toHaveCount(0); // 開いた直後は、印なし

    const name = (i: number) => rows.nth(i).locator('input[aria-label$="の表示名"]');
    const original = await name(1).inputValue();
    const comment = rows.nth(2).locator('input[aria-label$="の備考"]');
    const originalComment = await comment.inputValue();

    await name(1).fill("変更した表示名"); await name(1).press("Tab");
    await comment.fill("変更した備考"); await comment.press("Tab");
    await expect(page.locator(".cg-changed")).toHaveCount(2);
    await expect(rows.nth(1).locator(".cg-changed")).toHaveCount(1);

    // ↺ で、表示名の欄だけを戻す (備考は、変更のまま)
    await rows.nth(1).locator(".cg-revert").click();
    await expect(name(1)).toHaveValue(original);
    await expect(page.locator(".cg-changed")).toHaveCount(1);
    await expect(comment).toHaveValue("変更した備考");

    // 新しい行 (カラム追加) には、「新規」
    await page.getByRole("button", { name: "カラム追加" }).click();
    await expect(page.locator(".cg-new-mark")).toHaveCount(1);

    // 保存すると、印は消える
    await comment.focus();
    await page.getByTestId("edit-mode-save").click();
    await expect(page.locator(".cg-changed")).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator(".cg-new-mark")).toHaveCount(0);
    expect(originalComment).not.toBe("変更した備考");
  });
});
