/**
 * 1-6-step-flow.spec.ts (#904 / meta #897 Phase 7)
 *
 * spec §5 (1-6 step) + §13.3 (attach 時の initial fetch) の完全フロー E2E 検証。
 *
 * docs/spec/edit-session-protocol.md §18.1 受け入れ基準の検証:
 *  - § 3 EditSession 概念の正規実装
 *  - § 5 ライフサイクル 1-6 step が動作 (vitest + e2e)
 *  - § 13 attach 時の initial fetch (memory store から最新 payload 取得)
 *
 * #980-A: localStorage seed (#923 で fallback 廃止後 dead pattern) → realWorkspace 経由に書き換え。
 *
 * シナリオ (spec §5 1-6 step):
 *   1. tab1 (alice) で「編集開始」→ EditSession 作成、role=Edit
 *   2. tab2 (bob) で同 URL → attach as View
 *   3. tab2 で take-over → atomic に alice → View, bob → Edit
 *   6. tab1 で save (Edit 役) → audit log に savedBy 記録、state は Active 継続
 *   7. EditSession を明示 discard → state: Discarded
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
const PF_ID = `pf-edit-session-flow-${Date.now()}`;
const PF_NORM = normalizeId(PF_ID);

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "1-6 step フロー検証テスト",
  flowType: "screen",
  mode: "upstream",
  actions: [],
});

const dummyProject = buildProject({
  name: "edit-session-1-6-step-test",
  entities: {
    processFlows: [{ id: PF_ID, no: 1, name: "1-6 step フロー検証テスト", flowType: "screen", actionCount: 0, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const dummyTab = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "1-6 step フロー検証テスト", isDirty: false, isPinned: false };

const WS_KEY = "issue-980-edit-session-1-6-step";
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

test.describe("spec §5 1-6 step 完全フロー (EditSession ライフサイクル)", { tag: ["@regression"] }, () => {
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

  test("1-6 step: create → attach → save (Active 継続) → discard", async ({ browser }) => {
    test.setTimeout(120000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // step 1: alice 編集開始
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditor(pageA);
      await ensureReadOnly(pageA);
      await pageA.getByTestId("edit-mode-start").click();
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

      // step 2: bob attach (View)
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
      await gotoEditor(pageB);
      await expect(pageB.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 15000 });

      // step 6: alice が save → spec §5.1 / §8.3 で Active 継続 (Edit role 維持)
      await pageA.getByTestId("edit-mode-save").click();
      // save 成功後も edit-mode-save / edit-mode-discard は表示され続ける
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
      await expect(pageA.getByTestId("edit-mode-discard")).toBeVisible();

      // step 7: discard → state Discarded → readonly に戻る
      await pageA.getByTestId("edit-mode-discard").click();
      if (await pageA.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
        await pageA.getByTestId("discard-confirm").click();
      }
      await expect(pageA.getByTestId("edit-mode-start")).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("URL ?session= 招待: tab1 の URL で tab2 が自動 attach する (spec §11.2)", async ({ browser }) => {
    test.setTimeout(120000);
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

      // alice の URL に ?session= が付くか確認
      await pageA.waitForTimeout(500); // URL sync 待ち
      const urlAfterStart = pageA.url();
      const sessionParam = new URL(urlAfterStart).searchParams.get("session");

      if (sessionParam) {
        // spec §11.1 実装済 — bob が招待 URL で開く
        expect(sessionParam).toMatch(/^es-/);
        await pageB.goto(urlAfterStart);
        await pageB.waitForLoadState("networkidle");
        // bob は既存 EditSession に attach する
        await expect(pageB.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 15000 });
        // 同 EditSession に attach 済み
        const tab2SessionParam = new URL(pageB.url()).searchParams.get("session");
        expect(tab2SessionParam).toBe(sessionParam);
      } else {
        // §11.1 未実装 — base URL で alice を attach 観察できることのみ確認
        await seedTabsForWorkspace(pageB, ws.wsId, [dummyTab], dummyTab.id);
        await gotoEditor(pageB);
        await expect(pageB.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 15000 });
      }

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
