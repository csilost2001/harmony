/**
 * 一覧の削除 UI 統一 — #147
 *
 * docs/spec/list-common.md §3.11 (操作) / §4.6 (見た目) / §5.10 (API)
 *
 * 画面一覧 (/screen/list) を代表として検証。同じ動作は TableListView /
 * ProcessFlowListView / TableEditor のカラム一覧でも共通部品経由で適用される。
 */

import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1,
  name: "Delete UI Test",
  screens: [
    {
      id: "s-1", name: "画面A", type: "other", description: "", path: "/a",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "s-2", name: "画面B", type: "other", description: "", path: "/b",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "s-3", name: "画面C", type: "other", description: "", path: "/c",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  groups: [],
  edges: [],
  tables: [],
  updatedAt: new Date().toISOString(),
};

async function setupScreenListTable(page: Page) {
  await page.addInitScript((project) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.setItem("list-view-mode:screen-list", JSON.stringify("table"));
  }, dummyProject);
  await page.goto("/screen/list");
  await expect(page.locator(".screen-list-page")).toBeVisible();
  await expect(page.locator(".data-list-row")).toHaveCount(3);
}

test.describe("#147 行ゴミ箱アイコン (§3.11 / §4.6)", () => {
  test("各行に行ゴミ箱ボタンが存在する (ホバーで表示)", async ({ page }) => {
    await setupScreenListTable(page);
    // DOM 上は存在する (CSS opacity 0 でデフォルト非表示)
    await expect(page.locator(".data-list-td-row-delete")).toHaveCount(3);
  });

  test("行ゴミ箱クリックでその行が ghost 化、保存ボタン有効化", async ({ page }) => {
    await setupScreenListTable(page);
    // 1 行目のゴミ箱をクリック (force で opacity:0 をバイパス)
    await page.locator(".data-list-row").first().locator(".data-list-td-row-delete").click({ force: true });
    await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
  });
});

test.describe("#147 上部削除ボタン (§3.11 / §4.6)", () => {
  test("選択ゼロ時は disabled 常駐", async ({ page }) => {
    await setupScreenListTable(page);
    // ページヘッダ内の削除ボタン (.screen-list-header 配下に限定)
    const deleteBtn = page.locator(".screen-list-header button", { hasText: "削除" });
    await expect(deleteBtn).toBeVisible();
    await expect(deleteBtn).toBeDisabled();
  });

  test("選択すると有効化され、件数が表示される", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-row").first().click();
    const deleteBtn = page.getByRole("button", { name: /削除 \(1\)/ });
    await expect(deleteBtn).toBeEnabled();
  });

  test("上部削除ボタンで複数選択を一括 ghost 化", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-row").first().click();
    await page.locator(".data-list-row").nth(2).click({ modifiers: ["Control"] });
    await page.getByRole("button", { name: /削除 \(2\)/ }).click();
    await expect(page.locator(".data-list-row.ghost")).toHaveCount(2);
  });
});

test.describe("#147 右クリックメニュー (§3.11 / §4.6 / §5.10)", () => {
  test("行を右クリックするとメニューが開き、全項目が表示される", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-row").first().click({ button: "right" });
    const menu = page.locator(".list-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("新規作成");
    await expect(menu).toContainText("コピー");
    await expect(menu).toContainText("切り取り");
    await expect(menu).toContainText("貼り付け");
    await expect(menu).toContainText("複製");
    await expect(menu).toContainText("削除");
    // separator が 3 個 (新規作成 | クリップボード | 複製 | 削除 の 3 境界)
    await expect(menu.locator("[role='separator']")).toHaveCount(3);
  });

  test("Esc キーでメニューが閉じる", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-row").first().click({ button: "right" });
    await expect(page.locator(".list-context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".list-context-menu")).toBeHidden();
  });

  test("右クリックメニューの「削除」で ghost 化", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-row").first().click({ button: "right" });
    await page.locator(".list-context-menu-item", { hasText: "削除" }).click();
    await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
  });

  test("空領域の右クリックは「新規作成」のみの絞り込みメニュー", async ({ page }) => {
    // 0 件プロジェクトで .data-list-empty を明示的に右クリック (位置ずれによる偽陽性を避ける)
    const emptyProject = { ...dummyProject, screens: [] };
    await page.addInitScript((project) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
      localStorage.setItem("list-view-mode:screen-list", JSON.stringify("table"));
    }, emptyProject);
    await page.goto("/screen/list");
    await expect(page.locator(".data-list-empty")).toBeVisible();
    await page.locator(".data-list-empty").click({ button: "right" });
    const menu = page.locator(".list-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".list-context-menu-item")).toHaveCount(1);
    await expect(menu).toContainText("新規作成");
  });
});

test.describe("#147 ソート中の右クリックメニュー (§3.9 / §3.11 整合)", () => {
  test("ソート中は「新規作成 / 貼り付け / 複製」が disabled、「削除 / コピー / 切り取り」は有効", async ({ page }) => {
    await setupScreenListTable(page);
    // 画面名列でソート
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    // 行を右クリック
    await page.locator(".data-list-row").first().click({ button: "right" });
    const menu = page.locator(".list-context-menu");
    await expect(menu).toBeVisible();

    // disabled 項目
    const newItem = menu.locator(".list-context-menu-item", { hasText: "新規作成" });
    const pasteItem = menu.locator(".list-context-menu-item", { hasText: "貼り付け" });
    const duplicateItem = menu.locator(".list-context-menu-item", { hasText: "複製" });
    await expect(newItem).toBeDisabled();
    await expect(pasteItem).toBeDisabled();
    await expect(duplicateItem).toBeDisabled();

    // 有効項目
    const copyItem = menu.locator(".list-context-menu-item", { hasText: "コピー" });
    const cutItem = menu.locator(".list-context-menu-item", { hasText: "切り取り" });
    const deleteItem = menu.locator(".list-context-menu-item", { hasText: "削除" });
    await expect(copyItem).toBeEnabled();
    await expect(cutItem).toBeEnabled();
    await expect(deleteItem).toBeEnabled();
  });

  test("ソート中でも行ゴミ箱 / 上部削除ボタンは有効 (Delete は §3.9 の例外)", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    // 行ゴミ箱で削除
    await page.locator(".data-list-row").first().locator(".data-list-td-row-delete").click({ force: true });
    await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
    // 上部削除ボタン (1 件選択後)
    await page.locator(".data-list-row").nth(1).click();
    await expect(page.getByRole("button", { name: /削除 \(1\)/ })).toBeEnabled();
  });
});

test.describe("#147 キーボード代替 (§3.11)", () => {
  test("Shift+F10 でコンテキストメニューが開く", async ({ page }) => {
    await setupScreenListTable(page);
    // 1 行目を選択
    await page.locator(".data-list-row").first().click();
    // Shift+F10 で右クリックメニュー相当
    await page.keyboard.press("Shift+F10");
    const menu = page.locator(".list-context-menu");
    await expect(menu).toBeVisible();
    // Esc で閉じる
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("ContextMenu キーでコンテキストメニューが開く", async ({ page }) => {
    await setupScreenListTable(page);
    await page.locator(".data-list-row").first().click();
    await page.keyboard.press("ContextMenu");
    await expect(page.locator(".list-context-menu")).toBeVisible();
  });
});
