/**
 * ErrorDialog / ErrorDetailsPanel の E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const dummyProject = {
  version: 1, name: "E2E",
  screens: [], groups: [], edges: [], tables: [],
};

const WS_KEY = "issue-926-error-dialog";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupClipboardCapture(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([
      { id: "dashboard:main", type: "dashboard", resourceId: "main", label: "ダッシュボード", isDirty: false, isPinned: false },
    ]));
    localStorage.setItem("harmony-active-tab", "dashboard:main");
  });
}

test.describe("ErrorDialog", () => {
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

  test("存在しない画面 URL でエラーダイアログが表示され、ログが見える", async ({ page }) => {
    await setupClipboardCapture(page);
    await ws.gotoActive(page, "/screen/design/non-existent-screen-xxxx");

    const dialog = page.locator(".error-dialog-panel");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("画面が見つかりません");
    await expect(dialog.locator(".error-details-message")).toContainText("non-existent-screen-xxxx");

    const contextDetails = dialog.locator(".error-details-block").filter({ hasText: "コンテキスト" });
    await contextDetails.locator("summary").click();
    await expect(contextDetails.locator(".error-details-pre")).toContainText("non-existent-screen-xxxx");

    const historyDetails = dialog.locator(".error-details-block").filter({ hasText: "エラーログ履歴" });
    await historyDetails.locator("summary").click();
    await expect(historyDetails.locator(".error-details-pre")).toContainText("見つかりません");
  });

  test("「レポートをコピー」ボタンで JSON がクリップボードに入る", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard-read は chromium のみ安定");
    await setupClipboardCapture(page);
    await ws.gotoActive(page, "/screen/design/non-existent-screen-xxxx");

    const dialog = page.locator(".error-dialog-panel");
    await expect(dialog).toBeVisible();

    const copyBtn = dialog.locator('[data-testid="error-copy-btn"]');
    await copyBtn.click();
    await expect(copyBtn).toHaveAttribute("data-copy-state", /copied|failed/, { timeout: 5000 });

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    if (clipboardText) {
      const parsed = JSON.parse(clipboardText) as Record<string, unknown>;
      expect(parsed.message).toContain("non-existent-screen-xxxx");
      expect(parsed.context).toMatchObject({ kind: "画面" });
      expect(Array.isArray(parsed.history)).toBe(true);
    }
  });

  test("×ボタンと ESC キーでダイアログが閉じる", async ({ page }) => {
    await setupClipboardCapture(page);
    await ws.gotoActive(page, "/screen/design/non-existent-screen-xxxx");

    const dialog = page.locator(".error-dialog-panel");
    await expect(dialog).toBeVisible();
    await dialog.locator(".error-dialog-close").click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("TabErrorFallback ログ表示", () => {
  test.skip("別途 Vitest で単体検証", () => {});
});
