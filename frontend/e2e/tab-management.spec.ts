/**
 * タブ管理 E2E テスト
 *
 * 視点: ユーザーがブラウザ上でタブを操作する
 * 前提: dev サーバーが起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 — localStorage でプロジェクトとタブを直接セットアップ
 *
 * 設計方針:
 *   addInitScript は全ナビゲーションで実行されるため、タブ状態も addInitScript で
 *   事前設定する。複数タブが必要なテストは setupWithScreens() を使う。
 */

import { test, expect, type Page } from "@playwright/test";

// ─── テスト用ダミープロジェクトデータ ──────────────────────────────────────

const SCREEN_A = "test-0001-4000-8000-000000000001";
const SCREEN_B = "test-0002-4000-8000-000000000002";
const SCREEN_C = "test-0003-4000-8000-000000000003";

const SCREENS: Record<string, string> = {
  [SCREEN_A]: "画面A",
  [SCREEN_B]: "画面B",
  [SCREEN_C]: "画面C",
};

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: Object.entries(SCREENS).map(([id, name], i) => ({
    id,
    name,
    type: "list",
    description: "",
    path: `/${String.fromCharCode(97 + i)}`,
    position: { x: i * 250, y: 0 },
    size: { width: 200, height: 100 },
    hasDesign: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  groups: [],
  edges: [],
  updatedAt: new Date().toISOString(),
};

/** 指定画面をタブとして addInitScript で事前設定し、最後の画面に goto する */
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

  await page.addInitScript(
    ({ project, tabs, activeTabId }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      // タブを事前設定 — addInitScript は全ナビゲーションで実行されるため
      // ここで設定することで page.goto() をまたいでタブ状態が保持される
      localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
      localStorage.setItem("harmony-active-tab", activeTabId);
    },
    { project: dummyProject, tabs, activeTabId }
  );

  await page.goto(`/screen/design/${screenIds[screenIds.length - 1]}`);
  // タブバーが表示されるまで待機
  await expect(page.locator(".tabbar-tab")).toHaveCount(screenIds.length);
}

// ─── テスト ─────────────────────────────────────────────────────────────────

test.describe("タブ表示", () => {
  test("画面を開くとタブバーが表示される", async ({ page }) => {
    await setupWithScreens(page, [SCREEN_A]);
    await expect(page.locator(".tabbar")).toBeVisible();
    await expect(page.locator(".tabbar-tab")).toHaveCount(1);
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
  });

  test("2枚目の画面を開くと2タブ表示される", async ({ page }) => {
    await setupWithScreens(page, [SCREEN_A, SCREEN_B]);
    await expect(page.locator(".tabbar-tab")).toHaveCount(2);
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
  });
});

test.describe("タブ切り替え", () => {
  test.beforeEach(async ({ page }) => {
    await setupWithScreens(page, [SCREEN_A, SCREEN_B]);
  });

  test("タブをクリックすると切り替わる", async ({ page }) => {
    await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click();
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
    await expect(page).toHaveURL(new RegExp(`/w/[^/]+/screen/design/${SCREEN_A}`));
  });

  test("Ctrl+Tab で次のタブに移動する", async ({ page }) => {
    // 画面A をアクティブにしてから Ctrl+Tab
    await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click();
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
    // page.keyboard.press と document 直接 dispatch の両方を試行:
    // Playwright driver は Ctrl+Tab を通常のブラウザインターセプトから逃がす模様。
    // もし page.keyboard で駄目でも dispatch で確実に document listener に届ける。
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
    // 画面B がアクティブな状態で Ctrl+Shift+Tab
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
    await page.keyboard.press("Control+Shift+Tab");
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
  });

  test("Ctrl+1 で1番目のタブに移動する", async ({ page }) => {
    // 画面B がアクティブな状態で Ctrl+1 → 画面A へ
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面B");
    await page.keyboard.press("Control+1");
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面A");
  });
});

test.describe("タブを閉じる", () => {
  test.beforeEach(async ({ page }) => {
    await setupWithScreens(page, [SCREEN_A, SCREEN_B, SCREEN_C]);
  });

  test("× ボタンでタブを閉じる", async ({ page }) => {
    const tabA = page.locator(".tabbar-tab").filter({ hasText: "画面A" });
    // opacity:0 の close ボタンも force:true でクリック可能
    await tabA.locator(".tabbar-tab-close").click({ force: true });
    await expect(page.locator(".tabbar-tab")).toHaveCount(2);
    await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toHaveCount(0);
  });

  test("Ctrl+W でアクティブタブを閉じる", async ({ page }) => {
    // 画面B をアクティブにして Ctrl+W
    // Ctrl+W はブラウザにインターセプトされる可能性があるため document に直接送出
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
    // 画面B をアクティブにして閉じる → 画面C がアクティブになるはず
    await page.locator(".tabbar-tab").filter({ hasText: "画面B" }).click();
    await page.keyboard.press("Control+w");
    await expect(page.locator(".tabbar-tab.active")).toContainText("画面C");
  });
});

test.describe("右クリックコンテキストメニュー", () => {
  test.beforeEach(async ({ page }) => {
    await setupWithScreens(page, [SCREEN_A, SCREEN_B, SCREEN_C]);
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
    // 画面A をピン留め
    await page.locator(".tabbar-tab").filter({ hasText: "画面A" }).click({ button: "right" });
    await page.locator(".tab-context-item").filter({ hasText: "ピン留め" }).click();

    // 画面C で「他を全て閉じる」
    await page.locator(".tabbar-tab").filter({ hasText: "画面C" }).click({ button: "right" });
    await page.locator(".tab-context-item").filter({ hasText: "他を全て閉じる" }).click();

    // ピン留めの画面A と選択中の画面C が残る
    await expect(page.locator(".tabbar-tab")).toHaveCount(2);
    await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toBeVisible();
    await expect(page.locator(".tabbar-tab").filter({ hasText: "画面C" })).toBeVisible();
  });
});
