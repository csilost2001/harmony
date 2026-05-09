/**
 * multi-session-branching.spec.ts (#904 / meta #897 Phase 7)
 *
 * spec §9 (複数 EditSession 並存 + A 案 / B 案) の E2E 検証。
 *
 * docs/spec/edit-session-protocol.md §9:
 *  - 複数 EditSession 並存 + last-save-wins 警告ダイアログ
 *  - 一覧 EditSessionBadge で件数表示
 *
 * #980-A: localStorage seed (#923 で fallback 廃止後 dead pattern) → realWorkspace 経由に書き換え。
 *
 * シナリオ:
 *   1. tab1 で EditSession-A (alice) 開始
 *   2. tab2 で同 resource を開く → viewer (esd-toggle-btn) で 1 session 確認
 *   3. tab2 が「新規 draft (B 案)」で別 EditSession-B を起動
 *   4. tab3 で /process-flow/list → EditSessionBadge に「2」表示
 */

import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  seedTabsForWorkspace,
  type OpenedWorkspace,
} from "../helpers/realWorkspace";
import { startNewDraft } from "../helpers/editSessionDropdown";
import { buildProject, buildProcessFlow } from "../__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const PF_ID = `pf-multi-session-${Date.now()}`;
const PF_NORM = normalizeId(PF_ID);

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "A 案 / B 案 並行編集テスト",
  kind: "screen",
  mode: "upstream",
  actions: [],
});

const dummyProject = buildProject({
  name: "edit-session-multi-branching-test",
  entities: {
    processFlows: [{ id: PF_ID, no: 1, name: "A 案 / B 案 並行編集テスト", kind: "screen", actionCount: 0, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const dummyTab = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "A 案 / B 案 並行編集テスト", isDirty: false, isPinned: false };

const WS_KEY = "issue-980-edit-session-multi-branching";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function gotoEditor(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${PF_NORM}`);
  await expect(page.locator(".process-flow-page")).toBeVisible();
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else { break; }
  }
}

async function ensureReadOnly(page: Page) {
  await Promise.race([
    page.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 10000 }),
    page.getByTestId("edit-mode-save").waitFor({ state: "visible", timeout: 10000 }),
  ]).catch(() => undefined);
  if (await page.getByTestId("edit-mode-save").isVisible({ timeout: 100 }).catch(() => false)) {
    await page.getByTestId("edit-mode-discard").click();
    if (await page.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByTestId("discard-confirm").click();
    }
    await page.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  }
}

test.describe("spec §9 複数 EditSession 並存 (A 案 / B 案)", () => {
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
      processFlows: [dummyProcessFlowBody],
    });
  });

  test("A 案 + B 案の並存 EditSession (esd-toggle-btn から新規 draft)", async ({ browser }) => {
    test.setTimeout(180000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // alice: A 案
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditor(pageA);
      await ensureReadOnly(pageA);
      await pageA.getByTestId("edit-mode-start").click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      // bob: 同 resource → 新規 draft (B 案) を起動 (helpers/editSessionDropdown 経由)
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditor(pageB);
      await startNewDraft(pageB);
      await expect(pageB.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
      // 後始末は context.close() に任せる (明示 discard は不要)
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("EditSessionBadge: editor 中は一覧に件数バッジが表示される (spec §9.4)", async ({ browser }) => {
    test.setTimeout(180000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // alice 編集開始
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditor(pageA);
      await ensureReadOnly(pageA);
      await pageA.getByTestId("edit-mode-start").click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      // bob: 一覧
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await ws.gotoActive(pageB, "/process-flow/list");
      await expect(pageB.getByText("A 案 / B 案 並行編集テスト")).toBeVisible({ timeout: 10000 });
      // EditSessionBadge が表示される
      await expect(pageB.locator('[data-testid="edit-session-badge"]').first()).toBeVisible({ timeout: 10000 });

      // クリーンアップ
      await pageA.getByTestId("edit-mode-discard").click();
      if (await pageA.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
        await pageA.getByTestId("discard-confirm").click();
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
