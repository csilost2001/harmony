/**
 * Puck visual regression テスト — #814
 *
 * 視点: Puck エディタの chrome (sub-toolbar / 左パレット / 右プロパティパネル / theme CSS) の
 *      見た目が変わったら検出する。
 *
 * 既知制約 (#814 / #1420 D):
 *   - realWorkspace + backend canonical Puck data (`harmony/screens/<id>/puck-data.json`) を使うため、
 *     baseline は配置済 content 込みの Puck chrome を検証する。
 *
 * baseline 環境:
 *   - Windows / Chromium / 1280x720
 *   - font rendering 差は maxDiffPixelRatio: 0.05 で許容
 *   - Linux CI で動かす場合は再生成が必要 (--update-snapshots)
 */
import { expect, test } from "@playwright/test";

import {
  HEADING_PARAGRAPH_DATA,
  PUCK_TW_SCREEN_ID,
  getPuckContainer,
  setupPuckScreen,
} from "./helpers/puck";

test.describe("Puck visual regression", { tag: ["@regression"] }, () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("Bootstrap chrome (palette + sub-toolbar + right panel)", async ({ page }) => {
    await setupPuckScreen(page, {
      cssFramework: "bootstrap",
      puckData: HEADING_PARAGRAPH_DATA,
    });

    await expect(getPuckContainer(page)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("puck-bootstrap-heading-paragraph.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.05,
    });
  });

  test("Tailwind chrome (palette + sub-toolbar + right panel)", async ({ page }) => {
    await setupPuckScreen(page, {
      screenId: PUCK_TW_SCREEN_ID,
      cssFramework: "tailwind",
      puckData: HEADING_PARAGRAPH_DATA,
    });

    await expect(getPuckContainer(page)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("puck-tailwind-heading-paragraph.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.05,
    });
  });
});
