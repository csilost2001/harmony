/**
 * 取り消せる削除は、確認を出さずに実行する (UI 改善提案 第 5 弾 #87)。ER 図の論理リレーションの削除で確かめる。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `undoable-delete-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("取り消せる削除", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("論理リレーションを削除しても、確認のダイアログは出ず、「削除しました (Ctrl+Z で戻せます)」と出て、Ctrl+Z で戻る", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; void d.accept(); });
    await ws.gotoActive(page, "/table/er");
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 20000 });
    await page.getByTestId("esd-toggle-btn").click();
    await page.getByTestId("esd-new-draft-btn").click();
    await expect(page.getByRole("button", { name: /保存/ }).first()).toBeVisible({ timeout: 10000 });

    const edges = page.locator(".react-flow__edge");
    const before = await edges.count();
    await page.getByRole("button", { name: /リレーション追加/ }).click();
    const modal = page.locator(".er-relation-modal");
    await modal.getByLabel("参照元テーブル").selectOption("cart");
    await modal.getByLabel("参照先テーブル").selectOption("store-master");
    await modal.getByRole("button", { name: "追加", exact: true }).click();
    await expect(edges).toHaveCount(before + 1);

    await edges.last().dblclick({ force: true });
    await expect(page.getByText(/論理リレーションを削除しました \(Ctrl\+Z で戻せます\)/)).toBeVisible();
    await expect(edges).toHaveCount(before);
    expect(dialogs).toBe(0);

    await page.locator(".er-diagram-canvas").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect(edges).toHaveCount(before + 1);
  });
});
