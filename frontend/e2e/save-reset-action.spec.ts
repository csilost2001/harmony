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
  seedTabsForWorkspace,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const PROCESS_FLOW_ID = "test-ag-0001-4000-8000-000000000001";
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProcessFlowBody = buildProcessFlow({
  id: PROCESS_FLOW_ID,
  name: "テスト処理フロー",
  kind: "screen",
  mode: "upstream",
  actions: [],
});

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
  entities: {
    processFlows: [{ id: PROCESS_FLOW_ID, no: 1, name: "テスト処理フロー", kind: "screen", actionCount: 0, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

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
  await seedTabsForWorkspace(page, ws.wsId, [dummyTab], dummyTab.id);
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

  test("リセット承認後も editing 継続、明示的に discard で readonly 復帰", async ({ page }) => {
    // reset = state revert + editing 継続 (Word-like semantics / spec §159 と整合)
    // discard = EditSession 終了 + readonly 復帰 (別操作)
    await setupProcessFlowEditor(page);
    page.once("dialog", (dialog) => dialog.accept());
    await addAction(page, "登録ボタン");
    await page.locator(toolbarReset).click();
    // reset 後も editing 継続: EditModeToolbar (save/discard ボタン) は表示されたまま
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible();
    // 明示的に discard で readonly 復帰
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });
    await page.getByTestId("discard-confirm").click();
    // 破棄完了 → readonly モードに戻り SaveResetButtons は非表示
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 8000 });
    await expect(page.locator(toolbarSave)).toHaveCount(0);
    await expect(page.locator(toolbarReset)).toHaveCount(0);
  });

  test("リセット後にタブの dirty インジケーターが消える", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.accept());
    await addAction(page, "登録ボタン");
    const tabLocator = page.locator(".tabbar-tab").filter({ hasText: "テスト処理フロー" });
    await expect(tabLocator).toHaveClass(/\bdirty\b/);
    // page.evaluate で document.querySelector + element.click() を直接呼ぶ
    // (Playwright actionability/hit test を完全 bypass、React onClick も正常 fire)
    await page.evaluate((sel) => (document.querySelector(sel) as HTMLButtonElement | null)?.click(), toolbarReset);
    await page.evaluate(() => (document.querySelector('[data-testid="discard-confirm"]') as HTMLButtonElement | null)?.click());
    // editSession.discard broadcast → useEditSession state 更新 → handleReset → editor 再 load
    // → useEffect → setTabDirty(false) のチェーンで時間がかかる。20s 待ち。
    await expect(tabLocator).not.toHaveClass(/\bdirty\b/, { timeout: 20000 });
  });

  test("Ctrl+S で保存が実行されて保存ボタンが無効に戻る", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");
    await expect(page.locator(toolbarSave)).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(page.locator(toolbarSave)).toBeDisabled();
  });

  // 元 spec の「reload しても isDirty が復元される」は旧 localStorage seed 仕様前提。
  // edit-session-draft (#683) は明示保存式で、reload 前に明示 save しなければ in-memory
  // 編集が消える設計。draft 復元の検証は edit-session/url-invitation:171
  // 「§13.3 attach 直後に最新 payload が broadcast 待ちなしで取得できる」でカバー済。
});
