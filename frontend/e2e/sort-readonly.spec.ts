/**
 * 一覧のソート中 Read-only モード + No 列永続フィールド — #148
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

const dummyProject = {
  version: 1,
  name: "Sort Readonly Test",
  screens: [
    { id: "s-1", no: 1, name: "Charlie", kind: "other", path: "/c", updatedAt: "2024-03-03T00:00:00Z" },
    { id: "s-2", no: 2, name: "Alpha", kind: "other", path: "/a", updatedAt: "2024-01-01T00:00:00Z" },
    { id: "s-3", no: 3, name: "Echo", kind: "other", path: "/e", updatedAt: "2024-05-05T00:00:00Z" },
    { id: "s-4", no: 4, name: "Bravo", kind: "other", path: "/b", updatedAt: "2024-02-02T00:00:00Z" },
    { id: "s-5", no: 5, name: "Delta", kind: "other", path: "/d", updatedAt: "2024-04-04T00:00:00Z" },
  ],
  groups: [], edges: [], tables: [],
};

const WS_KEY = "issue-926-sort-readonly";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("#148 一覧 ソート中 Read-only + No 列", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
    await page.addInitScript(() => {
      localStorage.setItem("list-view-mode:screen-list", JSON.stringify("table"));
    });
    await ws.gotoActive(page, "/screen/list");
    await expect(page.locator(".screen-list-page")).toBeVisible();
    await expect(page.locator(".data-list-row")).toHaveCount(5);
  });

  test.describe("No 列 (永続フィールド §3.10)", () => {
    test("初期表示の No は配列順で 1..5", async ({ page }) => {
      const nos = await page.locator(".data-list-td-num").allTextContents();
      expect(nos).toEqual(["1", "2", "3", "4", "5"]);
    });

    test("画面名昇順ソート後、No は行と一緒に動く (例: 2, 4, 1, 5, 3)", async ({ page }) => {
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      const nos = await page.locator(".data-list-td-num").allTextContents();
      expect(nos).toEqual(["2", "4", "1", "5", "3"]);
    });

    test("Alt+↓ で並び替え後、No は 1..5 を維持する (draft renumber の回帰防止)", async ({ page }) => {
      await page.locator(".data-list-row").first().click();
      await page.keyboard.press("Alt+ArrowDown");
      const nos = await page.locator(".data-list-td-num").allTextContents();
      expect(nos).toEqual(["1", "2", "3", "4", "5"]);
    });

    test("Ctrl+X → 別行選択 → Ctrl+V 後、No は 1..5 を維持する (draft renumber の回帰防止)", async ({ page }) => {
      await page.locator(".data-list-row").first().click();
      await page.keyboard.press("Control+x");
      await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
      await page.locator(".data-list-row").nth(2).click();
      await page.keyboard.press("Control+v");
      await expect(page.locator(".data-list-row")).toHaveCount(5);
      const nos = await page.locator(".data-list-td-num").allTextContents();
      expect(nos).toEqual(["1", "2", "3", "4", "5"]);
    });
  });

  test.describe("ソート中 Read-only モード (§3.9)", () => {
    test("ソート中は SortBar が表示され、解除で消える", async ({ page }) => {
      await expect(page.locator(".sort-bar")).toBeHidden();
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await expect(page.locator(".sort-bar")).toBeVisible();
      await expect(page.locator(".sort-bar")).toContainText("ソート中");
      await expect(page.locator(".sort-bar")).toContainText("画面名");
      await page.locator(".sort-bar-clear").click();
      await expect(page.locator(".sort-bar")).toBeHidden();
    });

    test("ソート中は D&D ハンドルが disabled (ガード有り)", async ({ page }) => {
      await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(0);
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(5);
      const handleTitle = await page.locator(".data-list-td-handle.disabled").first().getAttribute("title");
      expect(handleTitle).toContain("ソート中は無効");
    });

    test("ソート中は「画面を追加」ボタンが disabled", async ({ page }) => {
      const addBtn = page.getByRole("button", { name: /画面を追加/ });
      await expect(addBtn).toBeEnabled();
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await expect(addBtn).toBeDisabled();
      await page.locator(".sort-bar-clear").click();
      await expect(addBtn).toBeEnabled();
    });

    test("ソート中でも Delete は機能する (位置不要の例外)", async ({ page }) => {
      page.on("dialog", (d) => d.accept());
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await page.locator(".data-list-row").first().click();
      await page.keyboard.press("Delete");
      await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
      await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    });

    test("ソート解除後、新規作成ボタンと D&D ハンドルが復活する", async ({ page }) => {
      const addBtn = page.getByRole("button", { name: /画面を追加/ });
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await expect(addBtn).toBeDisabled();
      await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(5);
      await page.locator(".sort-bar-clear").click();
      await expect(addBtn).toBeEnabled();
      await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(0);
    });
  });
});
