/**
 * 画面フローの直接操作 (UI 改善提案 第 3 弾 #50): 線を引いた直後に、その場で遷移のラベルを入れる。
 * 線を何もない所へ落とすと、その位置に新しい画面を作って、つなぐ。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";

test.describe.configure({ mode: "serial" });

const KEY = `flow-direct-connect-${Date.now()}`;
let ws: OpenedWorkspace;
let seq = 0;

async function startEditing(page: Page) {
  await ws.gotoActive(page, "/screen/flow");
  await expect(page.locator(".flow-root")).toBeVisible();
  const start = page.getByTestId("edit-mode-start");
  await expect(start).toBeVisible({ timeout: 10000 });
  await start.click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}
async function addScreen(page: Page, name: string) {
  await page.locator("button.flow-btn-primary").filter({ hasText: /画面を追加/ }).first().click();
  await page.locator("#screen-name").fill(name);
  seq += 1;
  await page.getByTestId("entity-id-input").fill(`direct-${Date.now().toString(36)}-${seq}`);
  await page.locator('.flow-modal button[type="submit"]').click();
  await expect(page.locator(".react-flow__node-screenNode").filter({ hasText: name })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(400);
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16); await page.waitForTimeout(10); }
  await page.mouse.up();
}
const center = async (loc: ReturnType<Page["locator"]>) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test.describe("画面フローの線の直接操作", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, project: buildProject({ name: "直接操作の検査" }) });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  test("線を引くと、その場で遷移ラベルを入れられる (Enter で確定・Esc でスキップ)", async ({ page }) => {
    await startEditing(page);
    await addScreen(page, "入力画面");
    await addScreen(page, "確認画面");
    const a = page.locator(".react-flow__node-screenNode").filter({ hasText: "入力画面" });
    const b = page.locator(".react-flow__node-screenNode").filter({ hasText: "確認画面" });
    await page.waitForTimeout(800);
    await drag(page, await center(a.locator('.react-flow__handle[data-handleid="bottom"]')), await center(b.locator('.react-flow__handle[data-handleid="top"]')));
    const input = page.getByTestId("flow-quick-label");
    await expect(input).toBeVisible();
    await input.fill("確認する");
    await input.press("Enter");
    await expect(input).toHaveCount(0);
    await expect(page.locator(".react-flow__edgelabel-renderer, .react-flow__edge-textwrapper").filter({ hasText: "確認する" }).first()).toBeVisible();

    // Esc: スキップ (ラベルなしの遷移のまま)
    await drag(page, await center(b.locator('.react-flow__handle[data-handleid="bottom"]')), await center(a.locator('.react-flow__handle[data-handleid="top"]')));
    await expect(page.getByTestId("flow-quick-label")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("flow-quick-label")).toHaveCount(0);
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  });

  test("線を何もない所へ落とすと、その位置に新しい画面を作って、つなぐ", async ({ page }) => {
    await startEditing(page);
    await expect(page.locator(".react-flow__node-screenNode").first()).toBeVisible({ timeout: 10000 });
    const before = await page.locator(".react-flow__node-screenNode").count();
    const edgesBefore = await page.locator(".react-flow__edge").count();
    const a = page.locator(".react-flow__node-screenNode").first();
    const box = (await a.boundingBox())!;
    const from = await center(a.locator('.react-flow__handle[data-handleid="bottom"]'));
    await drag(page, from, { x: box.x + box.width / 2 + 40, y: box.y + box.height + 220 });
    // 画面の追加ダイアログが開く
    await page.locator("#screen-name").fill("新しい画面");
    seq += 1;
    await page.getByTestId("entity-id-input").fill(`dropped-${Date.now().toString(36)}-${seq}`);
    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator(".react-flow__node-screenNode")).toHaveCount(before + 1, { timeout: 10000 });
    await expect(page.locator(".react-flow__edge")).toHaveCount(edgesBefore + 1, { timeout: 10000 });
    // 新しい画面は、落とした位置のあたり (元の画面の下) にある
    const nb = (await page.locator(".react-flow__node-screenNode").filter({ hasText: "新しい画面" }).boundingBox())!;
    expect(nb.y).toBeGreaterThan(box.y + box.height);
  });
});
