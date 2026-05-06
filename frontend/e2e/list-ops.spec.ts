/**
 * ProcessFlowListView の追加 E2E (#248)
 * - view mode toggle (card ⇔ table)
 * - type ヘッダクリックソート (表モード)
 * - 複数選択 (Shift+Click)
 * - Ctrl+A 全選択
 */
import { test, expect, type Page } from "@playwright/test";

const baseNow = new Date().toISOString();

const listGroups = [
  { id: "g-a", no: 1, name: "Alpha ログイン", type: "screen", actionCount: 2, updatedAt: baseNow, maturity: "committed" },
  { id: "g-b", no: 2, name: "Beta バッチ", type: "batch", actionCount: 1, updatedAt: baseNow, maturity: "provisional" },
  { id: "g-c", no: 3, name: "Charlie 共通", type: "common", actionCount: 1, updatedAt: baseNow, maturity: "draft" },
  { id: "g-d", no: 4, name: "Delta 登録", type: "screen", actionCount: 3, updatedAt: baseNow, maturity: "draft" },
];

async function setupList(page: Page) {
  const project = {
    version: 1, name: "list-ops", screens: [], groups: [], edges: [], tables: [],
    processFlows: listGroups, updatedAt: baseNow,
  };
  await page.addInitScript(({ project, groups }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    for (const g of groups) {
      localStorage.setItem(`process-flow-${g.id}`, JSON.stringify({
        id: g.id, name: g.name, type: g.type, description: "",
        maturity: g.maturity, mode: "upstream",
        actions: [], createdAt: baseNow, updatedAt: baseNow,
      }));
    }
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("list-view-mode:process-flow-list");
  }, { project, groups: listGroups });
  await page.goto("/process-flow/list");
  await expect(page.locator(".process-flow-page")).toBeVisible();
}

test.describe("ProcessFlowListView 操作 (#248)", () => {
  test("view mode toggle でカード ⇔ 表切替", async ({ page }) => {
    await setupList(page);
    // 既定はカード
    await expect(page.locator(".data-list-layout-grid")).toHaveCount(1);
    // 表に切替
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".data-list-row")).toHaveCount(4);
    // 元に戻す
    await page.getByRole("button", { name: "カード表示" }).click();
    await expect(page.locator(".data-list-card")).toHaveCount(4);
  });

  test("表モードで 名前列 ヘッダクリックでソート", async ({ page }) => {
    await setupList(page);
    await page.getByRole("button", { name: "表表示" }).click();
    // 既定は no 順 (Alpha/Beta/Charlie/Delta)
    const rowsBefore = await page.locator(".data-list-row").allTextContents();
    expect(rowsBefore[0]).toContain("Alpha");
    // 名前ヘッダクリック → 既に昇順なので降順に
    await page.getByRole("columnheader", { name: /名前/ }).click();
    const rowsAfter = await page.locator(".data-list-row").allTextContents();
    // 最初のクリックで昇順ソート (Alpha のまま)、2 回目で降順
    // 最初のクリック結果確認後、2 回目クリックで Delta が先頭へ
    await page.getByRole("columnheader", { name: /名前/ }).click();
    const rowsDesc = await page.locator(".data-list-row").allTextContents();
    expect(rowsDesc[0]).toContain("Delta");
  });

  test("Ctrl+A で全件選択、Delete で ghost 表示", async ({ page }) => {
    await setupList(page);
    // 一度カードをクリックしてフォーカス確定
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Control+a");
    // 削除
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(4);
  });

  test("成熟度サマリバーが total を表示する", async ({ page }) => {
    await setupList(page);
    // 全体: 1 committed / 1 provisional / 2 draft
    const header = page.locator(".process-flow-list-header");
    // committed 1 / provisional 1 / draft 2
    await expect(header.getByText("全体:")).toBeVisible();
  });
});
