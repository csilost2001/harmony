/**
 * ID・物理名の欄: 全角・空白の正規化と入力モード (UI 改善提案 第 5 弾 #93・#94)。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `field-normalize-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("ID・物理名の欄の正規化", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("テーブル追加の物理名: 全角を貼り付けると半角になり、Ctrl+Z で戻せる。入力モードの属性が付いている", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ws.gotoActive(page, "/table/list");
    await page.getByRole("button", { name: /テーブルを?追加/ }).first().click();
    const modal = page.locator(".tbl-modal");
    const phys = modal.getByPlaceholder("例: customers");
    await expect(phys).toBeVisible();
    // 日本語入力・自動の大文字化・自動修正を、働かせない属性
    await expect(phys).toHaveAttribute("autocapitalize", "off");
    await expect(phys).toHaveAttribute("autocorrect", "off");
    await expect(phys).toHaveAttribute("data-norm", "ascii");

    await page.evaluate(() => navigator.clipboard.writeText("　ｏｒｄｅｒ＿ｉｔｅｍ\n"));
    await phys.focus();
    await page.keyboard.press("Control+v");
    await expect(phys).toHaveValue("order_item");
    await expect(page.getByText(/全角を半角にしました/)).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(phys).toHaveValue("");
  });

  test("入力が終わったとき (フォーカスが外れたとき)、残っている全角・前後の空白を直す。名称の欄は変換しない", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await page.getByRole("button", { name: /テーブルを?追加/ }).first().click();
    const modal = page.locator(".tbl-modal");
    const phys = modal.getByPlaceholder("例: customers");
    const display = modal.getByPlaceholder("例: 顧客マスタ");
    await phys.fill("ＡｂＣ１２ ");
    await display.focus(); // フォーカスを外す
    await expect(phys).toHaveValue("AbC12");
    await display.fill("　全角のままの名称　");
    await phys.focus();
    await expect(display).toHaveValue("　全角のままの名称　"); // 名称は、変換しない
  });
});
