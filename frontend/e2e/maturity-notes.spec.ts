/**
 * 成熟度・付箋・モード UI の E2E テスト (#238)
 *
 * カバー範囲:
 * - ステップ成熟度バッジの表示
 * - 成熟度クリックで循環切替 (draft → provisional → committed → draft)
 * - 付箋の追加・削除
 * - グループ成熟度バッジ (ProcessFlowListView)
 * - mode 切替 (upstream/downstream)
 * - ProcessFlowListView の maturity フィルタ
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-maturity-test";

const dummyGroup = {
  id: groupId,
  name: "成熟度テスト用",
  type: "screen",
  description: "E2E テスト用",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-1",
      name: "ボタン A",
      trigger: "click",
      maturity: "draft",
      steps: [
        {
          id: "step-1",
          type: "validation",
          description: "入力チェック",
          conditions: "必須",
          maturity: "draft",
        },
        {
          id: "step-2",
          type: "dbAccess",
          description: "ユーザー検索",
          tableName: "users",
          operation: "SELECT",
          maturity: "provisional",
        },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "maturity-test",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [
    {
      id: groupId,
      no: 1,
      name: dummyGroup.name,
      type: dummyGroup.type,
      actionCount: 1,
      updatedAt: dummyGroup.updatedAt,
      maturity: dummyGroup.maturity,
    },
  ],
  updatedAt: new Date().toISOString(),
};

async function setupEditor(page: Page) {
  await page.addInitScript(({ project, group }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: dummyGroup });
  await page.goto(`/process-flow/edit/${groupId}`);
  await expect(page.locator(".process-flow-editor")).toBeVisible({ timeout: 10000 }).catch(async () => {
    // 別の top-level class を試す (フェイルセーフ)
    await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 5000 });
  });
}

async function setupList(page: Page) {
  const moreGroups = [
    { ...dummyProject.processFlows[0] },
    {
      id: "ag-committed",
      no: 2,
      name: "確定フロー",
      type: "screen",
      actionCount: 1,
      updatedAt: new Date().toISOString(),
      maturity: "committed",
    },
    {
      id: "ag-provisional",
      no: 3,
      name: "暫定フロー",
      type: "batch",
      actionCount: 1,
      updatedAt: new Date().toISOString(),
      maturity: "provisional",
    },
  ];
  const project = { ...dummyProject, processFlows: moreGroups };
  await page.addInitScript(({ project, groups }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    for (const g of groups) {
      localStorage.setItem(`process-flow-${g.id}`, JSON.stringify({
        id: g.id, name: g.name, type: g.type, description: "",
        maturity: g.maturity, mode: "upstream",
        actions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }));
    }
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
    localStorage.removeItem("list-view-mode:process-flow-list");
  }, { project, groups: moreGroups });
  await page.goto("/process-flow/list");
  await expect(page.locator(".process-flow-page")).toBeVisible();
}

test.describe.skip("成熟度バッジ (#185/#189)", () => {
  test("ステップカードに maturity バッジが表示される", async ({ page }) => {
    await setupEditor(page);
    // アクションタブが開いており、ステップが表示されている
    const firstStepCard = page.locator("[data-testid='data-list-row'], .step-card").first();
    // MaturityBadge は role=button または span (onChange 渡しているので role=button)
    const badges = page.locator(".maturity-badge");
    await expect(badges.first()).toBeVisible();
  });

  test("成熟度バッジクリックで循環切替 (draft → provisional → committed → draft)", async ({ page }) => {
    await setupEditor(page);
    // step-1 (draft) の最初のバッジをクリック
    const firstBadge = page.locator(".step-card .maturity-badge.editable").first();
    await expect(firstBadge).toBeVisible();
    // クリック前: draft の色 (#f59e0b)
    await firstBadge.click();
    // クリック後の title 属性が provisional になっていることを期待
    // title には "(クリックで切替)" が含まれる
    await expect(firstBadge).toHaveAttribute("title", /暫定|provisional/);
    await firstBadge.click();
    await expect(firstBadge).toHaveAttribute("title", /確定|committed/);
    await firstBadge.click();
    await expect(firstBadge).toHaveAttribute("title", /下書き|draft/);
  });
});

test.describe.skip("付箋 (#195/#199)", () => {
  test("ステップを展開して付箋を追加できる、件数バッジが出る", async ({ page }) => {
    await setupEditor(page);
    // 最初のステップカードのヘッダをクリックして展開
    const firstCard = page.locator(".step-card").first();
    const header = firstCard.locator(".step-card-header, .step-card-body").first();
    // step-card の上部 (type-label 付近) をクリックで展開
    await firstCard.locator(".step-card-type-label").first().click();
    // 付箋を追加ボタンが見える
    const addButton = firstCard.locator("button", { hasText: "付箋を追加" }).first();
    await addButton.click();
    // type select + body input が表示
    const bodyInput = firstCard.locator('input[placeholder*="付箋の本文"]').first();
    await expect(bodyInput).toBeVisible();
    await bodyInput.fill("E2E テスト付箋");
    // Enter で追加
    await bodyInput.press("Enter");
    // 付箋リストに "E2E テスト付箋" が現れる
    await expect(firstCard.locator("textarea", { hasText: "E2E テスト付箋" })).toBeVisible();
  });
});

test.describe.skip("モード切替 + 下流警告 (#191/#197)", () => {
  test("モードを下流に切り替えると warning が表示される (draft あり)", async ({ page }) => {
    await setupEditor(page);
    // 下流ボタンを押す
    await page.getByRole("button", { name: /下流/ }).click();
    // 警告バナー出現
    await expect(page.getByRole("alert").filter({ hasText: "下流モードで未確定" })).toBeVisible();
  });
});

test.describe.skip("処理フロー一覧のカード成熟度 + フィルタ (#187/#219/#233)", () => {
  test("カードに maturity バッジが表示される", async ({ page }) => {
    await setupList(page);
    // 各カード内に .maturity-badge がある
    const cards = page.locator(".data-list-card");
    await expect(cards.first().locator(".maturity-badge")).toBeVisible();
  });

  test("成熟度フィルタで絞り込める (committed のみ)", async ({ page }) => {
    await setupList(page);
    await page.locator("select").filter({ hasText: /すべて/ }).first().selectOption("committed");
    // 1 件のみ表示される (ag-committed)
    await expect(page.locator(".data-list-card")).toHaveCount(1);
    await expect(page.locator(".data-list-card").first()).toContainText("確定フロー");
  });

  test("プロジェクト全体サマリが表示される (#233)", async ({ page }) => {
    await setupList(page);
    // ヘッダに "全体:" ラベル
    await expect(page.locator(".process-flow-list-header").getByText("全体:")).toBeVisible();
  });
});
