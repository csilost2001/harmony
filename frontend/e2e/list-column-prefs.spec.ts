/**
 * 一覧の列の幅・表示・並びを覚える (UI 改善提案 第 3 弾 #47)。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `list-column-prefs-${Date.now()}`;
let ws: OpenedWorkspace;

/** 一覧を表表示にして開く (既定はカード表示) */
async function openTable(page: Page) {
  await ws.gotoActive(page, "/screen/list");
  await page.getByRole("button", { name: "表表示" }).click();
  await expect(page.getByTestId("data-list-colmenu")).toBeVisible({ timeout: 15000 });
}
const headerKeys = (page: Page) => page.locator("th[data-col-key]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.colKey!));

test.describe("一覧の列の設定", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("列を隠す・並べ替える・幅を決めると、画面を開き直しても覚えている。既定に戻せる @regression", async ({ page }) => {
    await openTable(page);
    const initial = await headerKeys(page);
    expect(initial.length).toBeGreaterThanOrEqual(4);

    await page.getByTestId("data-list-colmenu").click();
    const menu = page.getByTestId("column-prefs-menu");
    await expect(menu).toBeVisible();
    // 4 番目の列を隠す
    await menu.getByTestId(`column-prefs-show-${initial[3]}`).uncheck();
    await expect.poll(() => headerKeys(page)).toEqual(initial.filter((k) => k !== initial[3]));
    // 先頭の列を 1 つ後ろへ
    await menu.getByTestId(`column-prefs-down-${initial[0]}`).click();
    await expect.poll(async () => (await headerKeys(page))[0]).not.toBe(initial[0]);
    const afterMove = await headerKeys(page);
    // 3 番目の列の幅を 220px に
    await menu.getByTestId(`column-prefs-width-${initial[2]}`).fill("220");
    await expect.poll(async () => Math.round((await page.locator(`th[data-col-key="${initial[2]}"]`).boundingBox())!.width)).toBe(220);

    // 開き直しても、同じ
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("data-list-colmenu")).toBeVisible({ timeout: 15000 });
    expect(await headerKeys(page)).toEqual(afterMove);
    expect(Math.round((await page.locator(`th[data-col-key="${initial[2]}"]`).boundingBox())!.width)).toBe(220);

    // 既定に戻す
    await page.getByTestId("data-list-colmenu").click();
    await page.getByTestId("column-prefs-reset").click();
    await expect.poll(() => headerKeys(page)).toEqual(initial);
  });

  test("見出しの右端のドラッグで幅を変え、ダブルクリックで自動に戻る。見出しのドラッグで並べ替えられる @regression", async ({ page }) => {
    await openTable(page);
    const keys = await headerKeys(page);
    const th = page.locator(`th[data-col-key="${keys[1]}"]`);
    const w0 = (await th.boundingBox())!.width;
    const grip = page.getByTestId(`data-list-col-resize-${keys[1]}`);
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 90, g.y + g.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await th.boundingBox())!.width).toBeGreaterThan(w0 + 60);
    await grip.dblclick();
    await expect.poll(async () => Math.abs((await th.boundingBox())!.width - w0)).toBeLessThan(3);

    // 見出しのドラッグ: 4 番目の列を、先頭の列の位置へ
    await page.locator(`th[data-col-key="${keys[3]}"]`).dragTo(page.locator(`th[data-col-key="${keys[0]}"]`));
    await expect.poll(async () => (await headerKeys(page))[0]).toBe(keys[3]);
    await page.getByTestId("data-list-colmenu").click();
    await page.getByTestId("column-prefs-reset").click();
  });

  test("条件で行を選ぶ: 列と条件を決めて、該当する行を選択に反映できる (含む・いま選んでいる行と同じ) @regression", async ({ page }) => {
    await openTable(page);
    const selectedRows = page.locator("tr.data-list-row.selected");
    await page.getByTestId("data-list-condmenu").click();
    const menu = page.getByTestId("select-by-condition");
    await expect(menu).toBeVisible();
    await menu.getByTestId("sbc-column").selectOption({ label: "種別" });
    await menu.getByTestId("sbc-value").fill("一覧");
    const count = Number(((await menu.getByTestId("sbc-count").textContent()) ?? "").match(/^(\d+)/)![1]);
    expect(count).toBeGreaterThan(0);
    await menu.getByTestId("sbc-replace").click();
    await expect(menu).toHaveCount(0);
    await expect(selectedRows).toHaveCount(count);

    // 1 行だけ選んで、「いま選んでいる行と同じ」種別の行を、選択に加える
    await page.locator("tr.data-list-row:not(.selected)").first().locator(".screen-table-name").click();
    await expect(selectedRows).toHaveCount(1);
    await page.getByTestId("data-list-condmenu").click();
    await menu.getByTestId("sbc-column").selectOption({ label: "種別" });
    await menu.getByTestId("sbc-op").selectOption("sameAsSelected");
    const same = Number(((await menu.getByTestId("sbc-count").textContent()) ?? "").match(/^(\d+)/)![1]);
    expect(same).toBeGreaterThanOrEqual(1);
    await menu.getByTestId("sbc-add").click();
    await expect(selectedRows).toHaveCount(same);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("選んだ行 (無ければすべて) を、Markdown・TSV・JSON で、他のアプリへ渡せる形でコピーできる @regression", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openTable(page);
    const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());

    // 何も選んでいないときは、すべての行
    await page.getByTestId("data-list-copymenu").click();
    await page.getByTestId("list-context-menu-item-copy-markdown").click();
    await expect.poll(readClipboard).toMatch(/^\| 画面名 \| /);
    const all = (await readClipboard()).split("\n");
    expect(all.length).toBe(2 + (await page.locator("tr.data-list-row").count()));

    // 行を選ぶと、選んだ行だけ (TSV)
    await page.locator("tr.data-list-row").nth(2).locator(".screen-table-name").click();
    await page.getByTestId("data-list-copymenu").click();
    await expect(page.getByTestId("list-context-menu-item-copy-tsv")).toContainText("選んだ 1 行");
    await page.getByTestId("list-context-menu-item-copy-tsv").click();
    await expect.poll(async () => (await readClipboard()).split("\n").length).toBe(2);
    expect((await readClipboard()).split("\n")[0]).toMatch(/^画面名\t/);

    // JSON
    await page.getByTestId("data-list-copymenu").click();
    await page.getByTestId("list-context-menu-item-copy-json").click();
    await expect.poll(async () => { try { return (JSON.parse(await readClipboard()) as unknown[]).length; } catch { return -1; } }).toBe(1);
  });
});
