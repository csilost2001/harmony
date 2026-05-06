/**
 * MarkerPanel E2E (#261 リアルタイム編集ワークフロー)
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-marker";

const dummyGroup = {
  id: groupId, name: "marker test", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{ id: "act-1", name: "ボタン", trigger: "click", maturity: "draft", steps: [] }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const dummyProject = {
  version: 1, name: "marker", screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, type: dummyGroup.type, actionCount: 1, updatedAt: dummyGroup.updatedAt, maturity: "draft" }],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript(({ project, group }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: dummyGroup });
  await page.goto(`/process-flow/edit/${groupId}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
  // MarkerPanel は既定で折りたたみ (#261 anchor 対応): 明示的に展開する
  await page.locator(".marker-panel .catalog-panel-toggle").click();
  await expect(page.locator(".marker-panel .catalog-panel-body")).toBeVisible();
}

test.describe("MarkerPanel (#261)", () => {
  test("パネル既定折りたたみ、展開後に 0 件メッセージ表示", async ({ page }) => {
    await setup(page);
    // #309 タブバー化以降、.marker-panel は tabbar 側 (toggleOnly) と body 側の 2 箇所に出現
    await expect(page.locator(".marker-panel").first()).toBeVisible();
    await expect(page.locator(".marker-panel .catalog-panel-toggle")).toContainText("0 未解決");
    // setup で展開済 → empty メッセージ可視
    await expect(page.locator(".marker-panel .catalog-empty")).toBeVisible();
  });

  test("新規マーカー追加 (質問 kind)", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel select").selectOption("question");
    await page.locator(".marker-panel .marker-add-row input").fill("この SQL を条件付き UPDATE に書き換えて");
    await page.locator(".marker-panel button:has-text('追加')").click();
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(1);
    await expect(page.locator(".marker-panel .marker-row.marker-kind-question")).toBeVisible();
    await expect(page.locator(".marker-panel .marker-kind-badge")).toContainText("質問");
    await expect(page.locator(".marker-panel .marker-body")).toContainText("条件付き UPDATE");
  });

  test("解決ボタンでインライン解決フォームが開く", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await page.locator(".marker-panel button:has-text('追加')").click();
    // 解決ボタンクリック → フォーム表示
    await page.locator(".marker-panel .marker-resolve-btn").first().click();
    await expect(page.locator(".marker-panel .marker-resolve-form")).toBeVisible();
    await expect(page.locator(".marker-panel .marker-resolve-form textarea")).toBeFocused();
    // まだ resolved 状態にはなっていない
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(0);
  });

  test("解決フォームでメモを記入して 解決 ボタン押下で resolved に", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await page.locator(".marker-panel button:has-text('追加')").click();
    await page.locator(".marker-panel .marker-resolve-btn").first().click();
    await page.locator(".marker-panel .marker-resolve-form textarea").fill("自分で対応済み");
    await page.locator(".marker-panel .marker-resolve-form button:has-text('解決')").click();
    // 既定で解決済み非表示
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(0);
    // 解決済みも表示に切替
    await page.locator(".marker-panel input[type='checkbox']").check();
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(1);
    await expect(page.locator(".marker-panel .marker-resolution")).toContainText("自分で対応済み");
  });

  test("解決フォームで キャンセル 押下でフォームを閉じる (未解決のまま)", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await page.locator(".marker-panel button:has-text('追加')").click();
    await page.locator(".marker-panel .marker-resolve-btn").first().click();
    await page.locator(".marker-panel .marker-resolve-form textarea").fill("中止する");
    await page.locator(".marker-panel .marker-resolve-form button:has-text('キャンセル')").click();
    await expect(page.locator(".marker-panel .marker-resolve-form")).toHaveCount(0);
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(0);
    // 再度開くとメモはクリアされている
    await page.locator(".marker-panel .marker-resolve-btn").first().click();
    await expect(page.locator(".marker-panel .marker-resolve-form textarea")).toHaveValue("");
  });

  test("メモ空のまま解決するとデフォルトメモが入る", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await page.locator(".marker-panel button:has-text('追加')").click();
    await page.locator(".marker-panel .marker-resolve-btn").first().click();
    await page.locator(".marker-panel .marker-resolve-form button:has-text('解決')").click();
    await page.locator(".marker-panel input[type='checkbox']").check();
    await expect(page.locator(".marker-panel .marker-resolution")).toContainText("人間が手動で解決");
  });

  test("解決済み marker の チェック済アイコン押下で未解決に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await page.locator(".marker-panel button:has-text('追加')").click();
    await page.locator(".marker-panel .marker-resolve-btn").first().click();
    await page.locator(".marker-panel .marker-resolve-form button:has-text('解決')").click();
    await page.locator(".marker-panel input[type='checkbox']").check();
    // resolved 状態のチェックアイコンをクリック (unresolve)
    await page.locator(".marker-panel .marker-row.resolved .bi-check-circle-fill").click();
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(0);
  });

  test("削除ボタンで marker 消去", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("消すよ");
    await page.locator(".marker-panel button:has-text('追加')").click();
    await page.locator(".marker-panel .marker-row .bi-trash").click();
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(0);
    await expect(page.locator(".marker-panel .catalog-panel-toggle")).toContainText("0 未解決");
  });

  test("Enter キーで追加", async ({ page }) => {
    await setup(page);
    const input = page.locator(".marker-panel .marker-add-row input");
    await input.fill("Enter で追加");
    await input.press("Enter");
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(1);
  });
});
