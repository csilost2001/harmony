/**
 * ErrorBoundary 防御層 E2E テスト (#123)
 *
 * 目的: 個別タブのクラッシュや localStorage の不整合でも
 *       アプリが「起動すらできない」状態にならないことを保証する。
 */

import { test, expect } from "@playwright/test";

test.describe("起動時 localStorage バリデーション", () => {
  test("不正エントリ混在のタブJSONでもヘッダーが見え、有効なタブだけ残る", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "harmony-open-tabs",
        JSON.stringify([
          { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
          { id: "legacy-xxx", type: "legacy-unknown-type", resourceId: "x", label: "古い形式" },
          { garbage: true },
          null,
        ])
      );
      localStorage.setItem("harmony-active-tab", "dashboard:main");
    });

    await page.goto("/");
    await expect(page.locator(".common-header")).toBeVisible();
    await expect(page.locator(".app-error-fallback")).toHaveCount(0);
    // 不正 3 件は除去されて dashboard のみ残る
    await expect(page.locator(".tabbar-tab")).toHaveCount(1);
    await expect(page.locator(".tabbar-tab")).toContainText("ダッシュボード");
  });

  test("パース不能な JSON でもクラッシュせずアプリは起動する", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("harmony-open-tabs", "{{{ not json");
      localStorage.setItem("harmony-active-tab", "design:xxx");
    });

    await page.goto("/");
    // ヘッダーが見えればアプリは起動している
    await expect(page.locator(".common-header")).toBeVisible();
    // AppErrorFallback は出ていない
    await expect(page.locator(".app-error-fallback")).toHaveCount(0);
    // URL=/ ルートに対応する dashboard シングルトンが自動で開かれる
    await expect(page.locator(".tabbar-tab")).toContainText("ダッシュボード");
  });

  test("孤立した /screen/design/:id URL でも AppErrorFallback を出さない", async ({ page }) => {
    // URL は design だが tabs / active は dashboard。以前は Route element={null} で空領域になっていた。
    await page.addInitScript(() => {
      localStorage.setItem(
        "harmony-open-tabs",
        JSON.stringify([
          { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
        ])
      );
      localStorage.setItem("harmony-active-tab", "dashboard:main");
    });

    await page.goto("/screen/design/non-existent-screen-id");

    await expect(page.locator(".common-header")).toBeVisible();
    // AppErrorFallback は出ない（全体クラッシュにはなっていない）
    await expect(page.locator(".app-error-fallback")).toHaveCount(0);
  });
});
