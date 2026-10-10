/**
 * ダッシュボードの「はじめかた」パネルの E2E。
 *
 * - 設計がまだないプロジェクトでは、作る順の案内が出て、「はじめる」で各一覧へ移れる (設計の要確認は「検査するものがない」)
 * - 設計があるプロジェクトでは、始めた項目に件数と印が付く
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `getting-started-${Date.now()}`;
const EMPTY_KEY = `${KEY}-empty`;
let ws: OpenedWorkspace;
let emptyWs: OpenedWorkspace;

test.describe("はじめかた", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
    emptyWs = await setupTestWorkspace({ key: EMPTY_KEY });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY, EMPTY_KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("設計がないプロジェクトでは作る順の案内が出て、「はじめる」で一覧へ移れる @regression", async ({ page }) => {
    await emptyWs.gotoActive(page, "/");
    const panel = page.getByTestId("getting-started-panel");
    await expect(panel).toContainText("まだ設計がありません", { timeout: 15000 });
    await expect(panel.getByRole("button", { name: "はじめる" })).toHaveCount(5);
    await expect(page.getByTestId("design-issues-panel")).toContainText("検査するものがありません");
    await page.getByTestId("gsp-step-tables").getByRole("button", { name: "はじめる" }).click();
    await expect(page).toHaveURL(/\/table\/list/);
  });

  test("設計があるプロジェクトでは、始めた項目に件数が出る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    const panel = page.getByTestId("getting-started-panel");
    await expect(panel).toContainText("設計を始めた項目: 5 / 5", { timeout: 15000 });
    await expect(page.getByTestId("gsp-step-screens")).toContainText("件");
    await expect(page.getByTestId("gsp-step-businessFlows")).toContainText("1 件");
    await expect(panel.getByRole("button", { name: "はじめる" })).toHaveCount(0);
  });
});
