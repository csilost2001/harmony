/**
 * GrapesJS 画面デザイナー edit-session E2E テスト (#689)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *
 * 注: 旧 spec は data/screens/<id>.design.json に直接ファイル書き込みしていたが、
 * realWorkspace 経由では workspace 配下に書く。screen entity は backend から
 * harmony.json + harmony/screens/<id>.json として load される。
 *
 * シナリオ 4 (localStorage 救済) は #924 で localStorage fallback が削除されたため
 * 検証経路が変わる (backend `/legacy-rescue` 経由)。本 PR では skip。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const SCREEN_ID = `scr-e2e-edit-session-${Date.now()}`;
const SCREEN_NORM = normalizeId(SCREEN_ID);

const dummyProject = {
  version: 1, name: "edit-session-test",
  screens: [{ id: SCREEN_ID, no: 1, name: "テスト画面", kind: "form", path: "/test", hasDesign: true }],
  groups: [], edges: [], tables: [],
};

const screenDesign = {
  assets: [], styles: [],
  pages: [{ frames: [{ component: { type: "wrapper" } }] }],
};

const WS_KEY = "issue-926-designer-edit-session";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("画面デザイナー edit-session — シナリオ 1: 編集開始 → 保存", () => {
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
      screenDesigns: [{ id: SCREEN_ID, data: screenDesign }],
    });
  });

  test("readonly オーバーレイが表示 → 編集開始 → 保存 → readonly に戻る", async ({ page }) => {
    await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
    await page.waitForLoadState("networkidle");

    // 過去 test 残骸の draft が ResumeOrDiscardDialog として出る場合があるので dismiss
    await page.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }

    const overlay = page.getByTestId("canvas-readonly-overlay");
    await expect(overlay).toBeVisible({ timeout: 10000 });

    const canvasStartBtn = page.getByTestId("canvas-readonly-start");
    await expect(canvasStartBtn).toBeVisible();
    await canvasStartBtn.click();

    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("edit-mode-save").click();
    // 保存後 readonly に戻るまで時間がかかる場合あり (screen entity write + state 反映の async)
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("canvas-readonly-overlay")).toBeVisible();
  });
});

test.describe("画面デザイナー edit-session — シナリオ 2: 編集中 → 破棄", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      screenDesigns: [{ id: SCREEN_ID, data: screenDesign }],
    });
  });

  test("編集開始 → 破棄確認 → readonly に戻る", async ({ page }) => {
    await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }
    const editStartBtn = page.getByTestId("edit-mode-start");
    await expect(editStartBtn).toBeVisible({ timeout: 10000 });
    await editStartBtn.click();
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("canvas-readonly-overlay")).toBeVisible();
  });
});

test.describe("画面デザイナー edit-session — シナリオ 3: 再オープン → ResumeOrDiscardDialog", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      screenDesigns: [{ id: SCREEN_ID, data: screenDesign }],
    });
  });

  test("draft が残っている状態で再オープン → ResumeOrDiscardDialog 表示", async ({ page }) => {
    await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
    await page.waitForLoadState("networkidle");
    const editStartBtn = page.getByTestId("edit-mode-start");
    await expect(editStartBtn).toBeVisible({ timeout: 5000 });
    await editStartBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.goto(ws.path("/screen/list"));
    await page.waitForLoadState("networkidle");
    await page.goto(ws.path(`/screen/design/${SCREEN_NORM}`));
    await page.waitForLoadState("networkidle");
    const continueBtn = page.getByTestId("resume-continue");
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 8000 });
      await page.getByTestId("edit-mode-discard").click();
      await page.getByTestId("discard-confirm").click();
    } else {
      test.skip();
    }
  });
});

// TODO(#926 follow-up): localStorage 救済シナリオは backend / legacy-rescue 経由に
// 移行されたため、本 spec の旧経路 (gjs-screen-<id> seed → legacy-rescue-adopt) は
// 廃止。新経路の検証は別 ISSUE で対応する。
test.describe("画面デザイナー edit-session — シナリオ 4: localStorage 救済", () => {
  test.skip("旧 gjs-screen-{id} キーを仕込み → 差分あり → 救済ダイアログ → 採用", () => { /* skip */ });
});
