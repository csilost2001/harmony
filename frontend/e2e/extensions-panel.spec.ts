import { test, expect } from "@playwright/test";

test.describe("拡張管理 UI (#447)", () => {
  test("5 種別タブを切り替えられる", async ({ page }) => {
    await page.goto("/extensions");
    await expect(page.getByRole("heading", { name: "拡張管理" })).toBeVisible();

    for (const name of ["ステップ型", "フィールド型", "トリガー", "DB 操作", "レスポンス型"]) {
      await page.getByRole("tab", { name: new RegExp(name) }).click();
      await expect(page.getByRole("tab", { name: new RegExp(name) })).toHaveAttribute("aria-selected", "true");
    }
  });

  test("レスポンス型を追加して保存できる", async ({ page }) => {
    await page.goto("/extensions?tab=responseTypes");
    await page.getByRole("button", { name: "追加" }).click();
    await page.getByPlaceholder("ApiError").last().fill("E2EResponse");
    await page.locator(".response-type-schema").last().fill('{"type":"object","properties":{"code":{"type":"string"}}}');
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました。")).toBeVisible({ timeout: 10000 });
    await expect(page.getByDisplayValue("E2EResponse")).toBeVisible();
  });
});
