/**
 * @conv.* 補完ポップアップ E2E (#349)
 *
 * ProcessFlowEditor の ComputeStep expression 欄で @conv. 入力時に補完候補が
 * 表示され、2 段選択 (category → key) でテキストが挿入されることを検証。
 */
import { test, expect, type Page } from "@playwright/test";

const sampleCatalog = {
  version: "1.0.0",
  msg: { required: { template: "{label}は必須入力です" } },
  regex: {},
  limit: {},
  scope: { customerRegion: { value: "domestic" } },
  currency: { jpy: { code: "JPY", subunit: 0 }, usd: { code: "USD" } },
  tax: { standard: { kind: "exclusive", rate: 0.1 } },
  auth: { default: { scheme: "session-cookie" } },
  db: { default: { engine: "postgresql@14" } },
  numbering: { customerCode: { format: "C-NNNN" } },
  tx: { singleOperation: { policy: "1 TX" } },
  externalOutcomeDefaults: { failure: { outcome: "failure", action: "abort" } },
};

const sampleGroup = {
  id: "ag-test-completion",
  name: "補完テスト",
  type: "screen",
  description: "",
  actions: [{
    id: "act-001",
    name: "テストアクション",
    trigger: "click",
    steps: [{
      id: "step-001",
      type: "compute",
      description: "",
      expression: "",
      outputBinding: null,
    }],
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "補完 E2E テスト",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [{ id: sampleGroup.id, name: sampleGroup.name, type: sampleGroup.type, actionCount: 1, createdAt: sampleGroup.createdAt, updatedAt: sampleGroup.updatedAt }],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript(({ project, group, catalog }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.setItem("conventions-catalog", JSON.stringify(catalog));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: sampleGroup, catalog: sampleCatalog });
  await page.goto(`/process-flow/edit/${sampleGroup.id}`);
  // ProcessFlowEditor が表示されるまで待機
  await expect(page.locator(".process-flow-editor, [class*='process-flow-editor']")).toBeVisible({ timeout: 10000 });
}

async function openComputeStep(page: Page) {
  // ComputeStep のヘッダーをクリックして展開
  const stepHeader = page.locator(".step-card-header, [class*='step-header']").first();
  await stepHeader.click();
  // expression 入力欄が出るのを待つ
  await expect(page.locator('[data-field-path="expression"]')).toBeVisible({ timeout: 5000 });
}

test.describe("@conv.* 補完ポップアップ (#349)", () => {
  test("@conv. 入力でカテゴリ候補ポップアップが表示される", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.");
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 3000 });
    // 11 候補が表示されること
    const items = page.locator('[role="listbox"] [role="option"]');
    await expect(items).toHaveCount(11);
  });

  test("部分入力 @conv.curre で currency のみに絞り込まれる", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.curre");
    const items = page.locator('[role="listbox"] [role="option"]');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("currency");
  });

  test("Enter で category を確定 → @conv.currency. に更新", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.curre");
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    await exprInput.press("Enter");
    await expect(exprInput).toHaveValue("@conv.currency.");
  });

  test("category 確定後に key 候補が表示され、Enter で @conv.currency.* に確定", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.curre");
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    // category を確定
    await exprInput.press("Enter");
    await expect(exprInput).toHaveValue("@conv.currency.");
    // key phase popup が出るのを待つ
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 3000 });
    // 先頭候補 (activeIndex=0) を Enter で確定
    await exprInput.press("Enter");
    const val = await exprInput.inputValue();
    expect(val).toMatch(/^@conv\.currency\.\w+$/);
  });

  test("Esc でポップアップが閉じる", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.");
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    await exprInput.press("Escape");
    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
  });

  test("↓↑ でハイライト移動", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.");
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    // 最初は先頭がハイライト
    const first = page.locator('[role="option"][aria-selected="true"]');
    await expect(first).toBeVisible();
    await exprInput.press("ArrowDown");
    // ハイライトが 2 番目に移動
    const allOptions = page.locator('[role="option"]');
    await expect(allOptions.nth(1)).toHaveAttribute("aria-selected", "true");
  });
});
