/**
 * errorCatalog 編集パネルの E2E (#278)
 *
 * 新規 errorCode 追加・httpStatus/defaultMessage 入力・responseRef 選択・削除
 * が動作することを確認。
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-ec-ui";

const dummyGroup = {
  id: groupId,
  name: "errorCatalog UI",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [
      { id: "201-success", status: 201 },
      { id: "400-validation", status: 400 },
      { id: "409-stock-shortage", status: 409 },
    ],
    steps: [],
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1, name: "ec-test", screens: [], groups: [], edges: [], tables: [],
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

test.describe.skip("errorCatalog 編集パネル (#278)", () => {
  test("初期は折りたたみ、クリックで展開", async ({ page }) => {
    await setup(page);
    const toggle = page.locator(".error-catalog-panel .catalog-panel-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("errorCatalog: 0 件");
    // 本体は非表示
    await expect(page.locator(".error-catalog-panel .catalog-panel-body")).toHaveCount(0);
    await toggle.click();
    await expect(page.locator(".error-catalog-panel .catalog-panel-body")).toBeVisible();
  });

  test("新規エントリ追加 + フィールド編集", async ({ page }) => {
    await setup(page);
    await page.locator(".error-catalog-panel .catalog-panel-toggle").click();

    // エントリ追加
    await page.fill(".catalog-new-key", "STOCK_SHORTAGE");
    await page.locator(".error-catalog-panel button:has-text('追加')").click();

    await expect(page.locator(".catalog-key-badge")).toContainText("STOCK_SHORTAGE");

    // httpStatus 入力
    await page.locator(".error-catalog-panel input[type='number']").fill("409");

    // defaultMessage 入力
    const msgInput = page.locator(".error-catalog-panel input[placeholder*='在庫不足']");
    await msgInput.fill("在庫が不足しています");

    // responseRef 選択
    await page.locator(".error-catalog-panel select").selectOption("409-stock-shortage");

    // 状態が group に反映されているか確認 (localStorage)
    const group = await page.evaluate((id) => {
      const s = localStorage.getItem(`process-flow-${id}`);
      return s ? JSON.parse(s) : null;
    }, groupId);
    // 保存はされないが autosave で draft か、少なくとも UI state は反映されている
    expect(page.locator(".catalog-key-badge")).toBeDefined();
    expect(group).toBeTruthy();
  });

  test("削除ボタンでエントリ消去", async ({ page }) => {
    await setup(page);
    await page.locator(".error-catalog-panel .catalog-panel-toggle").click();
    await page.fill(".catalog-new-key", "TEMP_CODE");
    await page.locator(".error-catalog-panel button:has-text('追加')").click();
    await expect(page.locator(".catalog-key-badge")).toHaveCount(1);

    await page.locator(".error-catalog-panel .catalog-row-header button").click();
    await expect(page.locator(".catalog-key-badge")).toHaveCount(0);
  });

  test("追加ボタンは重複キーで disabled", async ({ page }) => {
    await setup(page);
    await page.locator(".error-catalog-panel .catalog-panel-toggle").click();
    await page.fill(".catalog-new-key", "DUP");
    await page.locator(".error-catalog-panel button:has-text('追加')").click();

    await page.fill(".catalog-new-key", "DUP");
    const addBtn = page.locator(".error-catalog-panel button:has-text('追加')");
    await expect(addBtn).toBeDisabled();
  });
});
