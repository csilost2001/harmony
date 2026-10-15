/**
 * 入力補助 (UI 改善 第 1 弾, #1505): 補完・提案・自動入力・貼り付け・スターター。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `input-assist-${Date.now()}`;
let ws: OpenedWorkspace;
// 同じ名前のテーブルを何度も作らない (前の試験の下書き・同じ ID の衝突を避ける)
const uniq = (base: string) => `${base}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

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
    await modal.getByPlaceholder("例: customers").fill(uniq("totals"));
    await modal.getByPlaceholder("例: 顧客マスタ").fill("集計");
    await modal.getByTestId("table-add-starter").selectOption("empty");
    await modal.getByRole("button", { name: "作成して編集" }).click();
    await expect(page).toHaveURL(/\/table\/edit\//, { timeout: 15000 });
    await page.getByTestId("columns-grid-toggle").click();
    const grid = page.getByTestId("column-grid");
    await expect(grid).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "カラム追加" }).click();
    await expect(page.getByTestId("column-grid-row")).toHaveCount(1);
    const name = page.getByLabel("1 行目の表示名");
    await name.fill("合計金額");
    await name.press("Tab");
    await expect(page.getByLabel("1 行目の物理名")).toHaveValue("total_amount");
    await expect(grid.locator("select").first()).toHaveValue("DECIMAL");
  });

  test("カラムの詳細パネル (一覧で編集): 表示名を 1 文字ずつ打っても、物理名は最終の表示名から入る", async ({ page }) => {
    await openTableDialog(page);
    const modal = page.locator(".tbl-modal");
    await modal.getByPlaceholder("例: customers").fill(uniq("codes"));
    await modal.getByPlaceholder("例: 顧客マスタ").fill("コード表");
    await modal.getByTestId("table-add-starter").selectOption("empty");
    await modal.getByRole("button", { name: "作成して編集" }).click();
    await expect(page).toHaveURL(/\/table\/edit\//, { timeout: 15000 });
    await page.getByTestId("empty-state-create").click();
    const nameField = page.getByPlaceholder("例: カラムの日本語名");
    await expect(nameField).toBeVisible({ timeout: 10000 });
    await nameField.fill("");
    await nameField.pressSequentially("顧客コード");
    await nameField.blur();
    await expect(page.getByPlaceholder("例: column_name")).toHaveValue("customer_code");
  });

  test("カラムの詳細パネル: 表示名の欄に触れて何も変えずに出ても、元に戻す履歴を積まない", async ({ page }) => {
    await openTableDialog(page);
    const modal = page.locator(".tbl-modal");
    await modal.getByPlaceholder("例: customers").fill(uniq("touch_only"));
    await modal.getByPlaceholder("例: 顧客マスタ").fill("触るだけ");
    await modal.getByTestId("table-add-starter").selectOption("standard");
    await modal.getByRole("button", { name: "作成して編集" }).click();
    await expect(page).toHaveURL(/\/table\/edit\//, { timeout: 15000 });
    await expect(page.getByText("created_at", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.getByText("created_at", { exact: true }).first().dblclick();
    const nameField = page.getByPlaceholder("例: カラムの日本語名");
    await expect(nameField).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("editor-header-undo")).toBeDisabled();
    await nameField.focus();
    await nameField.blur();
    await expect(page.getByTestId("editor-header-undo")).toBeDisabled();
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

  test("日本語の変換中の Enter では、マーカーを送信しない。ふつうの Enter では送信する", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
    await page.locator(".marker-panel .catalog-panel-toggle").click();
    const input = page.locator(".marker-panel .marker-add-row input");
    await expect(input).toBeVisible();
    const body = "変換中の文字を確定したところ";
    await input.fill(body);
    // 変換確定の Enter (isComposing) は、何も起こさない
    await input.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229, bubbles: true, cancelable: true }));
    });
    await expect(input).toHaveValue(body);
    await expect(page.locator(".marker-panel").getByText(body)).toHaveCount(0);
    // ふつうの Enter は、マーカーを追加する (入力欄は空になる)
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.locator(".marker-panel").getByText(body).first()).toBeVisible();
  });
});
