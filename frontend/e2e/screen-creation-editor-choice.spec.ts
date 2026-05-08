/**
 * 画面作成時の editorKind / cssFramework 選択 UI E2E テスト — #825
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
  version: 1, name: "画面作成 E2E テスト用プロジェクト",
  screens: [], groups: [], edges: [], tables: [], processFlows: [],
  techStack: {
    designer: { cssFramework: "bootstrap", editorKind: "grapesjs" },
  },
};

const WS_KEY = "issue-926-screen-creation-editor-choice";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupFlowEditor(page: Page) {
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
  // 画面作成は edit モードで行う必要がある
  const editStart = page.getByTestId("edit-mode-start");
  if (await editStart.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editStart.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
  }
}

async function openAddScreenModal(page: Page) {
  // 画面 0 件時は「最初の画面を追加」(empty state)、1 件以上では「画面を追加」(toolbar)
  const addBtn = page.locator('button.flow-btn-primary').filter({ hasText: /画面を追加/ }).first();
  await expect(addBtn).toBeVisible();
  await addBtn.click();
  await expect(page.locator('.flow-modal')).toBeVisible();
}

test.describe("画面作成ダイアログ — editorKind / cssFramework 選択 UI (#825)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test("作成モーダルに editorKind ラジオが表示される", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);
    await expect(page.locator('input[name="screen-editor-kind"][value="grapesjs"]')).toBeVisible();
    await expect(page.locator('input[name="screen-editor-kind"][value="puck"]')).toBeVisible();
  });

  test("作成モーダルに cssFramework ラジオが表示される", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);
    await expect(page.locator('input[name="screen-css-framework"][value="bootstrap"]')).toBeVisible();
    await expect(page.locator('input[name="screen-css-framework"][value="tailwind"]')).toBeVisible();
  });

  test("デフォルト選択が grapesjs / bootstrap になっている (project default)", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);
    await expect(page.locator('input[name="screen-editor-kind"][value="grapesjs"]')).toBeChecked();
    await expect(page.locator('input[name="screen-css-framework"][value="bootstrap"]')).toBeChecked();
  });

  test("「作成後は変更できません」の注意書きが表示される", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);
    await expect(page.locator('.screen-create-design-note')).toContainText("作成後は変更できません");
  });

  // TODO(#926 follow-up): persistedDesign の確認は backend ファイル経由 (harmony/screens/<id>.json)
  // で行うよう assertion 書き換えが必要。本 PR では UI 操作のみ確認。
  test("puck / tailwind を選択して保存できる (#825 受入基準)", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);
    await page.locator("#screen-name").fill("Puck Tailwind 画面");
    await page.locator('input[name="screen-editor-kind"][value="puck"]').click();
    await expect(page.locator('input[name="screen-editor-kind"][value="puck"]')).toBeChecked();
    await page.locator('input[name="screen-css-framework"][value="tailwind"]').click();
    await expect(page.locator('input[name="screen-css-framework"][value="tailwind"]')).toBeChecked();
    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator('.flow-modal')).not.toBeVisible();
  });

  test("grapesjs / bootstrap を選択して保存できる (デフォルト)", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);
    await page.locator("#screen-name").fill("GrapesJS Bootstrap 画面");
    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator('.flow-modal')).not.toBeVisible();
  });
});
