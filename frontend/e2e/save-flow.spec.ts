/**
 * 保存フロー E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   project は backend、tabs / activeTabId 等は per-browser localStorage UI state。
 */

import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const SCREEN_A = "test-0001-4000-8000-000000000001";
const SCREEN_B = "test-0002-4000-8000-000000000002";
const SCREEN_A_ID = normalizeId(SCREEN_A);
const SCREEN_B_ID = normalizeId(SCREEN_B);
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
  entities: {
    screens: [
      { id: SCREEN_A, no: 1, name: "画面A", kind: "list", path: "/a", hasDesign: true, updatedAt: FIXED_TS },
      { id: SCREEN_B, no: 2, name: "画面B", kind: "list", path: "/b", hasDesign: true, updatedAt: FIXED_TS },
    ],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-save-flow";
let mcpAvailable = false;
let ws: OpenedWorkspace;

/** タブ事前設定付きセットアップ */
async function setupWithTabs(page: Page, screenIds: string[], labels: Record<string, string>): Promise<void> {
  const tabs = screenIds.map((id) => ({
    id: `design:${id}`,
    type: "design",
    resourceId: id,
    label: labels[id] ?? id,
    isDirty: false,
    isPinned: false,
  }));
  const activeTabId = `design:${screenIds[screenIds.length - 1]}`;
  await page.addInitScript(
    ({ tabs, activeTabId }) => {
      localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
      localStorage.setItem("harmony-active-tab", activeTabId);
    },
    { tabs, activeTabId },
  );
}

test.describe("保存フロー (タブ復元)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test.describe("ページリロード後のタブ復元", () => {
    test("リロード後に1タブが復元される", async ({ page }) => {
      await setupWithTabs(page, [SCREEN_A_ID], { [SCREEN_A_ID]: "画面A" });
      await ws.gotoActive(page, `/screen/design/${SCREEN_A_ID}`);
      await expect(page.locator(".tabbar-tab")).toHaveCount(1, { timeout: 10000 });
      await expect(page.locator(".tabbar-tab")).toContainText("画面A");

      await page.reload();
      await expect(page.locator(".tabbar-tab")).toHaveCount(1, { timeout: 10000 });
      await expect(page.locator(".tabbar-tab")).toContainText("画面A");
    });

    test("リロード後に複数タブが復元される", async ({ page }) => {
      await setupWithTabs(page, [SCREEN_A_ID, SCREEN_B_ID], { [SCREEN_A_ID]: "画面A", [SCREEN_B_ID]: "画面B" });
      await ws.gotoActive(page, `/screen/design/${SCREEN_B_ID}`);
      await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });

      await page.reload();
      await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
      await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toBeVisible();
      await expect(page.locator(".tabbar-tab").filter({ hasText: "画面B" })).toBeVisible();
    });

    test("リロード後にアクティブタブが復元される", async ({ page }) => {
      await setupWithTabs(page, [SCREEN_B_ID, SCREEN_A_ID], { [SCREEN_A_ID]: "画面A", [SCREEN_B_ID]: "画面B" });
      await ws.gotoActive(page, `/screen/design/${SCREEN_A_ID}`);
      await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });

      await page.reload();
      await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
    });
  });

  test.describe("isPinned の永続化", () => {
    test("ピン留めはリロード後も保持される", async ({ page }) => {
      const tabs = [
        { id: `design:${SCREEN_A_ID}`, type: "design", resourceId: SCREEN_A_ID, label: "画面A", isDirty: false, isPinned: true },
        { id: `design:${SCREEN_B_ID}`, type: "design", resourceId: SCREEN_B_ID, label: "画面B", isDirty: false, isPinned: false },
      ];
      await page.addInitScript(
        ({ tabs, activeTabId }) => {
          localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
          localStorage.setItem("harmony-active-tab", activeTabId);
        },
        { tabs, activeTabId: `design:${SCREEN_B_ID}` },
      );
      await ws.gotoActive(page, `/screen/design/${SCREEN_B_ID}`);
      await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
      await expect(page.locator(".tabbar-tab.pinned")).toContainText("画面A");

      await page.reload();
      await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
      await expect(page.locator(".tabbar-tab.pinned")).toContainText("画面A");
    });
  });
});
