/**
 * フロー画面：保存/リセットボタン E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */

import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const dummyProject = {
  version: 1, name: "E2Eテスト用プロジェクト",
  screens: [], groups: [], edges: [],
};

const toolbarSave = ".save-reset-buttons button.srb-btn-save";
const toolbarReset = ".save-reset-buttons button.srb-btn-reset";

const WS_KEY = "issue-926-save-reset-flow";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupFlowEditor(page: Page) {
  ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  await ws.gotoActive(page, "/screen/flow");
  await expect(page.locator(".flow-root")).toBeVisible();
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

async function addScreenViaModal(
  page: Page,
  name: string,
  options?: { editorKind?: "grapesjs" | "puck"; cssFramework?: "bootstrap" | "tailwind" },
) {
  // 画面 0 件時は「最初の画面を追加」(empty state)、1件以上では「画面を追加」(toolbar)
  const addBtn = page.locator('button.flow-btn-primary').filter({ hasText: /画面を追加/ }).first();
  await addBtn.click();
  await page.locator("#screen-name").fill(name);
  if (options?.editorKind) {
    await page.locator(`input[name="screen-editor-kind"][value="${options.editorKind}"]`).click();
  }
  if (options?.cssFramework) {
    await page.locator(`input[name="screen-css-framework"][value="${options.cssFramework}"]`).click();
  }
  await page.locator('.flow-modal button[type="submit"]').click();
}

test.describe("フロー画面：保存/リセットボタン", () => {
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
    await setupFlowEditor(page);
    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("画面追加後に保存・リセットボタンが有効になる", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "テスト画面");
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("リセット確認をキャンセルすると編集状態が保持される", async ({ page }) => {
    await setupFlowEditor(page);
    page.on("dialog", (d) => d.dismiss());
    await addScreenViaModal(page, "テスト画面");
    await page.locator(toolbarReset).click();
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("リセット確認を承認するとボタンが無効に戻る (DiscardConfirmDialog 経由)", async ({ page }) => {
    await setupFlowEditor(page);
    page.on("dialog", (d) => d.accept());
    await addScreenViaModal(page, "テスト画面");
    await page.locator(toolbarReset).click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(toolbarSave)).toHaveCount(0);
    await expect(page.locator(toolbarReset)).toHaveCount(0);
  });

  test("Ctrl+S で保存が実行されてボタンが無効に戻る", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "テスト画面");
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(page.locator(toolbarSave)).toBeDisabled();
  });

  // TODO(#926 follow-up): backend draft seed (.edit-sessions/) 経由でのプリロードが必要
  test.skip("ドラフトが事前に存在するとリロード後も isDirty 状態で復元される", async ({ page }) => {
    await setupFlowEditor(page);
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });
});
