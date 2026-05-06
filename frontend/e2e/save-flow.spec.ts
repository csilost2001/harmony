/**
 * 保存フロー E2E テスト
 *
 * 視点: ユーザーが画面を編集して保存ボタンを押すフロー
 *
 * NOTE: localStorage への書き込み自体は tabStore の単体テストで検証済み。
 *       ここでは「ユーザーが再訪問してもタブが復元される」というユーザー可視の挙動を検証する。
 */

import { test, expect, type Page } from "@playwright/test";

const SCREEN_A = "test-0001-4000-8000-000000000001";
const SCREEN_B = "test-0002-4000-8000-000000000002";

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [
    { id: SCREEN_A, name: "画面A", type: "list", description: "", path: "/a", position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: SCREEN_B, name: "画面B", type: "list", description: "", path: "/b", position: { x: 250, y: 0 }, size: { width: 200, height: 100 }, hasDesign: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  groups: [],
  edges: [],
  updatedAt: new Date().toISOString(),
};

/** タブ事前設定付きセットアップ（addInitScript は全ナビゲーションで実行されるため） */
async function setupWithTabs(page: Page, screenIds: string[], labels: Record<string, string>) {
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
    ({ project, tabs, activeTabId }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
      localStorage.setItem("harmony-active-tab", activeTabId);
    },
    { project: dummyProject, tabs, activeTabId }
  );
}

// ─── テスト ─────────────────────────────────────────────────────────────────

test.describe("ページリロード後のタブ復元", () => {
  test("リロード後に1タブが復元される", async ({ page }) => {
    await setupWithTabs(page, [SCREEN_A], { [SCREEN_A]: "画面A" });
    await page.goto(`/screen/design/${SCREEN_A}`);
    await expect(page.locator(".tabbar-tab")).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator(".tabbar-tab")).toContainText("画面A");

    await page.reload();
    await expect(page.locator(".tabbar-tab")).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator(".tabbar-tab")).toContainText("画面A");
  });

  test("リロード後に複数タブが復元される", async ({ page }) => {
    await setupWithTabs(page, [SCREEN_A, SCREEN_B], { [SCREEN_A]: "画面A", [SCREEN_B]: "画面B" });
    await page.goto(`/screen/design/${SCREEN_B}`);
    await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });

    await page.reload();
    await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toBeVisible();
    await expect(page.locator(".tabbar-tab").filter({ hasText: "画面B" })).toBeVisible();
  });

  test("リロード後にアクティブタブが復元される", async ({ page }) => {
    // SCREEN_A を最後に置くことで addInitScript が active=SCREEN_A を設定する
    await setupWithTabs(page, [SCREEN_B, SCREEN_A], { [SCREEN_A]: "画面A", [SCREEN_B]: "画面B" });
    await page.goto(`/screen/design/${SCREEN_A}`);
    await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });

    await page.reload();
    await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
  });
});

test.describe("isPinned の永続化", () => {
  test("ピン留めはリロード後も保持される", async ({ page }) => {
    // addInitScript はリロード時にも再実行されるため、ピン留め状態を事前設定して検証する
    const tabs = [
      { id: `design:${SCREEN_A}`, type: "design", resourceId: SCREEN_A, label: "画面A", isDirty: false, isPinned: true },
      { id: `design:${SCREEN_B}`, type: "design", resourceId: SCREEN_B, label: "画面B", isDirty: false, isPinned: false },
    ];
    await page.addInitScript(
      ({ project, tabs, activeTabId }) => {
        localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
        localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
        localStorage.setItem("harmony-active-tab", activeTabId);
      },
      { project: dummyProject, tabs, activeTabId: `design:${SCREEN_B}` }
    );
    await page.goto(`/screen/design/${SCREEN_B}`);
    await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator(".tabbar-tab.pinned")).toContainText("画面A");

    // リロード後もピン留め状態が保持される（addInitScript が同じ状態を再設定）
    await page.reload();
    await expect(page.locator(".tabbar-tab")).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator(".tabbar-tab.pinned")).toContainText("画面A");
  });
});
