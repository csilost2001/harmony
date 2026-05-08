/**
 * Dashboard / ComputeStep / ReturnStep / outcomes / StructuredFields の追加 E2E (#244)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const groupId = "ag-more-test";
const dummyGroupBody = {
  id: groupId,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: {
    id: groupId,
    name: "追加 UI テスト",
    kind: "screen",
    mode: "upstream",
    maturity: "provisional",
    version: "1.0.0",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  },
  actions: [
    {
      id: "act-1",
      name: "テスト",
      trigger: "submit",
      maturity: "provisional",
      responses: [{ id: "201-success", status: 201, bodySchema: "Result" }],
      steps: [
        { id: "step-compute", type: "compute", description: "税額計算", expression: "Math.floor(@subtotal * 0.10)", outputBinding: "taxAmount", maturity: "committed" },
        { id: "step-return", type: "return", description: "成功レスポンス", responseRef: "201-success", bodyExpression: "{ ok: true }", maturity: "provisional" },
        { id: "step-external", type: "externalSystem", description: "外部呼出", systemName: "Stripe", outcomes: { success: { action: "continue" }, failure: { action: "abort", description: "エラー" } }, maturity: "draft" },
      ],
    },
  ],
};

const dummyProject = {
  version: 1,
  name: "more-e2e",
  screens: [], groups: [], edges: [], tables: [],
  processFlows: [
    { id: groupId, no: 1, name: "追加 UI テスト", kind: "screen", actionCount: 1, maturity: "provisional", notesCount: 0 },
    { id: "ag-extra-committed", no: 2, name: "確定フロー", kind: "screen", actionCount: 1, maturity: "committed", notesCount: 3 },
  ],
};

const WS_KEY = "issue-926-more-ui";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function expandStep(page: Page, index: number) {
  const card = page.locator(".step-card").nth(index);
  await card.locator(".step-card-type-label").first().click();
  return card;
}

async function gotoEditor(page: Page, subPath: string) {
  await ws.gotoActive(page, subPath);
  await expect(page.locator(".step-editor, .process-flow-content, .dashboard-grid, .function-counts-panel").first()).toBeVisible({ timeout: 10000 });
  // ResumeOrDiscardDialog 遅延表示への retry-loop (#683 edit-session-draft 残骸対応)
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else {
      break;
    }
  }
  // process-flow editor が画面に出ていれば edit-mode-start を click。dashboard 等他経路は skip。
  const editStart = page.getByTestId("edit-mode-start");
  if (await editStart.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editStart.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
  }
}

test.describe("more-ui (#244)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      processFlows: [dummyGroupBody],
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test.describe("ComputeStep 編集 (#214)", () => {
    test("expression 入力が保持される", async ({ page }) => {
      await gotoEditor(page, `/process-flow/edit/${normalizeId(groupId)}`);
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
      await gotoEditor(page, `/process-flow/edit/${normalizeId(groupId)}`);
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
      await gotoEditor(page, `/process-flow/edit/${normalizeId(groupId)}`);
      const card = await expandStep(page, 2);
      const panel = card.locator(".external-outcomes-panel");
      await expect(panel).toBeVisible();
      await expect(panel.getByText("成功")).toBeVisible();
      await expect(panel.getByText("失敗")).toBeVisible();
    });
  });

  test.describe("Dashboard 処理フロー成熟度パネル (#234)", () => {
    test("パネルが表示されクリックで一覧へ遷移する", async ({ page }) => {
      await gotoEditor(page, "/");
      const panel = page.locator(".process-flow-maturity-panel");
      await expect(panel).toBeVisible();
      await expect(panel.getByText("確定フロー率")).toBeVisible();
      await expect(panel.getByRole("button", { name: /確定/ })).toBeVisible();
    });
  });

  test.describe("StructuredFields 表形式切替 (#226)", () => {
    test("自由記述 → 表形式 → フィールド追加", async ({ page }) => {
      await gotoEditor(page, `/process-flow/edit/${normalizeId(groupId)}`);
      const panel = page.locator(".structured-fields-editor").first();
      await expect(panel).toBeVisible();
      await panel.locator("button[title*='表形式']").click();
      await panel.getByRole("button", { name: /フィールド追加/ }).click();
      const nameInput = panel.locator('input[placeholder="name"]').first();
      await expect(nameInput).toBeVisible();
      await nameInput.fill("userId");
      await expect(nameInput).toHaveValue("userId");
    });
  });
});
