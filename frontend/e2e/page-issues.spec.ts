/**
 * 入力欄の直下の指摘と直し方 (#81・#100)、次の要確認へ (F8 / Shift+F8) と左下の件数 (#88)。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `page-issues-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("入力欄の指摘と次の要確認", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("物理名の形式が違うと、欄の直下に理由と直した値が出て、1 クリックで直せる。左下に件数が出て、F8 / Shift+F8 で順に移れる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart-item");
    const start = page.getByTestId("edit-mode-start");
    await expect(start).toBeVisible({ timeout: 15000 });
    await start.click();
    await page.getByTestId("columns-grid-toggle").click();
    const rows = page.getByTestId("column-grid-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const phys = (i: number) => rows.nth(i).locator('input[aria-label$="行目の物理名"]');
    const nav = page.getByTestId("page-issue-nav");
    await expect(nav).toHaveCount(0); // いまは、要確認が無い

    // 形式が違う物理名を 2 つ (1 行目・3 行目)。Tab で欄を出ると反映される
    await phys(1).fill("Bad Name"); await phys(1).press("Tab");
    await phys(3).fill("Order-Total"); await phys(3).press("Tab");
    await expect(page.getByTestId("column-name-hint-1")).toContainText("使えない文字");
    await expect(page.getByTestId("column-name-hint-1")).toContainText("「bad_name」に直す");
    await expect(phys(1)).toHaveAttribute("aria-invalid", "true");
    await expect(nav).toBeVisible({ timeout: 5000 });
    await expect(nav).toContainText("要確認 2 件");

    // F8: 次の要確認へ (先頭の欄から) / Shift+F8: 前へ (巡る)
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("F8");
    await expect(phys(1)).toBeFocused();
    await page.keyboard.press("F8");
    await expect(phys(3)).toBeFocused();
    await page.keyboard.press("Shift+F8");
    await expect(phys(1)).toBeFocused();

    // 直す: 1 クリック
    await page.getByTestId("column-name-hint-1").getByTestId("field-hint-fix").click();
    await expect(phys(1)).toHaveValue("bad_name");
    await expect(page.getByTestId("column-name-hint-1")).toHaveCount(0);
    await expect(nav).toContainText("要確認 1 件");
  });
});
