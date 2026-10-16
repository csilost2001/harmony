/**
 * 入力の手数の予算 (UI 改善提案 第 5 弾 #97): 主要な作業の「操作数」(クリック + キー入力の数) を数え、上限 (operation-budget.json) を超えたら落ちる。
 * 文字を打つ作業は、実際に打つ文字数も含める (キー入力は、1 文字 1 回。日本語は、変換のキー入力が数えられないので、半角英数字で打つ)。UI の手数が増える変更を、数字で止める。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `operation-budget-${Date.now()}`;
let ws: OpenedWorkspace;
let budget: Record<string, number>;

/** 数え始める: 主ボタンのクリックと、修飾キー以外のキー入力 */
async function startCounting(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __ops?: { n: number; log: string[] }; __opsInstalled?: boolean };
    w.__ops = { n: 0, log: [] };
    if (w.__opsInstalled) return;
    w.__opsInstalled = true;
    document.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.isPrimary) { w.__ops!.n++; w.__ops!.log.push(`click:${(e.target as HTMLElement).tagName}`); } }, true);
    document.addEventListener("keydown", (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key) && !e.repeat) { w.__ops!.n++; w.__ops!.log.push(`key:${e.key}`); } }, true);
  });
}
const ops = (page: Page) => page.evaluate(() => (window as unknown as { __ops: { n: number } }).__ops.n);
const log = (page: Page) => page.evaluate(() => (window as unknown as { __ops: { log: string[] } }).__ops.log.join(" "));

test.describe("入力の手数の予算", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
    budget = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "e2e/operation-budget.json"), "utf-8"));
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("テーブルにカラムを足す (編集開始 → 表で編集 → カラム追加 → 表示名「total」)", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart-item");
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
    await startCounting(page);
    await page.getByTestId("edit-mode-start").click();
    await page.getByTestId("columns-grid-toggle").click();
    const before = await page.getByTestId("column-grid-row").count();
    await page.getByRole("button", { name: "カラム追加" }).click();
    await expect(page.getByTestId("column-grid-row")).toHaveCount(before + 1);
    // カラム追加の直後は、新しい行の表示名の欄にいる (打ち始められる)
    await page.keyboard.type("total");
    await page.keyboard.press("Tab");
    const n = await ops(page);
    console.log(`OPS table-add-column ${n}: ${await log(page)}`);
    expect(n).toBeLessThanOrEqual(budget["table-add-column"]);
  });

  test("処理フローに工程を挿入する (編集開始 → 工程を選ぶ → Insert → 「DB」→ Enter)", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
    await startCounting(page);
    await page.getByTestId("edit-mode-start").click();
    const headers = page.locator(".step-card-header");
    await expect(headers.first()).toBeVisible();
    const before = await page.locator(".step-card").count();
    await headers.first().click();
    await page.keyboard.press("Insert");
    await page.keyboard.type("DB");
    await page.keyboard.press("Enter");
    await expect(page.locator(".step-card")).toHaveCount(before + 1);
    const n = await ops(page);
    console.log(`OPS step-insert ${n}: ${await log(page)}`);
    expect(n).toBeLessThanOrEqual(budget["step-insert"]);
  });

  test("画面に項目を足す (編集開始 → 項目追加 → ID「memo」→ Tab → 表示名「note」)", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
    await startCounting(page);
    await page.getByTestId("edit-mode-start").click();
    const rows = page.locator(".screen-items-table tbody tr[data-grid-row]");
    const before = await rows.count();
    await page.locator(".screen-items-add").click();
    await expect(rows).toHaveCount(before + 1);
    await page.keyboard.type("memo");
    await page.keyboard.press("Tab");
    await page.keyboard.type("note");
    const n = await ops(page);
    console.log(`OPS screen-item-add ${n}: ${await log(page)}`);
    expect(n).toBeLessThanOrEqual(budget["screen-item-add"]);
  });

  test("参照を入力する (実行条件の欄 → 「@conv.regex.po」→ Tab で候補を確定)", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    const headers = page.locator(".step-card-header");
    await expect(headers.first()).toBeVisible({ timeout: 15000 });
    await headers.first().focus();
    await page.keyboard.press("Enter");
    const input = page.locator('[data-field-path="runIf"]').first().locator("input");
    await expect(input).toBeVisible();
    await startCounting(page);
    await input.click();
    await page.keyboard.type("@conv.regex.po");
    await page.keyboard.press("Tab");
    await expect(input).toHaveValue("@conv.regex.postalCode");
    const n = await ops(page);
    console.log(`OPS reference-input ${n}: ${await log(page)}`);
    expect(n).toBeLessThanOrEqual(budget["reference-input"]);
  });
});
