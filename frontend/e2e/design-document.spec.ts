/**
 * 設計書ビュー (/document) の E2E。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `design-document-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("設計書ビュー", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  test("設計データから設計書を組み立て、目次で移動し、HTML で保存できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.getByTestId("design-document-view")).toBeVisible({ timeout: 15000 });
    const doc = page.locator(".hd-doc");
    await expect(doc.locator("#cover")).toContainText("リテール総合");
    // 画面設計: カートの項目定義とレイアウト
    await expect(doc.locator("#screen-cart")).toContainText("addProductCode");
    await expect(doc.locator("#screen-cart .lv-paper")).toBeVisible();
    // 処理設計: 注文確定の図と処理記述表
    await expect(doc.locator("#flow-order-confirm svg.hd-diagram")).toBeVisible();
    await expect(doc.locator("#flow-order-confirm .hd-outline")).toContainText("トランザクション");
    // CRUD 図と所見
    await expect(doc.locator("#crud")).toContainText("顧客マスタ");

    // 目次から移動
    await page.locator(".ddv-toc").getByRole("button", { name: "CRUD 図" }).click();
    await expect(doc.locator("#crud")).toBeInViewport();

    // HTML で保存
    const download = page.waitForEvent("download");
    await page.getByTestId("ddv-save-html").click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("retail-design-document.html");
  });
});
