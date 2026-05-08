import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const WS_KEY = "issue-926-extensions-panel";
const dummyProject = { version: 1, name: "ext-panel", screens: [], groups: [], edges: [], tables: [], processFlows: [] };
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("拡張管理 UI (#447)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });
  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test("5 種別タブを切り替えられる", async ({ page }) => {
    await ws.gotoActive(page, "/extensions");
    await expect(page.getByRole("heading", { name: "拡張管理" })).toBeVisible();

    for (const name of ["ステップ型", "フィールド型", "トリガー", "DB 操作", "レスポンス型"]) {
      await page.getByRole("tab", { name: new RegExp(name) }).click();
      await expect(page.getByRole("tab", { name: new RegExp(name) })).toHaveAttribute("aria-selected", "true");
    }
  });

  test("レスポンス型を追加して保存できる", async ({ page }) => {
    await ws.gotoActive(page, "/extensions?tab=responseTypes");
    // ResumeOrDiscardDialog dismiss
    await page.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }
    // edit-mode-start 経由で編集モードに入る (#683) — editing 遷移確認
    const editStart = page.getByTestId("edit-mode-start");
    if (await editStart.isVisible({ timeout: 10000 }).catch(() => false)) {
      await editStart.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole("button", { name: "追加" }).click();
    await page.getByPlaceholder("ApiError").last().fill("E2EResponse");
    await page.locator(".response-type-schema").last().fill('{"type":"object","properties":{"code":{"type":"string"}}}');
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました。")).toBeVisible({ timeout: 10000 });
    await expect(page.getByDisplayValue("E2EResponse")).toBeVisible();
  });
});
