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

  test("ER 図: カラムの行のつまみから、別のテーブルのカラムへ線を引くと、カラムを入れたリレーション追加が開く。型が違えば知らせる", async ({ page }) => {
    await ws.gotoActive(page, "/table/er");
    await expect(page.locator('.react-flow__node[data-id="cart"]')).toBeVisible({ timeout: 20000 });
    // 線を引けるのは、編集中だけ (右上の編集のメニューから、新しい編集を始める)
    await page.getByTestId("esd-toggle-btn").click();
    await page.getByTestId("esd-new-draft-btn").click();
    await expect(page.getByRole("button", { name: /保存/ }).first()).toBeVisible({ timeout: 10000 });
    await page.getByTestId("diagram-fit").click();
    await page.waitForTimeout(500); // 全体表示の動き (0.2 秒) が終わってから、位置を読む
    const handle = (table: string, type: "source" | "target", rowText?: string) => {
      const row = page.locator(`.react-flow__node[data-id="${table}"] .er-col`).filter({ hasText: rowText ?? "" }).first();
      return row.locator(`.react-flow__handle.${type}`).first();
    };
    const drag = async (from: ReturnType<typeof handle>, to: ReturnType<typeof handle>) => {
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 - 30, b.y + b.height / 2, { steps: 12 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
      await page.mouse.up();
    };

    // (1) 型が合う: 主キー (BIGINT) どうし
    await drag(handle("cart", "source", "BIGINT"), handle("customer-master", "target", "BIGINT"));
    const modal = page.locator(".er-relation-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("参照元カラム")).not.toHaveValue("");
    await expect(modal.getByLabel("参照先カラム")).not.toHaveValue("");
    await expect(page.getByTestId("er-relation-type-warning")).toHaveCount(0);
    await modal.getByRole("button", { name: "キャンセル" }).click();

    // (2) 型が違う: 「他 N カラム」を開いて、文字のカラムへ
    await page.locator('.react-flow__node[data-id="customer-master"] .er-col-toggle').click();
    await drag(handle("cart", "source", "BIGINT"), handle("customer-master", "target", "VARCHAR"));
    await expect(modal).toBeVisible();
    await expect(page.getByTestId("er-relation-type-warning")).toContainText("型が違います");
    await modal.getByRole("button", { name: "キャンセル" }).click();
  });
});
