/**
 * 入力補助 (UI 改善 第 1 弾, #1505): 補完・提案・自動入力・貼り付け・スターター。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `input-assist-${Date.now()}`;
let ws: OpenedWorkspace;

async function openTableDialog(page: Page) {
  await ws.gotoActive(page, "/table/list");
  await expect(page.locator(".table-list-page")).toBeVisible();
  const addBtn = page.getByRole("button", { name: /テーブル追加/ }).first();
  await expect(addBtn).toBeVisible({ timeout: 10000 });
  await addBtn.click();
  await expect(page.locator(".tbl-modal")).toBeVisible();
}

test.describe("入力補助", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("テーブルの新規作成: 表示名から物理名と ID を自動で入れ、スターターで最初のカラムを入れる", async ({ page }) => {
    await openTableDialog(page);
    const modal = page.locator(".tbl-modal");
    await modal.getByPlaceholder("例: 顧客マスタ").fill("顧客名");
    await expect(modal.getByPlaceholder("例: customers")).toHaveValue("customer_name");
    await expect(modal.getByTestId("entity-id-input")).toHaveValue("customer-name");
    // 物理名を自分で直したら、以後は表示名で上書きしない
    await modal.getByPlaceholder("例: customers").fill("cust");
    await modal.getByPlaceholder("例: 顧客マスタ").fill("顧客名マスタ");
    await expect(modal.getByPlaceholder("例: customers")).toHaveValue("cust");
    await modal.getByTestId("table-add-starter").selectOption("standard");
    await modal.getByRole("button", { name: "作成して編集" }).click();
    await expect(page).toHaveURL(/\/table\/edit\//, { timeout: 15000 });
    for (const name of ["id", "created_at", "updated_at"]) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("カラムの表で編集: 表示名を入れると、物理名と型が自動で入る。Ctrl+Z で戻せる", async ({ page }) => {
    await openTableDialog(page);
    const modal = page.locator(".tbl-modal");
    await modal.getByPlaceholder("例: customers").fill("totals");
    await modal.getByPlaceholder("例: 顧客マスタ").fill("集計");
    await modal.getByTestId("table-add-starter").selectOption("empty");
    await modal.getByRole("button", { name: "作成して編集" }).click();
    await expect(page).toHaveURL(/\/table\/edit\//, { timeout: 15000 });
    await page.getByTestId("columns-grid-toggle").click();
    await page.getByTestId("empty-state-create").click().catch(() => undefined);
    const grid = page.getByTestId("column-grid");
    await expect(grid).toBeVisible({ timeout: 10000 });
    if ((await page.getByTestId("column-grid-row").count()) === 0) await page.getByRole("button", { name: /カラム|追加/ }).first().click();
    const name = page.getByLabel("1 行目の表示名");
    await name.fill("合計金額");
    await name.press("Tab");
    await expect(page.getByLabel("1 行目の物理名")).toHaveValue("total_amount");
    await expect(grid.locator("select").first()).toHaveValue("DECIMAL");
  });

  test("画面項目: テーブルから項目を作る・ラベルから ID と型を埋める・エラーメッセージの下書き", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await expect(page.getByTestId("items-from-table-open")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("edit-mode-start").click();
    await page.getByTestId("items-from-table-open").click();
    const dlg = page.getByTestId("items-from-table-dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByTestId("items-from-table-search").fill("cart");
    const pick = dlg.locator('[data-testid^="items-from-table-pick-"]').first();
    await pick.click();
    await expect(dlg.getByTestId("items-from-table-preview")).toBeVisible();
    const before = await page.locator(".screen-items-table tbody tr").count();
    await dlg.getByTestId("items-from-table-apply").click();
    await expect.poll(async () => page.locator(".screen-items-table tbody tr").count()).toBeGreaterThan(before);

    // ラベルから ID・型
    await page.getByRole("button", { name: /項目追加/ }).click();
    const rows = page.locator(".screen-items-table tbody tr");
    const last = rows.last();
    await last.getByLabel(/のラベル/).fill("合計金額");
    await last.getByLabel(/のラベル/).press("Tab");
    await expect(last.getByLabel(/の項目 ID/)).toHaveValue("totalAmount");

    // エラーメッセージの下書き (必須にしてから)
    await page.getByTestId("items-draft-messages").click();
    await expect(page.getByText(/エラーメッセージの下書きを|下書きを入れられる/).first()).toBeVisible();
  });

  test("参照の入力欄: 部分一致の候補・Ctrl+Space・F12 で定義へ移動", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await page.getByTestId("edit-mode-start").click();
    // 画面項目の「エラーメッセージ」欄は @conv 補完つき
    await page.getByRole("button", { name: /エラーメッセージ|chat-text/ }).first().click().catch(() => undefined);
    const box = page.locator(".screen-items-error-field input").first();
    await expect(box).toBeVisible({ timeout: 10000 });
    await box.fill("@conv.");
    await expect(page.getByRole("listbox").first()).toBeVisible();
    await box.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await box.press("Control+Space");
    await expect(page.getByRole("listbox").first()).toBeVisible();
    await box.press("Escape");
    // F12 で規約カタログへ
    await box.fill("@conv.msg.required");
    await box.press("F12");
    await expect(page).toHaveURL(/\/conventions\/catalog/, { timeout: 10000 });
  });

  test("日本語の変換中の Enter では、マーカーを送信しない", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.locator(".process-flow-editor, [class*='process-flow-editor']")).toBeVisible({ timeout: 15000 });
    const open = page.getByTestId("marker-panel-toggle");
    if (await open.count()) await open.click();
    const input = page.locator('[data-testid="marker-input"], .marker-panel input[type="text"]').first();
    test.skip((await input.count()) === 0, "マーカー欄が見つからない画面構成");
    await input.fill("変換中の文字");
    const sent = await input.evaluate((el) => {
      const ev = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(sent).toBe(false); // 変換確定の Enter は、何も起こさない (送信しようとして preventDefault もしない)
    await expect(input).toHaveValue("変換中の文字");
  });
});
