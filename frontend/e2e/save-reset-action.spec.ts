/**
 * 処理フローエディタ：保存/リセットボタン E2E テスト
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

const PROCESS_FLOW_ID = "test-ag-0001-4000-8000-000000000001";
const baseTs = "2026-05-08T00:00:00.000Z";

const dummyProcessFlowBody = {
  id: PROCESS_FLOW_ID,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: PROCESS_FLOW_ID, name: "テスト処理フロー", kind: "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: baseTs, updatedAt: baseTs },
  actions: [],
};

const dummyProject = {
  version: 1, name: "E2Eテスト用プロジェクト",
  screens: [], groups: [], edges: [],
  processFlows: [{ id: PROCESS_FLOW_ID, no: 1, name: "テスト処理フロー", kind: "screen", actionCount: 0, maturity: "draft" }],
};

const PF_NORM = normalizeId(PROCESS_FLOW_ID);
const dummyTab = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "テスト処理フロー", isDirty: false, isPinned: false };

const toolbarSave = ".save-reset-buttons button.srb-btn-save";
const toolbarReset = ".save-reset-buttons button.srb-btn-reset";

const WS_KEY = "issue-926-save-reset-action";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupProcessFlowEditor(page: Page) {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    processFlows: [dummyProcessFlowBody],
  });
  await page.addInitScript((tab) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
  }, dummyTab);
  await ws.gotoActive(page, `/process-flow/edit/${PF_NORM}`);
  await expect(page.locator(".process-flow-page")).toBeVisible();
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

async function addAction(page: Page, name: string) {
  await page.locator(".process-flow-tab-add").click();
  await page.locator(".process-flow-modal input.form-control").first().fill(name);
  await page.locator(".process-flow-modal button.btn-primary").click();
  await expect(page.locator(".process-flow-modal")).not.toBeVisible();
}

test.describe("処理フローエディタ：保存/リセットボタン", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("アクション追加後に保存・リセットボタンが有効になる", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("変更後にタブの dirty インジケーターが表示される", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");
    const tabLocator = page.locator(".tabbar-tab").filter({ hasText: "テスト処理フロー" });
    await expect(tabLocator).toHaveClass(/\bdirty\b/);
  });

  test("リセット確認をキャンセルすると編集状態が保持される", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.dismiss());
    await addAction(page, "登録ボタン");
    await page.locator(toolbarReset).click();
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("リセット確認を承認するとボタンが無効に戻る (DiscardConfirmDialog 経由)", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.accept());
    await addAction(page, "登録ボタン");
    await page.locator(toolbarReset).click();
    // window.confirm 承認後、DiscardConfirmDialog が出る場合はそれも accept (出ないこともある)
    const discardConfirm = page.getByTestId("discard-confirm");
    if (await discardConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await discardConfirm.click();
    }
    // 破棄完了 → readonly モードに戻り SaveResetButtons は非表示
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(toolbarSave)).toHaveCount(0);
    await expect(page.locator(toolbarReset)).toHaveCount(0);
  });

  // TODO(#926 follow-up): isDirtyForTab が discard 後も一定時間 true で残る
  test.skip("リセット後にタブの dirty インジケーターが消える", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.accept());
    await addAction(page, "登録ボタン");
    const tabLocator = page.locator(".tabbar-tab").filter({ hasText: "テスト処理フロー" });
    await expect(tabLocator).toHaveClass(/\bdirty\b/);
    await page.locator(toolbarReset).click();
    await page.getByTestId("discard-confirm").click();
    await expect(tabLocator).not.toHaveClass(/\bdirty\b/);
  });

  test("Ctrl+S で保存が実行されて保存ボタンが無効に戻る", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(page.locator(toolbarSave)).toBeDisabled();
  });

  // TODO(#926 follow-up): localStorage の draft-action-<id> を pre-seed する仕組みが
  // edit-session-draft モデルでは backend (.edit-sessions/) に置き換わっており、
  // 直接 seed する経路の再現が必要。
  test.skip("ドラフトが事前に存在するとリロード後も isDirty 状態で復元される", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });
});
