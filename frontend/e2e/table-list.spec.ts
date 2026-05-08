/**
 * テーブル一覧 (/table/list) E2E テスト — #133
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const dummyTables = [
  { id: "tbl-0001", physicalName: "users", name: "ユーザーマスタ", category: "マスタ", columns: [], indexes: [], constraints: [] },
  { id: "tbl-0002", physicalName: "orders", name: "注文", category: "トランザクション", columns: [], indexes: [], constraints: [] },
  { id: "tbl-0003", physicalName: "products", name: "商品マスタ", category: "マスタ", columns: [], indexes: [], constraints: [] },
];

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [],
  groups: [],
  edges: [],
  tables: dummyTables,
};

const WS_KEY = "issue-926-table-list";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("テーブル一覧", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      tables: dummyTables,
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible();
  });

  test.describe("表示切替・検索", () => {
    test("既定はカードレイアウト、ViewModeToggle で表に切替可能", async ({ page }) => {
      await expect(page.locator(".tables-data-list.data-list-layout-grid")).toBeVisible();
      // backend 取得待ち
      await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator(".data-list-card")).toHaveCount(3);
      await page.getByRole("button", { name: "表表示" }).click();
      await expect(page.locator(".tables-data-list .data-list-table")).toBeVisible();
      await expect(page.locator(".data-list-row")).toHaveCount(3);
    });

    test("検索で絞り込み、FilterBar 表示", async ({ page }) => {
      await page.locator(".table-list-search input").fill("ユーザー");
      await expect(page.locator(".data-list-card")).toHaveCount(1);
      await expect(page.locator(".filter-bar")).toBeVisible();
      await page.locator(".filter-bar-clear").click();
      await expect(page.locator(".data-list-card")).toHaveCount(3);
    });

    test("ダブルクリックで編集画面へ遷移", async ({ page }) => {
      const card = page.locator(".data-list-card").first();
      await expect(card).toBeVisible({ timeout: 10000 });
      await card.dblclick();
      await expect(page).toHaveURL(/\/w\/[^/]+\/table\/edit\//);
    });
  });

  test.describe("選択・キーボード", () => {
    test("クリックで選択、Ctrl+クリックで複数選択", async ({ page }) => {
      const cards = page.locator(".data-list-card");
      await cards.nth(0).click();
      await expect(cards.nth(0)).toHaveClass(/selected/);
      await cards.nth(2).click({ modifiers: ["Control"] });
      await expect(cards.nth(0)).toHaveClass(/selected/);
      await expect(cards.nth(2)).toHaveClass(/selected/);
      await expect(cards.nth(1)).not.toHaveClass(/selected/);
    });

    test("Shift+クリックで範囲選択", async ({ page }) => {
      const cards = page.locator(".data-list-card");
      await cards.nth(0).click();
      await cards.nth(2).click({ modifiers: ["Shift"] });
      await expect(cards).toHaveClass([/selected/, /selected/, /selected/]);
    });

    test("Ctrl+A で全選択、Esc で選択解除", async ({ page }) => {
      // backend 取得待ち
      await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
      await page.locator(".data-list-card").first().click();
      await page.keyboard.press("Control+a");
      const cards = page.locator(".data-list-card");
      await expect(cards).toHaveClass([/selected/, /selected/, /selected/]);
      await page.keyboard.press("Escape");
      await expect(cards.nth(0)).not.toHaveClass(/selected/);
    });

    test("空領域クリックで選択解除", async ({ page }) => {
      // backend 取得待ち
      await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
      await page.locator(".data-list-card").first().click();
      const dataList = page.locator(".tables-data-list");
      const box = await dataList.boundingBox();
      if (!box) throw new Error("data-list boundingBox not found");
      await page.mouse.click(box.x + box.width - 5, box.y + box.height - 5);
      await expect(page.locator(".data-list-card.selected")).toHaveCount(0);
    });
  });

  test.describe("保存フロー", () => {
    test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
      await expect(page.getByTestId("list-save-btn")).toBeDisabled();
      await expect(page.getByTestId("list-reset-btn")).toBeDisabled();
    });

    test("削除マーク後に保存ボタンが有効、ghost 表示になる", async ({ page }) => {
      await page.locator(".data-list-card").first().click();
      await page.keyboard.press("Delete");
      await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
      await expect(page.getByTestId("list-save-btn")).toBeEnabled();
      await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
    });

    test("リセットで削除マークが取り消される", async ({ page }) => {
      page.on("dialog", (d) => d.accept());
      await page.locator(".data-list-card").first().click();
      await page.keyboard.press("Delete");
      await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
      await page.getByTestId("list-reset-btn").click();
      await expect(page.locator(".data-list-card.ghost")).toHaveCount(0);
      await expect(page.getByTestId("list-save-btn")).toBeDisabled();
    });

    test("保存後に削除マークが確定され、アイテム数が減る", async ({ page }) => {
      await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
      await page.locator(".data-list-card").first().click();
      await page.keyboard.press("Delete");
      await page.getByTestId("list-save-btn").click();
      await expect(page.locator(".data-list-card")).toHaveCount(2);
      await expect(page.getByTestId("list-save-btn")).toBeDisabled();
    });
  });

  test.describe("ソート", () => {
    test("表モードで列ヘッダクリックでソートが動作し、▲が表示される", async ({ page }) => {
      await page.getByRole("button", { name: "表表示" }).click();
      await page.locator(".data-list-th-sortable").first().click();
      await expect(page.locator(".data-list-th-sorted")).toHaveCount(1);
      await expect(page.locator(".data-list-sort-icon.bi-caret-up-fill")).toHaveCount(1);
      await page.locator(".data-list-th-sortable").first().click();
      await expect(page.locator(".data-list-sort-icon.bi-caret-down-fill")).toHaveCount(1);
    });
  });
});
