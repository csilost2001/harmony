/**
 * 処理フローの目次 (UI 改善提案 第 5 弾 #90): 左の「目次」で、入れ子の構造を見渡し、クリックで該当の工程へ移る。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `step-outline-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("処理フローの目次", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("目次に工程が入れ子の番号つきで並び、クリックで工程へ移る。文字で絞り込める", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.locator(".step-card").first()).toBeVisible({ timeout: 15000 });
    const total = await page.locator('.step-card-wrapper[data-deeplink^="step:"]').count();
    await page.getByTestId("palette-tab-outline").click();
    const outline = page.getByTestId("step-outline");
    await expect(outline).toBeVisible();
    const items = outline.locator('[data-testid^="step-outline-item-"]');
    expect(await items.count()).toBeGreaterThanOrEqual(Math.min(total, 3));
    await expect(items.first().locator(".step-outline-no")).toHaveText("1");

    // 最後の工程へ移る (クリックで、その工程にフォーカスが移る)
    const last = items.last();
    const lastId = (await last.getAttribute("data-testid"))!.replace("step-outline-item-", "");
    await last.click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-deeplink]")?.getAttribute("data-deeplink") ?? null)).toBe(`step:${lastId}`);

    // 絞り込み
    const firstText = (await items.first().textContent()) ?? "";
    await outline.getByLabel("目次を絞り込む").fill("zzzz該当なし");
    await expect(outline.getByText("該当する工程がありません")).toBeVisible();
    await outline.getByLabel("目次を絞り込む").fill("");
    expect(firstText.length).toBeGreaterThan(0);
    await expect(items.first()).toBeVisible();

    // ブロックに戻せる
    await page.getByTestId("palette-tab-blocks").click();
    await expect(outline).toHaveCount(0);
  });
});
