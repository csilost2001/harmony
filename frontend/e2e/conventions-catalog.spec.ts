/**
 * 規約カタログ編集ビュー (#317) の基本 E2E
 *
 * - /conventions/catalog を開けること
 * - msg / regex / limit の 3 カテゴリタブがあること
 * - 各カテゴリで新規エントリ追加 → 入力欄更新ができること
 */
import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1, name: "conventions-ui", screens: [], groups: [], edges: [],
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

test.describe("規約カタログ編集ビュー (#317)", () => {
  test("13 カテゴリタブが 3 グループで見える (#555)", async ({ page }) => {
    await setup(page);
    const tabs = page.locator(".conventions-category-tab");
    await expect(tabs).toHaveCount(13);
    await expect(tabs.nth(0)).toContainText("メッセージ");
    await expect(tabs.nth(1)).toContainText("正規表現");
    await expect(tabs.nth(2)).toContainText("制限値");
    await expect(tabs.nth(3)).toContainText("役割");
    await expect(tabs.nth(4)).toContainText("権限");
    const groupLabels = page.locator(".conventions-tab-group-label");
    await expect(groupLabels.nth(0)).toContainText("入力バリデーション");
    await expect(groupLabels.nth(1)).toContainText("役割・権限");
    await expect(groupLabels.nth(2)).toContainText("プロダクト規約");
  });

  test("regex タブで新規エントリ追加 + pattern 入力", async ({ page }) => {
    await setup(page);
    // regex タブクリック
    await page.locator(".conventions-category-tab", { hasText: "正規表現" }).click();
    // 新規 key 入力 → 追加
    const newKeyInput = page.locator(".conventions-new-key-input");
    await newKeyInput.fill("test-regex-pattern");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    // key-badge が出現
    await expect(page.locator(".conventions-key-badge", { hasText: "test-regex-pattern" })).toBeVisible();
    // pattern 入力
    const patternInput = page.locator('.conventions-table input[placeholder="^[A-Za-z0-9]+$"]').first();
    await patternInput.fill("^\\d{4}$");
    await expect(patternInput).toHaveValue("^\\d{4}$");
  });

  test("msg タブで新規エントリ追加 + template 入力", async ({ page }) => {
    await setup(page);
    // 既定で msg タブ
    const newKeyInput = page.locator(".conventions-new-key-input");
    await newKeyInput.fill("testMsg");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "testMsg" })).toBeVisible();
    const templateInput = page.locator('.conventions-table input[placeholder*="必須入力"]').first();
    await templateInput.fill("{label}はテストです");
    await expect(templateInput).toHaveValue("{label}はテストです");
  });

  test("重複キーの追加はボタン disabled", async ({ page }) => {
    await setup(page);
    // limit タブに切替
    await page.locator(".conventions-category-tab", { hasText: "制限値" }).click();
    const newKeyInput = page.locator(".conventions-new-key-input");
    await newKeyInput.fill("dupKey");
    const addBtn = page.locator(".conventions-entries button:has-text('追加')");
    await addBtn.click();
    // 同じキーを再度入力
    await newKeyInput.fill("dupKey");
    await expect(addBtn).toBeDisabled();
  });

  test("削除ボタンでエントリが消える", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "正規表現" }).click();
    await page.locator(".conventions-new-key-input").fill("willDelete");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toBeVisible();
    // willDelete が含まれる行の削除ボタンを特定
    const row = page.locator(".conventions-table tr").filter({ has: page.locator(".conventions-key-badge", { hasText: "willDelete" }) });
    await row.locator('button[aria-label="削除"]').click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toHaveCount(0);
  });
});
