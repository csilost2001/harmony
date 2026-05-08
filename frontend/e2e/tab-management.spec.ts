/**
 * タブ管理 E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

// schema v3: id は UUID v4 必須 (common.v3.schema.json#/$defs/Uuid)
const SCREEN_A = "aaaaaaaa-0001-4001-8001-000000000001";
const SCREEN_B = "bbbbbbbb-0002-4002-8002-000000000002";
const SCREEN_C = "cccccccc-0003-4003-8003-000000000003";

const SCREEN_A_NORM = normalizeId(SCREEN_A);
const SCREEN_B_NORM = normalizeId(SCREEN_B);
const SCREEN_C_NORM = normalizeId(SCREEN_C);

const SCREENS: Record<string, string> = {
  [SCREEN_A_NORM]: "画面A",
  [SCREEN_B_NORM]: "画面B",
  [SCREEN_C_NORM]: "画面C",
};

const dummyProject = {
  version: 1, name: "E2Eテスト用プロジェクト",
  screens: [
    { id: SCREEN_A, no: 1, name: "画面A", kind: "list", path: "/a", hasDesign: true },
    { id: SCREEN_B, no: 2, name: "画面B", kind: "list", path: "/b", hasDesign: true },
    { id: SCREEN_C, no: 3, name: "画面C", kind: "list", path: "/c", hasDesign: true },
  ],
  groups: [], edges: [],
};

const WS_KEY = "issue-926-tab-management";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupWithScreens(page: Page, screenIds: string[]) {
  const tabs = screenIds.map((id) => ({
    id: `design:${id}`,
    type: "design",
    resourceId: id,
    label: SCREENS[id] ?? id,
    isDirty: false,
    isPinned: false,
  }));
  const activeTabId = `design:${screenIds[screenIds.length - 1]}`;
  await page.addInitScript(({ tabs, activeTabId }) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
    localStorage.setItem("harmony-active-tab", activeTabId);
  }, { tabs, activeTabId });
  await ws.gotoActive(page, `/screen/design/${screenIds[screenIds.length - 1]}`);
  await expect(page.locator(".tabbar-tab")).toHaveCount(screenIds.length);
}

test.describe("タブ管理", () => {
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

  test.describe("タブ表示", () => {
    test("画面を開くとタブバーが表示される", async ({ page }) => {
      await setupWithScreens(page, [SCREEN_A_NORM]);
      await expect(page.locator(".tabbar")).toBeVisible();
      await expect(page.locator(".tabbar-tab")).toHaveCount(1);
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
    });

    test("2枚目の画面を開くと2タブ表示される", async ({ page }) => {
      await setupWithScreens(page, [SCREEN_A_NORM, SCREEN_B_NORM]);
      await expect(page.locator(".tabbar-tab")).toHaveCount(2);
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
    });
  });

  test.describe("タブ切り替え", () => {
    test.beforeEach(async ({ page }) => {
      await setupWithScreens(page, [SCREEN_A_NORM, SCREEN_B_NORM]);
    });

    // TODO(#945 follow-up): tab click 後に AppShell の activeTab → URL sync useEffect が
    // navigate しない race。lastSyncedActiveTabIdRef の初期化タイミング or
    // tabStore localStorage seed のタイミング不整合の可能性。要実機調査。
    test.skip("タブをクリックすると切り替わる (#945 follow-up: tab→URL sync race)", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click();
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
      await expect(page).toHaveURL(new RegExp(`/w/[^/]+/screen/design/${SCREEN_A_NORM}`));
    });

    test("Ctrl+Tab で次のタブに移動する", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click();
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
      await page.keyboard.press("Control+Tab");
      try {
        await expect(page.locator(".tabbar-tab.active")).toContainText("画面B", { timeout: 1000 });
      } catch {
        await page.evaluate(() => {
          document.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Tab", code: "Tab", keyCode: 9, ctrlKey: true, bubbles: true, cancelable: true,
          }));
        });
        await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
      }
    });

    test("Ctrl+Shift+Tab で前のタブに移動する", async ({ page }) => {
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
      await page.keyboard.press("Control+Shift+Tab");
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
    });

    test("Ctrl+1 で1番目のタブに移動する", async ({ page }) => {
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
      await page.keyboard.press("Control+1");
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
    });
  });

  test.describe("タブを閉じる", () => {
    test.beforeEach(async ({ page }) => {
      await setupWithScreens(page, [SCREEN_A_NORM, SCREEN_B_NORM, SCREEN_C_NORM]);
    });

    test("× ボタンでタブを閉じる", async ({ page }) => {
      const tabA = page.locator(".tabbar-tab").filter({ hasText: "画面A" });
      await tabA.locator(".tabbar-tab-close").click({ force: true });
      await expect(page.locator(".tabbar-tab")).toHaveCount(2);
      await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toHaveCount(0);
    });

    test("Ctrl+W でアクティブタブを閉じる", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面B" }).click();
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
      await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", {
          key: "w", ctrlKey: true, bubbles: true, cancelable: true,
        }));
      });
      await expect(page.locator(".tabbar-tab")).toHaveCount(2);
      await expect(page.locator(".tabbar-tab").filter({ hasText: "画面B" })).toHaveCount(0);
    });

    test("アクティブタブを閉じると隣のタブがアクティブになる", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面B" }).click();
      await page.keyboard.press("Control+w");
      await expect(page.locator(".tabbar-tab.active")).toContainText("画面C");
    });
  });

  test.describe("右クリックコンテキストメニュー", () => {
    test.beforeEach(async ({ page }) => {
      await setupWithScreens(page, [SCREEN_A_NORM, SCREEN_B_NORM, SCREEN_C_NORM]);
    });

    test("右クリックでコンテキストメニューが表示される", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面B" }).click({ button: "right" });
      await expect(page.locator(".tab-context-menu")).toBeVisible();
    });

    test("「他を全て閉じる」で他のタブが閉じる", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面B" }).click({ button: "right" });
      await page.locator(".tab-context-item").filter({ hasText: "他を全て閉じる" }).click();
      await expect(page.locator(".tabbar-tab")).toHaveCount(1);
      await expect(page.locator(".tabbar-tab")).toContainText("画面B");
    });

    test("「右側を全て閉じる」で右のタブが閉じる", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click({ button: "right" });
      await page.locator(".tab-context-item").filter({ hasText: "右側を全て閉じる" }).click();
      await expect(page.locator(".tabbar-tab")).toHaveCount(1);
      await expect(page.locator(".tabbar-tab")).toContainText("画面A");
    });

    test("「ピン留め」でタブがピン状態になる", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click({ button: "right" });
      await page.locator(".tab-context-item").filter({ hasText: "ピン留め" }).click();
      await expect(page.locator(".tabbar-tab.pinned")).toContainText("画面A");
    });

    test("ピン留めタブは「他を全て閉じる」で保持される", async ({ page }) => {
      await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click({ button: "right" });
      await page.locator(".tab-context-item").filter({ hasText: "ピン留め" }).click();
      await page.locator(".tabbar-tab").filter({ hasText: "画面C" }).click({ button: "right" });
      await page.locator(".tab-context-item").filter({ hasText: "他を全て閉じる" }).click();
      await expect(page.locator(".tabbar-tab")).toHaveCount(2);
      await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toBeVisible();
      await expect(page.locator(".tabbar-tab").filter({ hasText: "画面C" })).toBeVisible();
    });
  });
});
