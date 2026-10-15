/**
 * マーカー (UI 改善 第 4 弾, #1509): どの設計にも付けられる・全設計の一覧と集計・キーでの追加・AI (MCP) と同じ場所への保存。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `markers-${Date.now()}`;
let ws: OpenedWorkspace;
const dataFile = (sub: string, id: string) => path.join(ws.workspacePath, "harmony", sub, `${id}.json`);
const readJson = async (p: string) => JSON.parse(await fs.readFile(p, "utf-8"));
const markersOf = async (sub: string, id: string) => ((await readJson(dataFile(sub, id))) as { authoring?: { markers?: Array<Record<string, unknown>> } }).authoring?.markers ?? [];

async function dismissResume(page: Page) {
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false))) break;
    await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
    await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }
}

test.describe("マーカー", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("テーブル: マーカーのタブでカラムを指して追加 → カラムにバッジ → 保存で authoring.markers に、anchor つきで入る", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart");
    await dismissResume(page);
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
    await page.getByTestId("table-tab-markers").click();
    const select = page.getByTestId("marker-anchor-select");
    await expect(select).toBeVisible();
    // 先頭のカラムを指す
    const firstColumn = await select.locator("option").nth(1).getAttribute("value");
    expect(firstColumn).toMatch(/^\$\.columns\[/);
    await select.selectOption(firstColumn!);
    const input = page.getByTestId("marker-add-input");
    await input.fill("1 行目の指示");
    await input.press("Shift+Enter");
    await input.pressSequentially("2 行目の指示");
    await input.press("Enter");
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(1);
    await expect(page.getByTestId("table-marker-count")).toHaveText("1");
    // カラムのバッジ (列のタブへ戻ると、一覧の行に出る)
    await page.locator(".table-editor-tabs button").first().click();
    await expect(page.locator('[data-testid^="col-marker-badge-"]').first()).toBeVisible();
    await page.getByTestId("edit-mode-save").click();
    await expect.poll(async () => (await markersOf("tables", "cart")).length, { timeout: 15000 }).toBe(1);
    const [m] = await markersOf("tables", "cart");
    expect(m).toMatchObject({ kind: "chat", author: "human", body: "1 行目の指示\n2 行目の指示", anchor: { fieldPath: firstColumn } });
    expect(String(m.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await readJson(dataFile("tables", "cart")) as { markers?: unknown }).markers).toBeUndefined();
  });

  test("画面項目: マーカーは、設計の保存とは別に、その場で保存される。行のバッジ・Ctrl+Alt+M で位置つきの追加", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    const panel = page.getByTestId("marker-panel");
    await expect(panel).toBeVisible({ timeout: 15000 });
    await dismissResume(page);
    // 閲覧中は、項目の欄に入れない (キーで項目を指すのは、編集中)。マーカーの追加は、閲覧中でもできる
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
    await panel.locator(".catalog-panel-toggle").click();
    // 1 行目の項目の入力欄にフォーカス → Ctrl+Alt+M で、その項目を指した追加欄へ
    const firstRow = page.locator(".screen-items-table tbody tr[data-grid-row]").first();
    const itemId = await firstRow.locator('input[placeholder="例: email"]').inputValue();
    await firstRow.locator('input[placeholder="例: email"]').focus();
    await page.keyboard.press("Control+Alt+m");
    await expect(page.getByTestId("marker-add-input")).toBeFocused();
    await expect(page.getByTestId("marker-anchor-select")).toHaveValue(`$.items[${itemId}]`);
    await page.keyboard.type("この項目の桁数を確認して");
    await page.keyboard.press("Enter");
    // 保存ボタンを押さなくても、ファイルに入る
    await expect.poll(async () => (await markersOf("screens", "cart")).length, { timeout: 15000 }).toBe(1);
    const [m] = await markersOf("screens", "cart");
    expect(m).toMatchObject({ body: "この項目の桁数を確認して", anchor: { fieldPath: `$.items[${itemId}]` } });
    await expect(page.getByTestId(`item-marker-badge-${itemId}`)).toBeVisible();
  });

  test("マーカー一覧 (/markers): 全設計のマーカーが並び、絞り込める。選んで、メモつきでまとめて解決できる", async ({ page }) => {
    await ws.gotoActive(page, "/markers");
    const table = page.getByTestId("markers-table");
    await expect(table).toBeVisible({ timeout: 15000 });
    await expect(table.locator("tbody tr")).toHaveCount(2); // テーブル 1 + 画面 1
    await page.getByTestId("markers-type").selectOption("table");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await page.getByTestId("markers-type").selectOption("");
    await table.locator("tbody tr").first().getByRole("checkbox").check();
    await page.getByTestId("markers-note").fill("確認済み");
    await page.getByTestId("markers-resolve-picked").click();
    await expect(table.locator("tbody tr")).toHaveCount(1); // 解決したものは、既定の表示から消える
    await expect.poll(async () => {
      const all = [...(await markersOf("tables", "cart")), ...(await markersOf("screens", "cart"))];
      return all.filter((x) => x.resolvedAt).length;
    }, { timeout: 15000 }).toBe(1);
    const resolved = [...(await markersOf("tables", "cart")), ...(await markersOf("screens", "cart"))].find((x) => x.resolvedAt)!;
    expect(resolved.resolution).toBe("確認済み");
  });

  test("ダッシュボード: 処理フロー以外 (テーブル・画面) のマーカーも数える。「すべて見る」で一覧へ", async ({ page }) => {
    await ws.gotoActive(page, "/");
    const total = page.getByTestId("markers-summary-total");
    await expect(total).toHaveText("1", { timeout: 15000 });
    await page.getByTestId("markers-summary-all").click();
    await expect(page).toHaveURL(/\/markers$/);
  });

  test("処理フロー: 工程の見出しで Ctrl+Alt+M → ダイアログに複数行で書いて追加 (window.prompt ではない)。工程の位置つきで入る", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await dismissResume(page);
    await expect(page.locator(".step-card-header").first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
    const header = page.locator(".step-card-header").first();
    const stepId = await header.evaluate((el) => el.closest(".step-card")?.getAttribute("data-step-id"));
    await header.focus();
    await page.keyboard.press("Control+Alt+m");
    await expect(page.getByTestId("step-marker-dialog")).toBeVisible();
    await page.getByTestId("step-marker-kind").selectOption("question");
    await page.keyboard.type("この条件で正しいですか");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("理由も教えて");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("step-marker-dialog")).toHaveCount(0);
    await page.getByTestId("edit-mode-save").click();
    await expect.poll(async () => (await markersOf("process-flows", "order-confirm")).some((m) => m.body === "この条件で正しいですか\n理由も教えて"), { timeout: 15000 }).toBe(true);
    const m = (await markersOf("process-flows", "order-confirm")).find((x) => x.body === "この条件で正しいですか\n理由も教えて")!;
    expect(m).toMatchObject({ kind: "question", anchor: { stepId } });
  });
});
