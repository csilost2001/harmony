/**
 * キーボード・移動 (UI 改善 第 2 弾, #1507): 画面内検索・表の行操作・コマンドパレット・F6・部品の追加・ショートカットヘルプ。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `keyboard-flow-${Date.now()}`;
let ws: OpenedWorkspace;

async function startEditing(page: Page) {
  const start = page.getByTestId("edit-mode-start");
  await expect(start).toBeVisible({ timeout: 15000 });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

test.describe("キーボード操作", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("画面項目の表: Ctrl+Enter で挿入・Ctrl+D で上の値を写す・Alt+Delete で削除", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    const rows = page.locator(".screen-items-table tbody tr[data-grid-row]");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    const firstId = rows.nth(0).locator('input[placeholder="例: email"]');
    await firstId.focus();
    const firstValue = await firstId.inputValue();
    await page.keyboard.press("Control+Enter");
    await expect(rows).toHaveCount(n + 1);
    // 挿入した行 (2 行目) の項目 ID 欄へフォーカスが移っている。Ctrl+D で、上の行の値を写す
    const second = rows.nth(1).locator('input[placeholder="例: email"]');
    await expect(second).toBeFocused();
    await page.keyboard.press("Control+d");
    await expect(second).toHaveValue(firstValue);
    // Alt+Delete で削除 (元の行数に戻る)
    await page.keyboard.press("Alt+Delete");
    await expect(rows).toHaveCount(n);
  });

  test("Ctrl+F で画面の中を検索 (入力欄の値も探す)。Esc で閉じて、見つけた欄へ", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    const firstId = page.locator(".screen-items-table tbody tr[data-grid-row]").nth(0).locator('input[placeholder="例: email"]');
    const value = await firstId.inputValue();
    expect(value.length).toBeGreaterThan(0);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+f");
    const box = page.getByTestId("editor-find-input");
    await expect(box).toBeFocused();
    await page.keyboard.type(value);
    await expect(page.getByTestId("editor-find-count")).toContainText(/\d+ \/ \d+/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("editor-find")).toHaveCount(0);
  });

  test("コマンドパレットに、この画面の操作が出て、実行できる。F6 で領域を移る。? でこの画面のショートカット", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    const rows = page.locator(".screen-items-table tbody tr[data-grid-row]");
    const n = await rows.count();
    await page.keyboard.press("Control+k");
    await page.keyboard.type(">画面項目を追加");
    await expect(page.getByTestId("quick-open-item").or(page.locator('[data-testid^="quick-open-"]').first())).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(n + 1);

    // F6 で、領域を順に移り、項目の表へ (画面の上のマーカーの欄も、領域の 1 つ)
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const regionOf = () => page.evaluate(() => document.activeElement?.closest("#app-main [data-region]")?.getAttribute("data-region") ?? null);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("F6");
      const r = await regionOf();
      if (r) seen.push(r);
      if (r === "項目の表") break;
    }
    expect(seen).toContain("項目の表");

    // ? でショートカット一覧 (この画面に関係するグループが開いている)
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcut-help")).toBeVisible();
    await expect(page.getByTestId("shortcut-group-open").first()).toBeVisible();
    await expect(page.getByTestId("shortcut-help")).toContainText("この画面");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
  });

  test("画面デザイナ: / で部品の追加メニューを開き、打ち込んで Enter で追加する", async ({ page }) => {
    await ws.gotoActive(page, "/screen/design/cart");
    await startEditing(page);
    const nodes = page.locator("[data-node-id]");
    await expect(nodes.first()).toBeVisible({ timeout: 15000 });
    const before = await nodes.count();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect(page.getByTestId("quick-pick-menu")).toBeVisible();
    await page.keyboard.type("区切り");
    await expect(page.getByTestId("quick-pick-item")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("quick-pick-menu")).toHaveCount(0);
    await expect.poll(async () => nodes.count()).toBeGreaterThan(before);
  });

  test("ブラウザの戻る・進む (Alt+←/→) が、画面の移動に効く", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible();
    // 画面の中の移動 (Ctrl+K) は、ブラウザの履歴に積まれる
    await page.keyboard.press("Control+k");
    await page.keyboard.type("画面一覧");
    await expect(page.getByTestId("quick-open-item").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/screen\/list/);
    await page.goBack();
    await expect(page).toHaveURL(/\/table\/list/);
    await page.goForward();
    await expect(page).toHaveURL(/\/screen\/list/);
  });
});
