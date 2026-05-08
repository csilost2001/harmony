/**
 * @conv.* 補完ポップアップ E2E (#349)
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

const sampleCatalog = {
  version: "1.0.0",
  msg: { required: { template: "{label}は必須入力です" } },
  regex: {}, limit: {},
  scope: { customerRegion: { value: "domestic" } },
  currency: { jpy: { code: "JPY", subunit: 0 }, usd: { code: "USD" } },
  tax: { standard: { kind: "exclusive", rate: 0.1 } },
  auth: { default: { scheme: "session-cookie" } },
  db: { default: { engine: "postgresql@14" } },
  numbering: { customerCode: { format: "C-NNNN" } },
  tx: { singleOperation: { policy: "1 TX" } },
  externalOutcomeDefaults: { failure: { outcome: "failure", action: "abort" } },
};

const groupId = "ag-test-completion";
const baseTs = "2026-05-08T00:00:00.000Z";
const sampleGroupBody = {
  id: groupId,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: groupId, name: "補完テスト", kind: "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: baseTs, updatedAt: baseTs },
  actions: [{
    id: "act-001", name: "テストアクション", trigger: "click",
    steps: [{ id: "step-001", type: "compute", description: "", expression: "", outputBinding: null }],
  }],
};

const dummyProject = {
  version: 1, name: "補完 E2E テスト",
  screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: "補完テスト", kind: "screen", actionCount: 1, maturity: "draft" }],
};

const WS_KEY = "issue-926-conv-completion";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".process-flow-editor, [class*='process-flow-editor']")).toBeVisible({ timeout: 10000 });
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
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

async function openComputeStep(page: Page) {
  const stepHeader = page.locator(".step-card-header, [class*='step-header']").first();
  await stepHeader.click();
  await expect(page.locator('[data-field-path="expression"]')).toBeVisible({ timeout: 5000 });
}

test.describe("@conv.* 補完ポップアップ (#349)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      processFlows: [sampleGroupBody],
      conventions: sampleCatalog,
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("@conv. 入力でカテゴリ候補ポップアップが表示される", async ({ page }) => {
    await setup(page);
    await openComputeStep(page);
    const exprInput = page.locator('[data-field-path="expression"] input');
    await exprInput.click();
    await exprInput.fill("@conv.");
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 3000 });
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
    await exprInput.press("Enter");
    await expect(exprInput).toHaveValue("@conv.currency.");
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 3000 });
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
    const first = page.locator('[role="option"][aria-selected="true"]');
    await expect(first).toBeVisible();
    await exprInput.press("ArrowDown");
    const allOptions = page.locator('[role="option"]');
    await expect(allOptions.nth(1)).toHaveAttribute("aria-selected", "true");
  });
});
