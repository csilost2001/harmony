/**
 * 処理フロー一覧 マーカー件数バッジ (#261)
 *
 * カード / 表の両ビューで、各 ProcessFlow の未解決マーカー数が kind 別に表示されることを検証。
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const dummyGroups = [
  {
    id: "ag-with-markers",
    name: "マーカー入り",
    type: "screen",
    actionCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ag-clean",
    name: "マーカーなし",
    type: "batch",
    actionCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const fullGroupWithMarkers = {
  id: "ag-with-markers",
  name: "マーカー入り",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [{ id: "act-1", name: "", trigger: "click", maturity: "draft", responses: [{id:"201-ok",status:201}], steps: [] }],
  markers: [
    { id: "m1", kind: "todo", body: "ここ直して", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
    { id: "m2", kind: "todo", body: "これも", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
    { id: "m3", kind: "question", body: "なぜ?", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
    { id: "m4", kind: "attention", body: "注意", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
    // 解決済は件数に含まれない
    { id: "m5", kind: "todo", body: "処理済", author: "human", createdAt: "2026-04-21T00:00:00.000Z", resolvedAt: "2026-04-21T01:00:00.000Z", resolvedBy: "ai" },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const fullGroupClean = {
  id: "ag-clean",
  name: "マーカーなし",
  type: "batch",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [{ id: "act-2", name: "", trigger: "click", maturity: "draft", responses: [{id:"201-ok",status:201}], steps: [] }],
  markers: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "marker badge test",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: dummyGroups,
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript((data) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(data.project));
    localStorage.setItem(`process-flow-${data.fullMarkers.id}`, JSON.stringify(data.fullMarkers));
    localStorage.setItem(`process-flow-${data.fullClean.id}`, JSON.stringify(data.fullClean));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("list-view-mode:process-flow-list");
  }, { project: dummyProject, fullMarkers: fullGroupWithMarkers, fullClean: fullGroupClean });
  await page.goto("/process-flow/list");
  await expect(page.locator(".process-flow-page")).toBeVisible();
  // マーカー集計は非同期バックグラウンド処理なので待つ
  await expect(page.locator(".process-flow-marker-badges").first()).toBeVisible({ timeout: 10000 });
}

test.describe.skip("処理フロー一覧 マーカー件数バッジ (#261)", () => {
  test("カードビューで marker 件数バッジが kind 別に表示される", async ({ page }) => {
    await setup(page);

    const markerCard = page.locator(".data-list-card").filter({ hasText: "マーカー入り" });
    const cleanCard = page.locator(".data-list-card").filter({ hasText: "マーカーなし" });

    // todo 2 件
    await expect(markerCard.locator(".process-flow-marker-badge.kind-todo")).toContainText("2");
    // question 1 件
    await expect(markerCard.locator(".process-flow-marker-badge.kind-question")).toContainText("1");
    // attention 1 件
    await expect(markerCard.locator(".process-flow-marker-badge.kind-attention")).toContainText("1");
    // chat は 0 件なので表示されない
    await expect(markerCard.locator(".process-flow-marker-badge.kind-chat")).toHaveCount(0);

    // resolved なマーカーはカウントされない (todo の総数が 2 であることで担保)
    // mk5 (resolved) を含めれば 3 になるはず
    await expect(markerCard.locator(".process-flow-marker-badge.kind-todo")).not.toContainText("3");

    // マーカーなしグループには badges 自体が表示されない
    await expect(cleanCard.locator(".process-flow-marker-badges")).toHaveCount(0);
  });

  test("表ビューに マーカー 列が出て、badge が表示される", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "表表示" }).click();

    // ヘッダ "マーカー"
    await expect(page.locator("thead th").filter({ hasText: "マーカー" })).toBeVisible();

    const markerRow = page.locator(".data-list-row").filter({ hasText: "マーカー入り" });
    await expect(markerRow.locator(".process-flow-marker-badge.kind-todo")).toContainText("2");
    await expect(markerRow.locator(".process-flow-marker-badge.kind-question")).toContainText("1");
  });

  test("ヘッダ全体サマリにマーカー合計が表示される", async ({ page }) => {
    await setup(page);
    // 合計: todo 2 + question 1 + attention 1 = 4
    const headerSummary = page.locator(".process-flow-list-header").locator("span[title*='マーカー']");
    await expect(headerSummary).toContainText("4");
  });

  test("「マーカーありのみ」フィルタで marker 入りの AG だけ表示", async ({ page }) => {
    await setup(page);
    // チェックボックス ON → marker 入りのみ残る (ag-clean は非表示)
    await page.locator(".process-flow-list-check-label").filter({ hasText: "マーカーあり" }).click();
    await expect(page.locator(".data-list-card").filter({ hasText: "マーカー入り" })).toBeVisible();
    await expect(page.locator(".data-list-card").filter({ hasText: "マーカーなし" })).toHaveCount(0);
    // FilterBar にラベル表示
    await expect(page.locator(".filter-bar")).toContainText("マーカーあり");
  });
});
