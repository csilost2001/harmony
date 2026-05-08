/**
 * 画面項目 ID リセット機能 E2E (#334)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   screen items は backend の harmony/screen-items/<id>.json に書き出して
 *   ScreenItemsView から読み込ませる。
 *
 *   注: #696 で per-screen タブ化、screen-items は別ファイル管理。本 spec は
 *   従来の localStorage キー (screen-items-<id>) を使っていたが、backend 経由では
 *   screen-items が dataDir 配下に出る形式 (loadScreenItems の経路) となる。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import fs from "node:fs/promises";
import path from "node:path";

const screenId = "scr-reset-1";

const dummyProject = {
  version: 1,
  name: "screen-items-reset-test",
  screens: [
    { id: screenId, no: 1, name: "リセットテスト画面", kind: "standard" },
  ],
  groups: [], edges: [], tables: [], processFlows: [],
};

const WS_KEY = "issue-926-screen-items-reset";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page, items: Array<{ id: string; label: string; type: string }> = []) {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
  });
  // screen-items は dataDir 配下に書き出す (legacy 互換 path)
  const screenIdNorm = normalizeId(screenId);
  const screenItemsData = {
    $schema: "",
    screenId: screenIdNorm,
    version: "0.1.0",
    updatedAt: new Date().toISOString(),
    items,
  };
  const siFile = path.join(ws.workspacePath, "harmony", "screen-items", `${screenIdNorm}.json`);
  await fs.mkdir(path.dirname(siFile), { recursive: true });
  await fs.writeFile(siFile, JSON.stringify(screenItemsData, null, 2), "utf-8");

  await ws.gotoActive(page, `/screen/items/${screenIdNorm}`);
  await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
  // edit-session-draft (#683) で初期 readonly。「IDをリセット」等のボタンは editing 必須。
  // ResumeOrDiscardDialog が遅延表示する場合があるので 2 秒待機 + dismiss → edit-mode-start
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else {
      break;
    }
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

test.describe("画面項目 ID リセット (#334)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("空 ID の行に「IDをリセット」ボタンが存在する", async ({ page }) => {
    await setup(page, [{ id: "", label: "名前", type: "string" }]);
    const resetBtn = page.locator('button[aria-label="IDをリセット"]').first();
    await expect(resetBtn).toBeVisible();
  });

  test("空 ID の行をリセットすると textInput1 が入力される", async ({ page }) => {
    await setup(page, [{ id: "", label: "名前", type: "string" }]);
    await page.locator('button[aria-label="IDをリセット"]').first().click();
    const idInput = page.locator('.screen-items-table input[placeholder="email"]').first();
    await expect(idInput).toHaveValue("textInput1", { timeout: 3000 });
  });

  test("number 型の空 ID をリセットすると numberInput1 になる", async ({ page }) => {
    await setup(page, [{ id: "", label: "年齢", type: "number" }]);
    await page.locator('button[aria-label="IDをリセット"]').first().click();
    const idInput = page.locator('.screen-items-table input[placeholder="email"]').first();
    await expect(idInput).toHaveValue("numberInput1", { timeout: 3000 });
  });

  test("既存 textInput1 があると次は textInput2 になる", async ({ page }) => {
    await setup(page, [
      { id: "textInput1", label: "項目1", type: "string" },
      { id: "", label: "項目2", type: "string" },
    ]);
    const resetBtns = page.locator('button[aria-label="IDをリセット"]');
    await resetBtns.nth(1).click();
    const idInputs = page.locator('.screen-items-table input[placeholder="email"]');
    await expect(idInputs.nth(1)).toHaveValue("textInput2", { timeout: 3000 });
  });

  test("チェックボックスで行を選択できる", async ({ page }) => {
    await setup(page, [
      { id: "", label: "項目A", type: "string" },
      { id: "", label: "項目B", type: "string" },
    ]);
    const checkboxes = page.locator('.screen-items-table tbody input[type="checkbox"]');
    await checkboxes.first().check();
    await expect(page.locator('button:has-text("選択行のIDをリセット")')).toBeVisible({ timeout: 2000 });
  });

  test("全選択チェックボックスで全行選択 → ボタンに件数が表示される", async ({ page }) => {
    await setup(page, [
      { id: "", label: "項目A", type: "string" },
      { id: "", label: "項目B", type: "number" },
      { id: "", label: "項目C", type: "boolean" },
    ]);
    const selectAll = page.locator('.screen-items-table thead input[type="checkbox"]');
    await selectAll.check();
    await expect(page.locator('button:has-text("選択行のIDをリセット (3 件)")')).toBeVisible({ timeout: 2000 });
  });

  test("複数選択リセットで空 ID 行が一括採番される", async ({ page }) => {
    await setup(page, [
      { id: "", label: "項目A", type: "string" },
      { id: "", label: "項目B", type: "string" },
    ]);
    await page.locator('.screen-items-table thead input[type="checkbox"]').check();
    await page.locator('button:has-text("選択行のIDをリセット")').click();
    const idInputs = page.locator('.screen-items-table input[placeholder="email"]');
    await expect(idInputs.nth(0)).toHaveValue("textInput1", { timeout: 3000 });
    await expect(idInputs.nth(1)).toHaveValue("textInput2", { timeout: 3000 });
  });

  test("ヘッダーチェックボックスの全解除で選択ツールバーが消える", async ({ page }) => {
    await setup(page, [
      { id: "", label: "項目A", type: "string" },
    ]);
    const selectAll = page.locator('.screen-items-table thead input[type="checkbox"]');
    await selectAll.check();
    await expect(page.locator('button:has-text("選択行のIDをリセット")')).toBeVisible();
    await selectAll.uncheck();
    await expect(page.locator('button:has-text("選択行のIDをリセット")')).toHaveCount(0);
  });

  test("未保存変更がある状態でリセットするとアラートが出る", async ({ page }) => {
    await setup(page, [{ id: "userName", label: "ユーザー名", type: "string" }]);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("先に保存")) {
        alertFired = true;
        await dialog.accept();
      }
    });
    await page.locator('button[aria-label="IDをリセット"]').first().click();
    await expect.poll(() => alertFired, { timeout: 3000 }).toBe(true);
  });
});
