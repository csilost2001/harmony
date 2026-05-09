/**
 * take-over.spec.ts (#886 Phase 8)
 *
 * 協調編集 引継ぎフロー: tab1 (alice) editor → tab2 (bob) viewer → [↪引継] クリック。
 * docs/spec/collab-presence.md § 8 Take-over フロー / docs/spec/edit-session-protocol.md § 7 に準拠。
 *
 * #980-A: localStorage seed (#923 で fallback 廃止後 dead pattern) → realWorkspace 経由に書き換え。
 *
 * シナリオ:
 *   1. tab1 (alice) で編集開始 → editor
 *   2. tab2 (bob) で attach → viewer
 *   3. tab2 が EditSessionDropdown から [↪引継] クリック → confirm
 *   4. transferEdit → tab2 が editor mode、tab1 が viewer mode
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
import { attachAsViewer, takeOver } from "../helpers/editSessionDropdown";
import { buildProject, buildProcessFlow } from "../__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const PF_ID = `pf-collab-takeover-${Date.now()}`;
const PF_NORM = normalizeId(PF_ID);

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "引継ぎテストフロー",
  kind: "screen",
  mode: "upstream",
  actions: [],
});

const dummyProject = buildProject({
  name: "collab-takeover-test",
  entities: {
    processFlows: [{ id: PF_ID, no: 1, name: "引継ぎテストフロー", kind: "screen", actionCount: 0, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const dummyTab = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "引継ぎテストフロー", isDirty: false, isPinned: false };

const WS_KEY = "issue-980-collab-takeover";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function gotoEditorAndDismiss(page: Page) {
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

test.describe("協調編集 引継ぎ (take-over)", () => {
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

  test("引継ぎ前提: 2 タブで editor / viewer 状態が取れる", async ({ browser }) => {
    test.setTimeout(180000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndDismiss(pageA);
      await ensureReadOnly(pageA);
      await pageA.getByTestId("edit-mode-start").click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndDismiss(pageB);
      // tab2 は viewer 化 — esd-toggle-btn が見える
      await expect(pageB.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 15000 });

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

  test("引継ぎフロー完全検証: tab2 take-over → tab2 editor / tab1 viewer", async ({ browser }) => {
    test.setTimeout(180000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // pageA: alice 編集開始
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndDismiss(pageA);
      await ensureReadOnly(pageA);
      await pageA.getByTestId("edit-mode-start").click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      // pageB: bob 観察 (Viewer) で attach → takeover (helpers/editSessionDropdown 経由)
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndDismiss(pageB);
      await attachAsViewer(pageB);
      await takeOver(pageB);

      // pageB が editor mode になる
      await expect(pageB.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      // pageA は viewer mode 化される (edit-mode-save が消え EditSessionDropdown が出る)
      await expect(pageA.getByTestId("edit-mode-save")).not.toBeVisible({ timeout: 10000 });
      // 後始末は context.close() に任せる
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
