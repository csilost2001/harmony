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
  seedTabsForWorkspace,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const SCREEN_ID = `scr-e2e-edit-session-${Date.now()}`;
const SCREEN_NORM = normalizeId(SCREEN_ID);
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "edit-session-test",
  entities: {
    screens: [{ id: SCREEN_ID, no: 1, name: "テスト画面", kind: "form", path: "/test", hasDesign: true, updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

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

  test("readonly オーバーレイが表示 → 編集開始 → 保存 → save 後も editing 継続 → discard で readonly", async ({ page }) => {
    await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);

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

    // spec §159: save 後も Active 状態が継続、複数回 save 可能 (Q2 合意)。
    // edit-mode-save / edit-mode-discard は表示され続け、edit-mode-start には戻らない。
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible();

    // 明示的に discard で editing 終了 → readonly 復帰
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 10000 });
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

test.describe("画面デザイナー edit-session — シナリオ 3: 再オープン (新モデル: clientId 変化を伴う hard-nav)", () => {
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

  // #980-A: ResumeOrDiscardDialog filter で `participants[mySessionId]` のみが対象になったため
  // hard navigation (gotoActive 内 page.goto("/workspace/select")) で clientId が変わった後は
  // 旧セッションの participant 配下に新 clientId が居ないため Resume dialog は出ない。
  // 旧期待値「draft 残って再オープン → ResumeOrDiscardDialog 表示」は旧仕様 (any active session
  // = my draft) の前提だったため新モデルでは成立しない。新モデルでは EditSessionDropdown 経由で
  // Viewer attach → take-over により旧セッションを引き継ぐ。
  // 注: 永続 clientId (sessionStorage 等) は別 ISSUE で検討 (Designer の hard-nav 専用問題、
  //     SPA navigation では clientId 維持されるため通常 UX に影響なし)。
  test("draft が残っている状態で hard-nav 再オープン → 別 clientId 扱いで Resume dialog 非表示、Dropdown から復帰可能", async ({ page }) => {
    await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
    // 前テスト残骸の draft が ResumeOrDiscardDialog として出る場合があるので dismiss
    await page.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }
    const editStartBtn = page.getByTestId("edit-mode-start");
    await expect(editStartBtn).toBeVisible({ timeout: 5000 });
    await editStartBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // hard-nav で clientId が変わる (Playwright test 特有、本番 SPA nav では発生しない)
    await ws.gotoActive(page, "/screen/list");
    await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);

    // 新 clientId は participants に居ない → Resume dialog は **出ない**
    await page.waitForTimeout(2000);
    await expect(page.locator('.edit-mode-modal-backdrop')).not.toBeVisible();

    // ただし旧セッションは Active のままなので、EditSessionDropdown で参加可能
    await expect(page.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 5000 });
  });
});

// シナリオ 4 (旧 localStorage 救済) は #924 で localStorage fallback 自体が削除されたため
// 検証対象が存在しない。spec block ごと削除 (新経路 backend `/legacy-rescue` 検証は別 ISSUE)。

// #980-A: ResumeOrDiscardDialog filter (participants[mySessionId] のみ) が
// Designer (GrapesJS resourceType: "screen" / Puck resourceType: "puck-data") でも
// 正しく動作することを multi-tab で検証する。
test.describe("画面デザイナー edit-session — multi-tab ResumeOrDiscardDialog filter (#980-A)", () => {
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

  test("GrapesJS: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const dummyTabS = { id: `screen:${SCREEN_NORM}`, type: "screen", resourceId: SCREEN_NORM, label: "テスト画面", isDirty: false, isPinned: false };

    try {
      // alice: GrapesJS Designer 編集開始
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTabS], dummyTabS.id);
      await ws.gotoActive(pageA, `/screen/design/${SCREEN_NORM}`);
      // 残骸 dialog dismiss
      await pageA.waitForTimeout(500);
      for (let _i = 0; _i < 3; _i++) {
        if (await pageA.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
          await pageA.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
          await pageA.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
        } else { break; }
      }
      const canvasStartBtn = pageA.getByTestId("canvas-readonly-start");
      await expect(canvasStartBtn).toBeVisible({ timeout: 10000 });
      await canvasStartBtn.click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

      // bob: 同 resource を開く → 5s 待っても ResumeOrDiscardDialog が出ないことを確認
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTabS], dummyTabS.id);
      await ws.gotoActive(pageB, `/screen/design/${SCREEN_NORM}`);
      await pageB.waitForTimeout(5000);
      await expect(pageB.locator('.edit-mode-modal-backdrop')).not.toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
