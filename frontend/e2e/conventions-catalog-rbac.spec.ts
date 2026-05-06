/**
 * 役割・権限タブ (role / permission) E2E (#555)
 *
 * - role タブで permissions / inherits の入力ができ、循環参照・存在しないキー参照が
 *   validator 経由で警告として可視化されること
 * - permission タブで resource / action / scope を入力・編集できること
 */
import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1, name: "conventions-rbac", screens: [], groups: [], edges: [],
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

test.describe("役割・権限タブ (#555)", () => {
  test("役割・権限 section header が見える", async ({ page }) => {
    await setup(page);
    await expect(page.locator(".conventions-tab-group-label", { hasText: "役割・権限" })).toBeVisible();
  });

  test("permission タブで新規エントリ追加 + resource/action/scope 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "権限" }).click();
    await page.locator(".conventions-new-key-input").fill("order.create");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "order.create" })).toBeVisible();

    await page.locator('.conventions-table input[placeholder="Order"]').first().fill("Order");
    await page.locator('.conventions-table input[placeholder="create"]').first().fill("create");
    await page.locator(".conventions-table select").first().selectOption("own");
    await expect(page.locator(".conventions-table select").first()).toHaveValue("own");
  });

  test("role タブで新規エントリ追加 + name/permissions 入力", async ({ page }) => {
    await setup(page);
    // permission を先に追加 (参照される側)
    await page.locator(".conventions-category-tab", { hasText: "権限" }).click();
    await page.locator(".conventions-new-key-input").fill("order.read");
    await page.locator(".conventions-entries button:has-text('追加')").click();

    // role タブに切替
    await page.locator(".conventions-category-tab", { hasText: "役割" }).click();
    await page.locator(".conventions-new-key-input").fill("customer");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "customer" })).toBeVisible();

    await page.locator('.conventions-table input[placeholder="顧客"]').first().fill("顧客");
    const permsInput = page.locator('.conventions-table input[placeholder="order.create, order.read"]').first();
    await permsInput.fill("order.read");
    await expect(permsInput).toHaveValue("order.read");
    // onChange → updateSilent → integrityIssues 再計算が live で走るため blur 不要。
    // 既存 permission を参照しているので警告は出ない。
    await expect(page.locator(".conventions-issue")).toHaveCount(0);
  });

  test("role.permissions に存在しない permission を入れると警告が出る", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "役割" }).click();
    await page.locator(".conventions-new-key-input").fill("admin");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    const permsInput = page.locator('.conventions-table input[placeholder="order.create, order.read"]').first();
    await permsInput.fill("does.not.exist");
    await permsInput.blur();
    await expect(page.locator(".conventions-issue")).toContainText("does.not.exist");
  });

  test("role.inherits の循環参照は ROLE_INHERITS_CYCLE 警告として表示される", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "役割" }).click();

    // role A
    await page.locator(".conventions-new-key-input").fill("A");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    // role B
    await page.locator(".conventions-new-key-input").fill("B");
    await page.locator(".conventions-entries button:has-text('追加')").click();

    // A.inherits = [B], B.inherits = [A] で循環
    const inhInputs = page.locator('.conventions-table input[placeholder="customer"]');
    await inhInputs.nth(0).fill("B");
    await inhInputs.nth(0).blur();
    await inhInputs.nth(1).fill("A");
    await inhInputs.nth(1).blur();

    await expect(page.locator(".conventions-issue")).toContainText("循環参照");
  });

  test("重複キーの追加はボタン disabled (role)", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "役割" }).click();
    await page.locator(".conventions-new-key-input").fill("dup");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await page.locator(".conventions-new-key-input").fill("dup");
    await expect(page.locator(".conventions-entries button:has-text('追加')")).toBeDisabled();
  });

  test("削除ボタンでエントリが消える (permission)", async ({ page }) => {
    await setup(page);
    await page.locator(".conventions-category-tab", { hasText: "権限" }).click();
    await page.locator(".conventions-new-key-input").fill("willDelete");
    await page.locator(".conventions-entries button:has-text('追加')").click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toBeVisible();
    const row = page.locator(".conventions-table tr").filter({
      has: page.locator(".conventions-key-badge", { hasText: "willDelete" }),
    });
    await row.locator('button[aria-label="削除"]').click();
    await expect(page.locator(".conventions-key-badge", { hasText: "willDelete" })).toHaveCount(0);
  });
});
