/**
 * プロダクト規約カテゴリの E2E (#347)
 *
 * scope / currency / tax / auth / db / numbering / tx / externalOutcomeDefaults
 * の各タブで add / edit / delete が動作することを検証。
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1, name: "conventions-product", screens: [], groups: [], edges: [],
  tables: [], processFlows: [],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript(({ project }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("conventions-catalog");
    localStorage.removeItem("draft-conventions-catalog-main");
  }, { project: dummyProject });
  await page.goto("/conventions/catalog");
  await expect(page.locator(".conventions-catalog-view")).toBeVisible({ timeout: 10000 });
}

test.describe.skip("プロダクト規約タブ (#347)", () => {
  test("プロダクト規約 section header が見える", async ({ page }) => {
    await setup(page);
    await expect(page.locator(".conventions-tab-group-label", { hasText: "プロダクト規約" })).toBeVisible();
  });

  test("scope タブで新規エントリ追加 + value 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "スコープ" }).click();
    await page.locator(".conventions-new-key-input").fill("customerRegion");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "customerRegion" })).toBeVisible();
    const valueInput = page.locator('.conventions-table input[placeholder="domestic"]').first();
    await valueInput.fill("domestic");
    await expect(valueInput).toHaveValue("domestic");
  });

  test("currency タブで新規エントリ追加 + code 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "通貨" }).click();
    await page.locator(".conventions-new-key-input").fill("jpy");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "jpy" })).toBeVisible();
    const codeInput = page.locator('.conventions-table input[placeholder="JPY"]').first();
    await codeInput.fill("JPY");
    await expect(codeInput).toHaveValue("JPY");
  });

  test("currency タブで roundingMode select が動作する", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "通貨" }).click();
    await page.locator(".conventions-new-key-input").fill("jpy");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    const rmSelect = page.locator(".conventions-table select").first();
    await rmSelect.selectOption("floor");
    await expect(rmSelect).toHaveValue("floor");
  });

  test("tax タブで新規エントリ追加 + kind/rate 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "税" }).click();
    await page.locator(".conventions-new-key-input").fill("standard");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "standard" })).toBeVisible();
    const kindSelect = page.locator(".conventions-table select").first();
    await expect(kindSelect).toHaveValue("exclusive");
    const rateInput = page.locator('.conventions-table input[placeholder="0.10"]').first();
    await rateInput.fill("0.1");
    await expect(rateInput).toHaveValue("0.1");
  });

  test("auth タブで新規エントリ追加 + scheme 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "認証" }).click();
    await page.locator(".conventions-new-key-input").fill("default");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "default" })).toBeVisible();
    const schemeInput = page.locator('.conventions-table input[placeholder="session-cookie"]').first();
    await schemeInput.fill("session-cookie");
    await expect(schemeInput).toHaveValue("session-cookie");
  });

  test("db タブで新規エントリ追加 + engine 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "DB" }).click();
    await page.locator(".conventions-new-key-input").fill("default");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "default" })).toBeVisible();
    const engineInput = page.locator('.conventions-table input[placeholder="postgresql@14"]').first();
    await engineInput.fill("postgresql@14");
    await expect(engineInput).toHaveValue("postgresql@14");
  });

  test("numbering タブで新規エントリ追加 + format 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "採番" }).click();
    await page.locator(".conventions-new-key-input").fill("customerCode");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "customerCode" })).toBeVisible();
    const formatInput = page.locator('.conventions-table input[placeholder="C-NNNN"]').first();
    await formatInput.fill("C-NNNN");
    await expect(formatInput).toHaveValue("C-NNNN");
  });

  test("tx タブで新規エントリ追加 + policy textarea 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "TX" }).click();
    await page.locator(".conventions-new-key-input").fill("singleOperation");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "singleOperation" })).toBeVisible();
    const policyTextarea = page.locator(".conventions-table-textarea").first();
    await policyTextarea.fill("単一操作は 1 TX");
    await expect(policyTextarea).toHaveValue("単一操作は 1 TX");
  });

  test("外部連携既定タブで新規エントリ追加 + outcome/action select", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "外部連携既定" }).click();
    await page.locator(".conventions-new-key-input").fill("failure");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "failure" })).toBeVisible();
    const selects = page.locator(".conventions-table select");
    await expect(selects.nth(0)).toHaveValue("failure");
    await expect(selects.nth(1)).toHaveValue("abort");
  });

  test("プロダクト規約タブで重複キーの追加はボタン disabled", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "通貨" }).click();
    await page.locator(".conventions-new-key-input").fill("jpy");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await page.locator(".conventions-new-key-input").fill("jpy");
    await expect(page.locator(".conventions-entries button:has-text('追加')")).toBeDisabled();
  });

  test("プロダクト規約タブで削除ボタンでエントリが消える", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "スコープ" }).click();
    await page.locator(".conventions-new-key-input").fill("willDelete");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toBeVisible();
    const row = page.locator(".conventions-table tr").filter({
      has: page.locator(".conventions-key-badge", { hasText: "willDelete" }),
    });
    await row.locator('button[aria-label="削除"]').click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toHaveCount(0);
  });

  test("scope エントリを保存してリロード後も値が残る", async ({ page }) => {
    // conventions-catalog を消さずに setup — リロード後に localStorage から復元できることを検証
    await page.addInitScript(({ project }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
      localStorage.removeItem("conventions-catalog");
      localStorage.removeItem("draft-conventions-catalog-main");
    }, { project: dummyProject });
    await page.goto("/conventions/catalog");
    await expect(page.locator(".conventions-catalog-view")).toBeVisible({ timeout: 10000 });

    await page.locator(".conventions-category-tab", { hasText: "スコープ" }).click();
    await page.locator(".conventions-new-key-input").fill("persistTest");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "persistTest" })).toBeVisible();
    const valueInput = page.locator('.conventions-table input[placeholder="domestic"]').first();
    await valueInput.fill("overseas");
    await expect(valueInput).toHaveValue("overseas");

    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).not.toHaveClass(/dirty/, { timeout: 5000 });

    // リロード
    await page.reload();
    await expect(page.locator(".conventions-catalog-view")).toBeVisible({ timeout: 10000 });

    // スコープタブを開いてエントリが残っていることを確認
    await page.locator(".conventions-category-tab", { hasText: "スコープ" }).click();
    await expect(page.locator(".conventions-key-badge", { hasText: "persistTest" })).toBeVisible();
    await expect(page.locator('.conventions-table input[placeholder="domestic"]').first()).toHaveValue("overseas");
  });
});
