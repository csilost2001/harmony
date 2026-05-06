/**
 * 一覧のソート中 Read-only モード + No 列永続フィールド — #148
 *
 * docs/spec/list-common.md §3.9 / §3.10
 *
 * 画面一覧 (/screen/list) を代表として検証。同じ仕様は TableListView / ProcessFlowListView /
 * TableEditor のカラム一覧でも共通部品 (DataList / useListKeyboard / SortBar) 経由で適用される。
 */

import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1,
  name: "Sort Readonly Test",
  screens: [
    // 意図的に alphabetical / updated 順と no が一致しないよう配置
    // 初期 no は配列順で 1..5
    {
      id: "s-1", name: "Charlie", type: "other", description: "", path: "/c",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-03-03T00:00:00Z",
    },
    {
      id: "s-2", name: "Alpha", type: "other", description: "", path: "/a",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "s-3", name: "Echo", type: "other", description: "", path: "/e",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-05-05T00:00:00Z",
    },
    {
      id: "s-4", name: "Bravo", type: "other", description: "", path: "/b",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-02-02T00:00:00Z",
    },
    {
      id: "s-5", name: "Delta", type: "other", description: "", path: "/d",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, hasDesign: false,
      createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-04-04T00:00:00Z",
    },
  ],
  groups: [],
  edges: [],
  tables: [],
  updatedAt: new Date().toISOString(),
};

/** 画面一覧 (表モード) にセットアップ */
async function setupScreenListTable(page: Page) {
  await page.addInitScript((project) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    // 表モードで始める
    localStorage.setItem("list-view-mode:screen-list", JSON.stringify("table"));
  }, dummyProject);
  await page.goto("/screen/list");
  await expect(page.locator(".screen-list-page")).toBeVisible();
  await expect(page.locator(".data-list-row")).toHaveCount(5);
}

test.describe("#148 No 列 (永続フィールド §3.10)", () => {
  test("初期表示の No は配列順で 1..5", async ({ page }) => {
    await setupScreenListTable(page);
    const nos = await page.locator(".data-list-td-num").allTextContents();
    expect(nos).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("画面名昇順ソート後、No は行と一緒に動く (例: 2, 4, 1, 5, 3)", async ({ page }) => {
    await setupScreenListTable(page);
    // 「画面名」列ヘッダをクリックして昇順ソート
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    // Alpha(s-2)/Bravo(s-4)/Charlie(s-1)/Delta(s-5)/Echo(s-3) の順になるはず
    // 元 no は s-1=1, s-2=2, s-3=3, s-4=4, s-5=5 → 並び替え後 no = [2, 4, 1, 5, 3]
    const nos = await page.locator(".data-list-td-num").allTextContents();
    expect(nos).toEqual(["2", "4", "1", "5", "3"]);
  });

  // 以下 2 ケースは commit f8ba1cc で自己発見した「draft 変更時の renumber 漏れ」
  // クラスのバグに対する回帰防止。別 view で editor.setItems を直接呼ぶ経路が
  // 増えた時、同じクラスのバグを自動検知できるようにする。
  test("Alt+↓ で並び替え後、No は 1..5 を維持する (draft renumber の回帰防止)", async ({ page }) => {
    await setupScreenListTable(page);
    // 1 行目 (Charlie, s-1) を選択
    await page.locator(".data-list-row").first().click();
    // Alt+↓ で下へ移動 → [s-2, s-1, s-3, s-4, s-5]
    await page.keyboard.press("Alt+ArrowDown");
    // No は配列順 (= 物理順) と一致し 1..5 連番のまま
    const nos = await page.locator(".data-list-td-num").allTextContents();
    expect(nos).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("Ctrl+X → 別行選択 → Ctrl+V 後、No は 1..5 を維持する (draft renumber の回帰防止)", async ({ page }) => {
    await setupScreenListTable(page);
    // 1 行目 (Charlie, s-1) を選択して切り取り
    await page.locator(".data-list-row").first().click();
    await page.keyboard.press("Control+x");
    await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
    // 3 行目 (Echo, s-3) を選択
    await page.locator(".data-list-row").nth(2).click();
    // 貼り付け → s-1 が s-3 の直後に挿入される
    await page.keyboard.press("Control+v");
    // 5 行のまま (cut→paste は移動)
    await expect(page.locator(".data-list-row")).toHaveCount(5);
    // No は配列順 (= 物理順) と一致し 1..5 連番のまま
    const nos = await page.locator(".data-list-td-num").allTextContents();
    expect(nos).toEqual(["1", "2", "3", "4", "5"]);
  });
});

test.describe("#148 ソート中 Read-only モード (§3.9)", () => {
  test("ソート中は SortBar が表示され、解除で消える", async ({ page }) => {
    await setupScreenListTable(page);
    await expect(page.locator(".sort-bar")).toBeHidden();
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    await expect(page.locator(".sort-bar")).toBeVisible();
    await expect(page.locator(".sort-bar")).toContainText("ソート中");
    await expect(page.locator(".sort-bar")).toContainText("画面名");
    // 「ソート解除」ボタン
    await page.locator(".sort-bar-clear").click();
    await expect(page.locator(".sort-bar")).toBeHidden();
  });

  test("ソート中は D&D ハンドルが disabled (ガード有り)", async ({ page }) => {
    await setupScreenListTable(page);
    await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(0);
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(5);
    const handleTitle = await page.locator(".data-list-td-handle.disabled").first().getAttribute("title");
    expect(handleTitle).toContain("ソート中は無効");
  });

  test("ソート中は「画面を追加」ボタンが disabled", async ({ page }) => {
    await setupScreenListTable(page);
    const addBtn = page.getByRole("button", { name: /画面を追加/ });
    await expect(addBtn).toBeEnabled();
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    await expect(addBtn).toBeDisabled();
    await page.locator(".sort-bar-clear").click();
    await expect(addBtn).toBeEnabled();
  });

  test("ソート中でも Delete は機能する (位置不要の例外)", async ({ page }) => {
    await setupScreenListTable(page);
    page.on("dialog", (d) => d.accept());
    // ソートを有効化
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    // 1 行クリックして選択
    await page.locator(".data-list-row").first().click();
    // Delete キーで ghost 化する (§3.9 Delete は例外で有効)
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
    // 保存ボタンが有効化される
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
  });

  test("ソート解除後、新規作成ボタンと D&D ハンドルが復活する", async ({ page }) => {
    await setupScreenListTable(page);
    const addBtn = page.getByRole("button", { name: /画面を追加/ });
    await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
    await expect(addBtn).toBeDisabled();
    await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(5);
    await page.locator(".sort-bar-clear").click();
    await expect(addBtn).toBeEnabled();
    await expect(page.locator(".data-list-td-handle.disabled")).toHaveCount(0);
  });
});
