/**
 * 画面項目 ID リセット機能 E2E (#334)
 *
 * 本ファイルでは MCP 未接続 (localStorage のみ) の経路を検証する:
 * - 空 ID 行のリセット → 即時ローカル更新 (toLocalSet パス)
 * - 非空 ID 行で MCP 未接続 → catch ブロックでローカル更新
 * - 複数選択リセット / 全選択 / 未保存ガード
 *
 * MCP 接続済みの renameScreenItem 成功パス (参照なし / 参照あり確認ダイアログ) は
 * frontend/e2e/mcp/ 配下の MCP E2E テストでカバーする想定。
 */
import { test, expect, type Page } from "@playwright/test";

const screenId = "scr-reset-1";

const dummyProject = {
  version: 1,
  name: "screen-items-reset-test",
  screens: [
    { id: screenId, no: 1, name: "リセットテスト画面", type: "standard", updatedAt: new Date().toISOString() },
  ],
  groups: [], edges: [], tables: [], processFlows: [],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page, items: Array<{ id: string; label: string; type: string }> = []) {
  const screenItemsData = {
    $schema: "",
    screenId,
    version: "0.1.0",
    updatedAt: new Date().toISOString(),
    items,
  };
  await page.addInitScript(({ project, siData, siKey }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(siKey, JSON.stringify(siData));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, {
    project: dummyProject,
    siData: screenItemsData,
    siKey: `screen-items-${screenId}`,
  });
  await page.goto(`/w/ws-e2e/screen/items/${screenId}`);
  await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
}

test.describe("画面項目 ID リセット (#334)", () => {
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
    // 2 行目のリセット
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
    // 「選択行のIDをリセット」ボタンが出現
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
    // 全選択
    await page.locator('.screen-items-table thead input[type="checkbox"]').check();
    // リセット実行
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
    // 項目を追加して dirty にする
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // isDirty = true のはず → アラートを確認
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
