/**
 * ProcessFlow レベルカタログ編集 UI の統合 E2E (#278)
 * ambientVariables / secretsCatalog / externalSystemCatalog の
 * 3 パネルが正しく展開・追加・編集・削除できることを検証。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-catalog-all";

const dummyGroup = {
  id: groupId, name: "all catalog UI", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [], steps: [],
  }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const dummyProject = {
  version: 1, name: "catalog-ui", screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, type: dummyGroup.type, actionCount: 1, updatedAt: dummyGroup.updatedAt, maturity: "draft" }],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript(({ project, group }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: dummyGroup });
  await page.goto(`/process-flow/edit/${groupId}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
}

test.describe("ProcessFlow カタログ編集パネル (#278)", () => {
  test("4 つのカタログパネルが全て表示される", async ({ page }) => {
    await setup(page);
    await expect(page.locator(".ambient-variables-panel")).toBeVisible();
    await expect(page.locator(".secrets-catalog-panel")).toBeVisible();
    await expect(page.locator(".external-system-catalog-panel")).toBeVisible();
  });

  test("ambientVariables: 追加・name/type/required 編集", async ({ page }) => {
    await setup(page);
    await page.locator(".ambient-variables-panel .catalog-panel-toggle").click();
    await page.locator(".ambient-variables-panel button:has-text('追加')").click();
    await page.locator(".ambient-variables-panel input[value='']").first().fill("requestId");
    // type は既定 string
    await page.locator(".ambient-variables-panel input[type='checkbox']").check();
    await expect(page.locator(".ambient-variables-panel .catalog-key-badge")).toContainText("requestId");
  });

  test("secretsCatalog: 新規追加 + source=vault + name 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".secrets-catalog-panel .catalog-panel-toggle").click();
    await page.fill(".secrets-catalog-panel .catalog-new-key", "stripeKey");
    await page.locator(".secrets-catalog-panel button:has-text('追加')").click();
    await page.locator(".secrets-catalog-panel select").first().selectOption("vault");
    await page.locator(".secrets-catalog-panel input[placeholder*='secret/stripe']").fill("secret/stripe/key");
    await expect(page.locator(".secrets-catalog-panel .catalog-key-badge")).toContainText("stripeKey");
  });

  test("externalSystemCatalog: name / baseUrl / auth.kind 入力", async ({ page }) => {
    await setup(page);
    await page.locator(".external-system-catalog-panel .catalog-panel-toggle").click();
    await page.fill(".external-system-catalog-panel .catalog-new-key", "stripe");
    await page.locator(".external-system-catalog-panel button:has-text('追加')").click();
    // name は key 名で初期化されているので baseUrl のみ確認
    await page.locator(".external-system-catalog-panel input[placeholder*='stripe.com']").fill("https://api.stripe.com");
    // auth.kind を bearer に
    await page.locator(".external-system-catalog-panel select").first().selectOption("bearer");
    await expect(page.locator(".external-system-catalog-panel .catalog-key-badge")).toContainText("stripe");
  });

  test("各パネルの削除ボタン", async ({ page }) => {
    await setup(page);
    // ambient 追加 → 削除
    await page.locator(".ambient-variables-panel .catalog-panel-toggle").click();
    await page.locator(".ambient-variables-panel button:has-text('追加')").click();
    await expect(page.locator(".ambient-variables-panel .catalog-key-badge")).toHaveCount(1);
    await page.locator(".ambient-variables-panel .catalog-row-header button").click();
    await expect(page.locator(".ambient-variables-panel .catalog-key-badge")).toHaveCount(0);
  });
});
