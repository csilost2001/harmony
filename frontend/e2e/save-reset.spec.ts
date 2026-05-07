/**
 * 保存/リセットボタン E2E テスト
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

const TABLE_ID = "test-table-0001-4000-8000-000000000001";

const dummyTable = {
  id: TABLE_ID,
  physicalName: "users",
  name: "ユーザーマスタ",
  description: "",
  category: "マスタ",
  columns: [
    {
      id: "col-0001",
      physicalName: "id",
      name: "ユーザーID",
      dataType: "INTEGER",
      notNull: true,
      primaryKey: true,
      unique: false,
      autoIncrement: true,
    },
  ],
  indexes: [],
  constraints: [],
};

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [], groups: [], edges: [],
  tables: [
    { id: TABLE_ID, no: 1, physicalName: "users", name: "ユーザーマスタ", category: "マスタ", columnCount: 1 },
  ],
};

const TABLE_NORM = normalizeId(TABLE_ID);
const dummyTab = {
  id: `table:${TABLE_NORM}`,
  type: "table",
  resourceId: TABLE_NORM,
  label: "ユーザーマスタ",
  isDirty: false,
  isPinned: false,
};

const WS_KEY = "issue-926-save-reset";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupTableEditor(page: Page): Promise<void> {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    tables: [dummyTable],
  });
  await page.addInitScript((tab) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
    // 前回のテストの draft を削除
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("draft-table-")) localStorage.removeItem(k);
    }
  }, dummyTab);
  await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
  await expect(page.locator(".table-editor-page")).toBeVisible();
}

test.describe("テーブルエディタ：保存/リセットボタン", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupTableEditor(page);
    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeDisabled();
  });

  test("カラム追加後に保存・リセットボタンが有効になる", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeEnabled();
  });

  test("変更後にタブの dirty インジケーターが表示される", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
    await expect(page.locator(".tabbar-tab-dirty")).toBeVisible();
  });

  test("リセット後に保存・リセットボタンが無効に戻る", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await page.getByRole("button", { name: /リセット/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeDisabled();
  });

  test("リセット後に dirty インジケーターが消える", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
    await page.getByRole("button", { name: /リセット/ }).click();
    await expect(page.locator(".tabbar-tab.dirty")).not.toBeVisible();
  });

  test("リセットクリックで確認ダイアログが表示される", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    let dialogType = "";
    let dialogMessage = "";
    page.once("dialog", async (d) => {
      dialogType = d.type();
      dialogMessage = d.message();
      await d.dismiss();
    });
    await page.getByRole("button", { name: /リセット/ }).click();
    expect(dialogType).toBe("confirm");
    expect(dialogMessage).toContain("保存済み状態に戻します");
  });

  test("確認ダイアログをキャンセルすると編集状態が保持される", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await page.getByRole("button", { name: /リセット/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeEnabled();
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
  });

  test("確認ダイアログを承認するとリセットが実行される", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await page.getByRole("button", { name: /リセット/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
    await expect(page.locator(".tabbar-tab.dirty")).not.toBeVisible();
  });

  test("Ctrl+S で保存が実行されて保存ボタンが無効に戻る", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
  });
});
