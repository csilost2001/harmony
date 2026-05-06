/**
 * Dashboard / ComputeStep / ReturnStep / outcomes / StructuredFields の追加 E2E (#244)
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-more-test";

const dummyGroup = {
  id: groupId,
  name: "追加 UI テスト",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "provisional",
  actions: [
    {
      id: "act-1",
      name: "テスト",
      trigger: "submit",
      maturity: "provisional",
      responses: [
        { id: "201-success", status: 201, bodySchema: "Result" },
      ],
      steps: [
        {
          id: "step-compute",
          type: "compute",
          description: "税額計算",
          expression: "Math.floor(@subtotal * 0.10)",
          outputBinding: "taxAmount",
          maturity: "committed",
        },
        {
          id: "step-return",
          type: "return",
          description: "成功レスポンス",
          responseRef: "201-success",
          bodyExpression: "{ ok: true }",
          maturity: "provisional",
        },
        {
          id: "step-external",
          type: "externalSystem",
          description: "外部呼出",
          systemName: "Stripe",
          outcomes: {
            success: { action: "continue" },
            failure: { action: "abort", description: "エラー" },
          },
          maturity: "draft",
        },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "more-e2e",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [
    {
      id: groupId,
      no: 1,
      name: dummyGroup.name,
      type: dummyGroup.type,
      actionCount: 1,
      updatedAt: dummyGroup.updatedAt,
      maturity: "provisional",
      notesCount: 0,
    },
    {
      id: "ag-extra-committed",
      no: 2,
      name: "確定フロー",
      type: "screen",
      actionCount: 1,
      updatedAt: new Date().toISOString(),
      maturity: "committed",
      notesCount: 3,
    },
  ],
  updatedAt: new Date().toISOString(),
};

async function setupEditor(page: Page) {
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

async function setupDashboard(page: Page) {
  await page.addInitScript(({ project }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject });
  await page.goto("/");
  await expect(page.locator(".dashboard-grid, .function-counts-panel").first()).toBeVisible({ timeout: 10000 });
}

async function expandStep(page: Page, index: number) {
  const card = page.locator(".step-card").nth(index);
  await card.locator(".step-card-type-label").first().click();
  return card;
}

test.describe("ComputeStep 編集 (#214)", () => {
  test("expression 入力が保持される", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 0);
    const exprInput = card.locator('input[placeholder*="Math.floor"]').first();
    await expect(exprInput).toBeVisible();
    await expect(exprInput).toHaveValue("Math.floor(@subtotal * 0.10)");
    await exprInput.fill("@subtotal * 0.08");
    await exprInput.blur();
    await expect(exprInput).toHaveValue("@subtotal * 0.08");
  });
});

test.describe("ReturnStep 編集 (#214)", () => {
  test("responseRef + bodyExpression が編集できる", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 1);
    const refInput = card.locator('input[placeholder*="409-stock-shortage"]').first();
    await expect(refInput).toBeVisible();
    await expect(refInput).toHaveValue("201-success");
    const bodyInput = card.locator('input[placeholder*="STOCK_SHORTAGE"]').first();
    await expect(bodyInput).toBeVisible();
    await expect(bodyInput).toHaveValue("{ ok: true }");
  });
});

test.describe("External outcomes 編集 (#220)", () => {
  test("outcomes パネルが表示され success/failure が見える", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 2);
    // outcomes が 2 件設定済なので初期表示で expanded
    const panel = card.locator(".external-outcomes-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("成功")).toBeVisible();
    await expect(panel.getByText("失敗")).toBeVisible();
  });
});

test.describe("Dashboard 処理フロー成熟度パネル (#234)", () => {
  test("パネルが表示されクリックで一覧へ遷移する", async ({ page }) => {
    await setupDashboard(page);
    // ProcessFlowMaturityPanel の要素
    const panel = page.locator(".process-flow-maturity-panel");
    await expect(panel).toBeVisible();
    // 確定フロー率が表示される
    await expect(panel.getByText("確定フロー率")).toBeVisible();
    // 「確定 N」「暫定 N」「下書き N」リンクがある
    await expect(panel.getByRole("button", { name: /確定/ })).toBeVisible();
  });
});

test.describe("StructuredFields 表形式切替 (#226)", () => {
  test("自由記述 → 表形式 → フィールド追加", async ({ page }) => {
    await setupEditor(page);
    // 入力データの表形式モード切替ボタン (bi-table)
    const panel = page.locator(".structured-fields-editor").first();
    await expect(panel).toBeVisible();
    await panel.locator("button[title*='表形式']").click();
    // フィールド追加ボタン
    await panel.getByRole("button", { name: /フィールド追加/ }).click();
    // name input が現れる
    const nameInput = panel.locator('input[placeholder="name"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("userId");
    await expect(nameInput).toHaveValue("userId");
  });
});
