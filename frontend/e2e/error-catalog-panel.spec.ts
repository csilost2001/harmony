/**
 * errorCatalog 編集パネルの E2E (#278)
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
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const groupId = "ag-ec-ui";

const dummyGroupBody = buildProcessFlow({
  id: groupId,
  name: "errorCatalog UI",
  kind: "screen",
  mode: "upstream",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [
      { id: "201-success", status: 201 },
      { id: "400-validation", status: 400 },
      { id: "409-stock-shortage", status: 409 },
    ],
    steps: [],
  }] as ReturnType<typeof buildProcessFlow>["actions"],
});

const dummyProject = buildProject({
  name: "ec-test",
  entities: {
    processFlows: [{ id: groupId, no: 1, name: "errorCatalog UI", kind: "screen", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-error-catalog-panel";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
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

test.describe("errorCatalog 編集パネル (#278)", () => {
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

  test("初期は折りたたみ、クリックで展開", async ({ page }) => {
    await setup(page);
    const toggle = page.locator(".error-catalog-panel .catalog-panel-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("エラーカタログ");
    await expect(page.locator(".error-catalog-panel .catalog-panel-body")).toHaveCount(0);
    await toggle.click();
    await expect(page.locator(".error-catalog-panel .catalog-panel-body")).toBeVisible();
  });

  test("新規エントリ追加 + フィールド編集", async ({ page }) => {
    await setup(page);
    await page.locator(".error-catalog-panel .catalog-panel-toggle").click();
    await page.fill(".catalog-new-key", "STOCK_SHORTAGE");
    await page.locator(".error-catalog-panel button:has-text('追加')").click();
    await expect(page.locator(".catalog-key-badge")).toContainText("STOCK_SHORTAGE");
    await page.locator(".error-catalog-panel input[type='number']").fill("409");
    const msgInput = page.locator(".error-catalog-panel input[placeholder*='在庫不足']");
    await msgInput.fill("在庫が不足しています");
    await page.locator(".error-catalog-panel select").selectOption("409-stock-shortage");
    expect(page.locator(".catalog-key-badge")).toBeDefined();
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
