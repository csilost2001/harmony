/**
 * 編集体験の深掘り (UI 改善提案 続編 第 8 弾)。
 * 画面デザイナのサンプル値・状態・寸法・部品検索 / 処理フローの畳み・図で見る / 画面項目 / 最後の編集へ / クリップボード履歴 / 用語ゆれ / スクロール位置。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `editing-depth-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("編集体験の深掘り", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("画面デザイナ: サンプル値・画面の状態・寸法・部品の検索 @regression", async ({ page }) => {
    await ws.gotoActive(page, "/screen/design/cart");
    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 20000 });
    const canvas = page.getByTestId("layout-canvas");

    await page.getByTestId("layout-sample-mode").selectOption("typical");
    await page.getByTestId("layout-preview-state").selectOption("empty");
    await page.getByTestId("layout-preview-state").selectOption("normal");

    await canvas.locator("[data-node-id]").first().click();
    await page.getByTestId("layout-toggle-measures").click();
    await expect(canvas.getByTestId("layout-measures")).toBeAttached({ timeout: 10000 });
    await page.getByTestId("layout-toggle-measures").click();
    await expect(canvas.getByTestId("layout-measures")).toHaveCount(0);

    const search = page.getByTestId("layout-part-search");
    await search.fill("zzzz該当なし");
    await expect(page.getByTestId("layout-part-search-empty")).toBeVisible();
    await search.fill("");
    await expect(page.getByTestId("layout-part-search-empty")).toHaveCount(0);
  });

  test("処理フロー: 工程のまとめて畳む・開く、図で見るの判定表・式の試し実行・机上演習 @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.locator(".step-card").first()).toBeVisible({ timeout: 20000 });
    await page.getByTestId("palette-tab-outline").click();
    await page.getByTestId("steps-collapse-all").click();
    await page.getByTestId("steps-expand-all").click();
    await page.getByTestId("steps-expand-attention").click();

    await page.getByTestId("flow-diagram-open").click();
    await expect(page.getByTestId("flow-diagram-dialog")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("fdd-tab-decision").click();
    await expect(page.getByTestId("fdd-decision")).toBeVisible();
    await page.getByTestId("fdd-tab-walk").click();
    await expect(page.getByTestId("fdd-walk")).toBeVisible();
    await page.getByTestId("fdd-tab-eval").click();
    await expect(page.getByTestId("fdd-eval")).toBeVisible();
  });

  test("最後に編集した場所へ戻る (Ctrl+Alt+Backspace) @regression", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("edit-mode-start").click();
    const rows = page.locator(".screen-items-table tbody tr[data-deeplink^='item:']");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    const target = rows.nth(2);
    const key = await target.getAttribute("data-deeplink");
    const input = target.locator("input[type=text]").first();
    await input.focus();
    await page.keyboard.type("x");

    await rows.first().locator("input[type=text]").first().focus();
    await page.keyboard.press("Control+Alt+Backspace");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-deeplink]")?.getAttribute("data-deeplink") ?? null), { timeout: 10000 }).toBe(key);
  });

  test("クリップボード履歴: コピーした項目を、履歴から選び直せる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await page.getByTestId("edit-mode-start").click();
    const rows = page.locator(".screen-items-table tbody tr[data-deeplink^='item:']");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("clip-history-toggle")).toHaveCount(0);

    for (const i of [0, 1]) {
      await rows.nth(i).locator("input[type=checkbox]").first().check();
      await page.getByTestId("items-copy").click();
      await rows.nth(i).locator("input[type=checkbox]").first().uncheck();
    }
    await expect(page.getByTestId("clip-history-toggle")).toBeVisible();
    await page.getByTestId("clip-history-toggle").click();
    const items = page.getByTestId("clip-history-item");
    await expect(items).toHaveCount(2);
    await items.nth(1).click();
    await expect(page.getByText(/クリップボードに戻しました/)).toBeVisible();
    await expect(page.getByTestId("items-paste")).toContainText("(1)");
  });

  test("用語のゆれ: カラムの表示名に、ほかと違う長音の書き方を示し、そろえられる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order-item");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const rows = page.locator(".columns-data-list .data-list-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await rows.last().dblclick();
    const detail = page.getByTestId("column-detail");
    await expect(detail).toBeVisible();
    await page.keyboard.press("Control+Enter"); // 新しいカラム
    const nameField = detail.locator(".tbl-field input[type=text]").nth(1);
    await page.keyboard.type("memo_a");
    await page.keyboard.press("Enter");
    await page.keyboard.type("ユーザー名");
    await page.keyboard.press("Control+Enter"); // もう 1 つ (入力欄の中から次のカラムへ)
    await expect(rows.last()).toContainText("new_column", { timeout: 10000 });
    await rows.last().dblclick();
    await expect(detail).toBeVisible();
    await detail.locator(".tbl-field input[type=text]").nth(1).fill("ユーザ名");
    const hint = page.getByTestId("term-variant-hint");
    await expect(hint).toBeVisible({ timeout: 10000 });
    await expect(hint).toContainText("ユーザー");
    await page.getByTestId("term-variant-apply").click();
    await expect(nameField).toHaveValue("ユーザー名");
    await expect(page.getByTestId("term-variant-hint")).toHaveCount(0);
  });

  test("スクロール位置: 動かした位置を覚える (画面を開き直すと戻る)", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.locator(".step-card").first()).toBeVisible({ timeout: 20000 });
    await page.locator(".step-card").first().hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("harmony-scroll-memory") ?? ""), { timeout: 5000 }).toContain("order-confirm");
    const spots = await page.evaluate(() => {
      const all = JSON.parse(sessionStorage.getItem("harmony-scroll-memory") ?? "{}") as Record<string, Record<string, number>>;
      const k = Object.keys(all).find((r) => r.includes("order-confirm"))!;
      return all[k];
    });
    expect(Object.keys(spots).length).toBeGreaterThan(0);

    // 開き直すと、その位置へ戻る (sessionStorage は、再読み込みでも残る)
    await page.reload();
    await expect(page.locator(".step-card").first()).toBeVisible({ timeout: 20000 });
    const [key, want] = Object.entries(spots)[0];
    await expect.poll(() => page.evaluate(([k]) => {
      const v = k.slice(2);
      const el = k === "#doc" ? document.scrollingElement : k.startsWith("t:") ? document.querySelector(`[data-testid="${v}"]`) : k.startsWith("i:") ? document.getElementById(v) : document.querySelector(`.${v}`);
      return el ? el.scrollTop : -1;
    }, [key]), { timeout: 10000 }).toBeGreaterThan(want / 2);
  });
});
