/**
 * 2-tab-smoke.spec.ts (#886 Phase 8)
 *
 * 協調編集 基本フロー: tab1 editor + tab2 viewer の基本動作を検証する。
 * docs/spec/collab-presence.md § 3 基本フロー / docs/spec/edit-session-protocol.md に準拠。
 *
 * #980-A: localStorage seed (#923 で fallback 廃止後 dead pattern) → realWorkspace 経由に書き換え。
 *
 * シナリオ:
 *   1. tab1 で /process-flow/edit/<id> 開く
 *   2. tab1 で「編集開始」ボタン → editor mode
 *   3. tab2 で同じ URL → viewer mode (EditSessionDropdown が出る)
 *   4. tab1 で discard → tab2 が再度 editor mode に切り替え可
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
import type { HarmonyEntities, Timestamp } from "../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const PF_ID = `pf-collab-smoke-${Date.now()}`;
const PF_NORM = normalizeId(PF_ID);

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "協調編集スモークテスト",
  flowType: "screen",
  mode: "upstream",
  actions: [],
});

const dummyProject = buildProject({
  name: "collab-2tab-smoke-test",
  entities: {
    processFlows: [{ id: PF_ID, no: 1, name: "協調編集スモークテスト", flowType: "screen", actionCount: 0, maturity: "draft", updatedAt: FIXED_TS }],
  } as HarmonyEntities,
});

const dummyTab = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "協調編集スモークテスト", isDirty: false, isPinned: false };

const WS_KEY = "issue-980-collab-2tab-smoke";
let mcpAvailable = false;
let ws: OpenedWorkspace;

/** save-reset-action 系の安定パターンを 2-tab 用に inline 展開 */
async function gotoEditorAndDismissDialogs(page: Page) {
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

test.describe("協調編集 2-tab smoke", { tag: ["@regression"] }, () => {
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

  test("シナリオ: tab1 editor + tab2 viewer + discard + tab2 が後で editor に上がれる", async ({ browser }) => {
    // 2-browser-context + multiple gotoActive で >30s かかるため明示的に延長
    test.setTimeout(120000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ── tab1: 編集開始 ──
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndDismissDialogs(pageA);

      // editor が edit-mode-start / edit-mode-save どちらかの状態になるのを待つ
      await Promise.race([
        pageA.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 10000 }),
        pageA.getByTestId("edit-mode-save").waitFor({ state: "visible", timeout: 10000 }),
      ]).catch(() => undefined);
      // すでに editing mode ならまず discard で readonly に戻す (前テストの残骸対応)
      if (await pageA.getByTestId("edit-mode-save").isVisible({ timeout: 100 }).catch(() => false)) {
        await pageA.getByTestId("edit-mode-discard").click();
        if (await pageA.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
          await pageA.getByTestId("discard-confirm").click();
        }
        await pageA.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
      }
      await pageA.getByTestId("edit-mode-start").click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      // ── tab2: 同 URL を開く → 既存 EditSession に View role で attach 想定 ──
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditorAndDismissDialogs(pageB);

      // collab-presence.md § 3.1: 後着の tab には EditSessionDropdown (esd-toggle-btn) が表示される
      const tab2Esd = pageB.getByTestId("esd-toggle-btn");
      await expect(tab2Esd).toBeVisible({ timeout: 15000 });

      // ── tab1: discard で session を畳む ──
      await pageA.getByTestId("edit-mode-discard").click();
      const discardConfirm = pageA.getByTestId("discard-confirm");
      if (await discardConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
        await discardConfirm.click();
      }
      await expect(pageA.getByTestId("edit-mode-start")).toBeVisible({ timeout: 10000 });

      // ── tab2: session 終了 broadcast 受信 → 編集開始可能になる ──
      await expect(pageB.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
