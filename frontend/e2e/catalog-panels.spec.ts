/**
 * ProcessFlow レベルカタログ編集 UI の統合 E2E (#278)
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

const groupId = "ag-catalog-all";
const baseTs = "2026-05-08T00:00:00.000Z";
const dummyGroupBody = {
  id: groupId,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: groupId, name: "all catalog UI", kind: "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: baseTs, updatedAt: baseTs },
  actions: [{ id: "act-1", name: "ボタン", trigger: "click", maturity: "draft", responses: [], steps: [] }],
};
const dummyProject = {
  version: 1, name: "catalog-ui",
  screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: "all catalog UI", kind: "screen", actionCount: 1, maturity: "draft" }],
};

const WS_KEY = "issue-926-catalog-panels";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
}

test.describe("ProcessFlow カタログ編集パネル (#278)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      processFlows: [dummyGroupBody],
    });
  });

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
    await page.locator(".external-system-catalog-panel input[placeholder*='stripe.com']").fill("https://api.stripe.com");
    await page.locator(".external-system-catalog-panel select").first().selectOption("bearer");
    await expect(page.locator(".external-system-catalog-panel .catalog-key-badge")).toContainText("stripe");
  });

  test("各パネルの削除ボタン", async ({ page }) => {
    await setup(page);
    await page.locator(".ambient-variables-panel .catalog-panel-toggle").click();
    await page.locator(".ambient-variables-panel button:has-text('追加')").click();
    await expect(page.locator(".ambient-variables-panel .catalog-key-badge")).toHaveCount(1);
    await page.locator(".ambient-variables-panel .catalog-row-header button").click();
    await expect(page.locator(".ambient-variables-panel .catalog-key-badge")).toHaveCount(0);
  });
});
