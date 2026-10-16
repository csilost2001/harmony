/**
 * 図の拡大縮小・全体表示・選んでいる部品へ寄る (UI 改善提案 第 3 弾 #56): ER 図と画面フローで、同じキー操作。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `diagram-controls-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("図の拡大縮小", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("ER 図: ボタンとキー (+ − 0 F Z) で、拡大・縮小・等倍・全体・選択へ寄る", async ({ page }) => {
    await ws.gotoActive(page, "/table/er");
    const level = page.getByTestId("diagram-zoom-level");
    await expect(level).toBeVisible({ timeout: 20000 });
    const percent = async () => Number(((await level.textContent()) ?? "").replace("%", ""));
    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });

    await page.keyboard.press("0");
    await expect.poll(percent).toBe(100);
    await page.keyboard.press("-");
    await expect.poll(percent).toBeLessThan(100);
    const small = await percent();
    await page.keyboard.press("+");
    await expect.poll(percent).toBeGreaterThan(small);
    await page.keyboard.press("0");
    await expect.poll(percent).toBe(100);
    await page.getByTestId("diagram-fit").click();
    await expect.poll(percent).not.toBe(100);

    // 部品 (テーブル) を選んで Z: 選んだ部品へ寄る (全体表示より、拡大される)
    await page.keyboard.press("f");
    await expect.poll(async () => (await page.getByTestId("diagram-zoom-level").textContent()) ?? "").toMatch(/%/);
    const fit = await percent();
    await page.locator(".react-flow__node").first().click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("z");
    await expect.poll(percent).toBeGreaterThan(fit);
  });

  test("画面フロー: 同じキーで、全体を収める・拡大・縮小できる", async ({ page }) => {
    await ws.gotoActive(page, "/screen/flow");
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 20000 });
    const scale = () => page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("0");
    await expect.poll(async () => Math.round((await scale()) * 100)).toBe(100);
    await page.keyboard.press("+");
    await expect.poll(scale).toBeGreaterThan(1.05);
    const big = await scale();
    await page.keyboard.press("-");
    await expect.poll(scale).toBeLessThan(big - 0.1);
    const mid = await scale();
    await page.keyboard.press("-");
    await expect.poll(scale).toBeLessThan(mid - 0.1);
  });
});
