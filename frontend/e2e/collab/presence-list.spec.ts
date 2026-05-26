/**
 * presence-list.spec.ts (#886 Phase 8)
 *
 * 一覧 SessionBadge 表示: editor が一覧画面に SessionBadge として表示される。
 * docs/spec/collab-presence.md § 5 一覧 badge 表示 に準拠。
 *
 * #980-A: localStorage seed (#923 で fallback 廃止後 dead pattern) → realWorkspace 経由に書き換え。
 *
 * シナリオ:
 *   1. tab1 で editor (heartbeat / EditSession 開始)
 *   2. tab2 で /process-flow/list → 該当行に EditSessionBadge
 *   3. tab1 で discard → tab2 のバッジ消滅 (broadcast 経由)
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
import { buildProject, buildProcessFlow } from "../__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const PF_ID = `pf-collab-presence-list-${Date.now()}`;
const PF_NORM = normalizeId(PF_ID);

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "一覧バッジテストフロー",
  flowType: "screen",
  mode: "upstream",
  actions: [],
});

const dummyProject = buildProject({
  name: "collab-presence-list-test",
  entities: {
    processFlows: [{ id: PF_ID, no: 1, name: "一覧バッジテストフロー", flowType: "screen", actionCount: 0, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const dummyTab = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "一覧バッジテストフロー", isDirty: false, isPinned: false };

const WS_KEY = "issue-980-collab-presence-list";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function gotoEditorAndStart(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${PF_NORM}`);
  await expect(page.locator(".process-flow-page")).toBeVisible();
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else { break; }
  }
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
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
}

test.describe("協調編集 一覧 SessionBadge 表示", { tag: ["@regression"] }, () => {
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

  test("editor 中は一覧に EditSessionBadge が表示され、discard で消える", async ({ browser }) => {
    test.setTimeout(120000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // tab1: 編集開始
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndStart(pageA);

      // tab2: 一覧
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await ws.gotoActive(pageB, "/process-flow/list");
      await expect(pageB.locator(".process-flow-card-name").getByText("一覧バッジテストフロー")).toBeVisible({ timeout: 10000 });

      // EditSessionBadge が表示される (broadcast 受信後)
      const badge = pageB.locator('[data-testid="edit-session-badge"]').first();
      await expect(badge).toBeVisible({ timeout: 10000 });

      // tab1: discard で session 終了
      await pageA.getByTestId("edit-mode-discard").click();
      if (await pageA.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
        await pageA.getByTestId("discard-confirm").click();
      }
      await expect(pageA.getByTestId("edit-mode-start")).toBeVisible({ timeout: 10000 });

      // tab2: discard 反映で badge 消滅
      await expect(badge).not.toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
