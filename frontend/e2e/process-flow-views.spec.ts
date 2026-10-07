/**
 * 処理フローの表示切替 (カード / 図 / 表) の E2E。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `process-flow-views-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("処理フローの表示切替", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  test("図と処理記述表で表示し、表からカードの該当ステップへ移動できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.getByTestId("pf-view-diagram")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("pf-view-diagram").click();
    await expect(page.getByTestId("process-flow-diagram")).toBeVisible();
    // 入れ子のステップ (TX 内のループ内の DB アクセス) も図に描かれる
    await expect(page.locator('[data-testid="process-flow-diagram"] [data-step-id="step-06-01-a"]').first()).toBeVisible();
    await page.getByTestId("pfd-node-step-01").click();

    await page.getByTestId("pf-view-table").click();
    await expect(page.getByTestId("process-flow-table")).toBeVisible();
    await expect(page.getByTestId("pft-row-step-01")).toHaveClass(/is-selected/);
    await expect(page.locator(".pft-row.is-error").first()).toBeVisible();

    // 表示形式は次回も維持される
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.getByTestId("process-flow-table")).toBeVisible({ timeout: 15000 });

    await page.getByTestId("pft-row-step-03").dblclick();
    await expect(page.locator('.step-list [data-step-id="step-03"]').first()).toBeVisible();
  });
});
