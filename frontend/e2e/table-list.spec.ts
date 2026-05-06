/**
 * テーブル一覧 (/table/list) E2E テスト — #133
 *
 * 仕様 docs/spec/list-common.md に基づく主要操作を検証:
 * - カード/表切替 (§4.3)
 * - 選択 (§3.1) / キーボード操作 (§3.2, 3.3)
 * - ソート (§3.6)
 * - D&D 並び替え + 保存/リセット (§3.5)
 * - 削除 ghost 方式
 */

import { test, expect, type Page } from "@playwright/test";

const dummyTables = [
  { id: "tbl-0001", physicalName: "users", name: "ユーザーマスタ", description: "", category: "マスタ", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "tbl-0002", physicalName: "orders", name: "注文", description: "", category: "トランザクション", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "tbl-0003", physicalName: "products", name: "商品マスタ", description: "", category: "マスタ", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [],
  groups: [],
  edges: [],
  tables: dummyTables,
  updatedAt: new Date().toISOString(),
};

async function setupTableList(page: Page) {
  await page.addInitScript(({ project, tables }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    for (const t of tables) {
      localStorage.setItem(`v3-table-${t.id}`, JSON.stringify({ ...t, columns: [], indexes: [] }));
    }
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("list-view-mode:table-list");
  }, { project: dummyProject, tables: dummyTables });
  await page.goto("/table/list");
  await expect(page.locator(".table-list-page")).toBeVisible();
}

test.describe("テーブル一覧 / 表示切替・検索", () => {
  test("既定はカードレイアウト、ViewModeToggle で表に切替可能", async ({ page }) => {
    await setupTableList(page);
    await expect(page.locator(".tables-data-list.data-list-layout-grid")).toBeVisible();
    await expect(page.locator(".data-list-card")).toHaveCount(3);
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".tables-data-list .data-list-table")).toBeVisible();
    await expect(page.locator(".data-list-row")).toHaveCount(3);
  });

  test("検索で絞り込み、FilterBar 表示", async ({ page }) => {
    await setupTableList(page);
    await page.locator(".table-list-search input").fill("ユーザー");
    await expect(page.locator(".data-list-card")).toHaveCount(1);
    await expect(page.locator(".filter-bar")).toBeVisible();
    await page.locator(".filter-bar-clear").click();
    await expect(page.locator(".data-list-card")).toHaveCount(3);
  });

  test("ダブルクリックで編集画面へ遷移", async ({ page }) => {
    await setupTableList(page);
    const card = page.locator(".data-list-card").first();
    await card.dblclick();
    await expect(page).toHaveURL(/\/w\/[^/]+\/table\/edit\//);
  });
});

test.describe("テーブル一覧 / 選択・キーボード", () => {
  test("クリックで選択、Ctrl+クリックで複数選択", async ({ page }) => {
    await setupTableList(page);
    const cards = page.locator(".data-list-card");
    await cards.nth(0).click();
    await expect(cards.nth(0)).toHaveClass(/selected/);
    await cards.nth(2).click({ modifiers: ["Control"] });
    await expect(cards.nth(0)).toHaveClass(/selected/);
    await expect(cards.nth(2)).toHaveClass(/selected/);
    await expect(cards.nth(1)).not.toHaveClass(/selected/);
  });

  test("Shift+クリックで範囲選択", async ({ page }) => {
    await setupTableList(page);
    const cards = page.locator(".data-list-card");
    await cards.nth(0).click();
    await cards.nth(2).click({ modifiers: ["Shift"] });
    await expect(cards).toHaveClass([/selected/, /selected/, /selected/]);
  });

  test("Ctrl+A で全選択、Esc で選択解除", async ({ page }) => {
    await setupTableList(page);
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Control+a");
    const cards = page.locator(".data-list-card");
    await expect(cards).toHaveClass([/selected/, /selected/, /selected/]);
    await page.keyboard.press("Escape");
    await expect(cards.nth(0)).not.toHaveClass(/selected/);
  });

  test("空領域クリックで選択解除", async ({ page }) => {
    await setupTableList(page);
    await page.locator(".data-list-card").first().click();
    // DataList のルート領域を直接クリック (カードの外側)
    const dataList = page.locator(".tables-data-list");
    const box = await dataList.boundingBox();
    if (!box) throw new Error("data-list boundingBox not found");
    // 右下の余白付近をクリック
    await page.mouse.click(box.x + box.width - 5, box.y + box.height - 5);
    await expect(page.locator(".data-list-card.selected")).toHaveCount(0);
  });
});

test.describe("テーブル一覧 / 保存フロー", () => {
  test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupTableList(page);
    await expect(page.getByTestId("list-save-btn")).toBeDisabled();
    await expect(page.getByTestId("list-reset-btn")).toBeDisabled();
  });

  test("削除マーク後に保存ボタンが有効、ghost 表示になる", async ({ page }) => {
    await setupTableList(page);
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    // ghost クラスが付く
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
    // 保存ボタンが有効化される
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    // タブバーで dirty インジケータが出る
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
  });

  test("リセットで削除マークが取り消される", async ({ page }) => {
    await setupTableList(page);
    page.on("dialog", (d) => d.accept());
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
    await page.getByTestId("list-reset-btn").click();
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(0);
    await expect(page.getByTestId("list-save-btn")).toBeDisabled();
  });

  test("保存後に削除マークが確定され、アイテム数が減る", async ({ page }) => {
    await setupTableList(page);
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    await page.getByTestId("list-save-btn").click();
    // 保存後にカードが 2 件になる
    await expect(page.locator(".data-list-card")).toHaveCount(2);
    await expect(page.getByTestId("list-save-btn")).toBeDisabled();
  });
});

test.describe("テーブル一覧 / ソート", () => {
  test("表モードで列ヘッダクリックでソートが動作し、▲が表示される", async ({ page }) => {
    await setupTableList(page);
    await page.getByRole("button", { name: "表表示" }).click();
    // 物理名列ヘッダをクリック
    await page.locator(".data-list-th-sortable").first().click();
    await expect(page.locator(".data-list-th-sorted")).toHaveCount(1);
    // 列ヘッダの icon だけ絞る (#148 SortBar にも同じ caret アイコンが出るため)
    await expect(page.locator(".data-list-sort-icon.bi-caret-up-fill")).toHaveCount(1);
    // 再クリックで降順
    await page.locator(".data-list-th-sortable").first().click();
    await expect(page.locator(".data-list-sort-icon.bi-caret-down-fill")).toHaveCount(1);
  });
});
