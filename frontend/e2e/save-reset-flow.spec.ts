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
import { buildProject } from "./__fixtures__/builders";

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
});

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
  // edit-mode-start または edit-mode-save のどちらかが表示されるまで待つ
  await Promise.race([
    page.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 10000 }),
    page.getByTestId("edit-mode-save").waitFor({ state: "visible", timeout: 10000 }),
  ]).catch(() => undefined);
  // 前回の edit session が残っていて editing mode のまま開いた場合: discard して readonly に戻す
  if (await page.getByTestId("edit-mode-save").isVisible({ timeout: 100 }).catch(() => false)) {
    await page.getByTestId("edit-mode-discard").click();
    if (await page.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByTestId("discard-confirm").click();
    }
    await page.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
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

  test("リセット承認後も editing 継続、明示的に discard で readonly 復帰", async ({ page }) => {
    // reset = state revert + editing 継続 (Word-like semantics / spec §159 と整合)
    // discard = EditSession 終了 + readonly 復帰 (別操作)
    await setupFlowEditor(page);
    page.once("dialog", (dialog) => dialog.accept());
    await addScreenViaModal(page, "テスト画面");
    await page.locator(toolbarReset).click();
    // reset 後も editing 継続: EditModeToolbar (save/discard ボタン) は表示されたまま
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible();
    // 明示的に discard で readonly 復帰
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 8000 });
    // readonly 復帰後: ボタンは DOM に残るが isDirty=false で disabled になる
    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("Ctrl+S で保存が実行されてボタンが無効に戻る", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "テスト画面");
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(page.locator(toolbarSave)).toBeDisabled();
  });

  // 元 spec の「reload しても isDirty が復元される」は旧 localStorage seed 仕様前提。
  // edit-session-draft (#683) は明示保存式で reload 前に明示 save しなければ消える設計。
  // 同意図 (attach で payload 取得) は edit-session/url-invitation で別途検証。
});
