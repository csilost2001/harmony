/**
 * 保存/リセットボタン E2E テスト
 *
 * 視点: ユーザーがテーブルエディタで編集・保存・リセットを行う
 * 前提: dev サーバーが起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 — localStorage でテーブルを直接セットアップ
 */

import { test, expect, type Page } from "@playwright/test";

// ─── テスト用ダミーデータ ───────────────────────────────────────────────────

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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [],
  groups: [],
  edges: [],
  tables: [
    {
      id: TABLE_ID,
      physicalName: "users",
      name: "ユーザーマスタ",
      description: "",
      createdAt: dummyTable.createdAt,
      updatedAt: dummyTable.updatedAt,
    },
  ],
  updatedAt: new Date().toISOString(),
};

const dummyTab = {
  id: `table:${TABLE_ID}`,
  type: "table",
  resourceId: TABLE_ID,
  label: "ユーザーマスタ",
  isDirty: false,
  isPinned: false,
};

async function setupTableEditor(page: Page) {
  await page.addInitScript(
    ({ project, table, tableId, tab }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem(`v3-table-${tableId}`, JSON.stringify(table));
      localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
      localStorage.setItem("harmony-active-tab", tab.id);
      // 前回のテストの下書きを削除
      localStorage.removeItem(`draft-table-${tableId}`);
    },
    { project: dummyProject, table: dummyTable, tableId: TABLE_ID, tab: dummyTab },
  );
  await page.goto(`/table/edit/${TABLE_ID}`);
  // テーブルが読み込まれるまで待機
  await expect(page.locator(".table-editor-page")).toBeVisible();
}

// ─── テスト ────────────────────────────────────────────────────────────────

test.describe("テーブルエディタ：保存/リセットボタン", () => {
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

    // タブに dirty クラスが付与される（オレンジ左ボーダー）
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
    // dirty ドット（●）が表示される
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

    // dialog は click() をブロックするため、handler を先に登録して await しない click と組み合わせる
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

    // キャンセルしたので編集状態が維持されている
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
