/**
 * 工程・項目への直接のリンク (UI 改善提案 第 5 弾 #95): URL の #item= / #step= で開くと、その要素へ移る。Ctrl+Alt+L でリンクをコピー。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `deep-link-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("直接のリンク", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("画面項目: #item=<ID> で開くと、その行へ移って強調する。Ctrl+Alt+L で、その行へのリンクをコピーできる", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const screen = JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", "cart.json"), "utf-8"));
    const target: string = screen.items[Math.min(3, screen.items.length - 1)].id;
    await ws.gotoActive(page, "/screen/items/cart");
    await page.goto(`${page.url().split("#")[0]}#item=${encodeURIComponent(target)}`);
    await page.reload(); // リンクを開いた状態 (最初の読み込みで、末尾が付いている)
    const row = page.locator(`tr[data-deeplink="item:${target}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("tr")?.getAttribute("data-deeplink") ?? null), { timeout: 10000 }).toBe(`item:${target}`);

    // コピー: 別の行にフォーカスして Ctrl+Alt+L
    const first: string = screen.items[0].id;
    await page.locator(`tr[data-deeplink="item:${first}"] input`).first().focus();
    await page.keyboard.press("Control+Alt+l");
    await expect(page.getByText(new RegExp(`項目「${first}」へのリンクをコピーしました`))).toBeVisible();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain("/screen/items/cart");
    expect(url).toContain(`#item=${first}`);
  });

  test("処理フロー: #step=<工程 ID> で開くと、その工程へ移る", async ({ page }) => {
    const flow = JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "process-flows", "order-confirm.json"), "utf-8"));
    const steps: Array<{ id: string }> = flow.actions[0].steps;
    const target = steps[Math.min(2, steps.length - 1)].id;
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.goto(`${page.url().split("#")[0]}#step=${encodeURIComponent(target)}`);
    await page.reload();
    const card = page.locator(`[data-deeplink="step:${target}"]`);
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-deeplink]")?.getAttribute("data-deeplink") ?? null), { timeout: 10000 }).toBe(`step:${target}`);
  });
});
