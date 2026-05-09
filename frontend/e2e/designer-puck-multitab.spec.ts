/**
 * Designer (Puck) multi-tab ResumeOrDiscardDialog filter test (#980-A)
 *
 * Puck 経路 (`resourceType: "puck-data"`) でも GrapesJS と同じ filter
 * (`participants[mySessionId]` のみ) が機能することを multi-tab で検証する。
 *
 * Designer.tsx は screenSessions (GrapesJS) と puckSessions (Puck) を Promise.all で
 * 並列に list して両方を filter している。同一コードパスだが、Puck 経路の挙動を
 * 実機検証することで「screen-data resourceType の filter が他 resourceType でも動作する」
 * ことの retention test として機能する。
 *
 * 関連 commit: 2877485 (#980-A 完全統一)。
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  seedTabsForWorkspace,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { makeDummyProject, makeScreenEntity, EMPTY_PUCK_DATA } from "./helpers/puck";

const SCREEN_ID = `puck-multitab-${Date.now()}`;
const SCREEN_NORM = normalizeId(SCREEN_ID);
const WS_KEY = "issue-980-puck-multitab";

let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("Designer (Puck) multi-tab ResumeOrDiscardDialog filter (#980-A)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    const screenEntity = makeScreenEntity(SCREEN_NORM, "Puck multitab テスト", "other", "/puck-multitab", "puck", "bootstrap");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: makeDummyProject(),
      screenEntities: [screenEntity],
    });
    // Puck data は harmony/screens/<id>.design.json に書き出す
    const file = path.join(ws.workspacePath, "harmony", "screens", `${SCREEN_NORM}.design.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(EMPTY_PUCK_DATA, null, 2), "utf-8");
  });

  test("Puck: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    // tab type = "design" (Designer 画面用、setupPuckScreen と同じ)
    const dummyTab = { id: `design:${SCREEN_NORM}`, type: "design", resourceId: SCREEN_NORM, label: "Puck multitab テスト", isDirty: false, isPinned: false };

    try {
      // alice: Puck Designer 編集開始
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await ws.gotoActive(pageA, `/screen/design/${SCREEN_NORM}`);
      // 残骸 dialog dismiss
      await pageA.waitForTimeout(500);
      for (let _i = 0; _i < 3; _i++) {
        if (await pageA.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
          await pageA.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
          await pageA.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
        } else { break; }
      }
      // Puck editor が表示されるまで待つ → editing mode 開始
      await expect(pageA.locator("[data-testid='puck-editor-container']")).toBeVisible({ timeout: 20000 });
      // edit-mode-start (header) または canvas-readonly-start のいずれかをクリックして editing mode へ
      const editStartBtn = pageA.getByTestId("edit-mode-start");
      const editStartVisible = await editStartBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (editStartVisible) {
        await editStartBtn.click();
      } else {
        await pageA.getByTestId("canvas-readonly-start").click();
      }
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });

      // bob: 同 resource を開く → Puck 経路の filter で Resume dialog 非表示
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await ws.gotoActive(pageB, `/screen/design/${SCREEN_NORM}`);
      await pageB.waitForTimeout(5000);
      await expect(pageB.locator('.edit-mode-modal-backdrop')).not.toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
