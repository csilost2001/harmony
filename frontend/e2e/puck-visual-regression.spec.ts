/**
 * Puck visual regression テスト — #814
 *
 * 視点: Puck エディタの chrome (sub-toolbar / 左パレット / 右プロパティパネル / theme CSS) の
 *      見た目が変わったら検出する。
 *
 * 既知制約 (#814):
 *   - MCP オフラインの E2E モードでは PuckBackend.load() が EMPTY_PUCK_DATA を返すため、
 *     setupPuckScreen() で localStorage に置いた puck-data は実際には canvas に load されない。
 *     よってこの baseline は **配置済 content 込みの WYSIWYG 表示** ではなく、
 *     **空 canvas を含む chrome 全体の visual snapshot** を検証する。
 *   - 配置済 content の visual baseline は MCP backend を起動した状態で取得する必要があり、
 *     現状は別 ISSUE 候補として保留 (e2e/mcp/ ディレクトリの test 群が担当する想定)。
 *
 * baseline 環境:
 *   - Windows / Chromium / 1280x720
 *   - font rendering 差は maxDiffPixelRatio: 0.05 で許容
 *   - Linux CI で動かす場合は再生成が必要 (--update-snapshots)
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { expect, test } from "@playwright/test";

import {
  HEADING_PARAGRAPH_DATA,
  PUCK_TW_SCREEN_ID,
  getPuckContainer,
  setupPuckScreen,
} from "./helpers/puck";

test.describe("Puck visual regression", () => {
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
