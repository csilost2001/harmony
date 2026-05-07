/**
 * ステップ管理・テンプレート・ソート E2E (#246)
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-step-ops-test";

const dummyGroup = {
  id: groupId,
  name: "ステップ操作テスト",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-1",
      name: "メインボタン",
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
          description: "検索",
          tableName: "users",
          operation: "SELECT",
          maturity: "draft",
        },
        {
          id: "step-3",
          type: "screenTransition",
          description: "遷移",
          targetScreenName: "完了",
          maturity: "draft",
        },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "step-ops",
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
      maturity: "draft",
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
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
}

test.describe.skip("ステップツールバーから追加 (#246)", () => {
  test("ツールバーの DB 操作をクリックで末尾に追加される", async ({ page }) => {
    await setupEditor(page);
    // 初期 3 ステップ
    await expect(page.locator(".step-card")).toHaveCount(3);
    // ツールバーの「DB操作」ボタンをクリック
    await page.getByRole("button", { name: /DB操作/ }).first().click();
    // 4 ステップに増える
    await expect(page.locator(".step-card")).toHaveCount(4);
  });

  test("ツールバーの ジャンプ をクリックで追加", async ({ page }) => {
    await setupEditor(page);
    await expect(page.locator(".step-card")).toHaveCount(3);
    await page.getByRole("button", { name: /ジャンプ/ }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(4);
  });
});

test.describe.skip("ステップコンテキストメニュー (#246)", () => {
  test("メニューから複製で 4 ステップに", async ({ page }) => {
    await setupEditor(page);
    // 1 つ目の card の ・・・ メニューを開く
    const firstCard = page.locator(".step-card").first();
    await firstCard.locator(".step-card-menu-btn").last().click();
    // 複製 メニュー項目クリック
    await page.getByRole("button", { name: /複製/ }).first().click();
    // 4 ステップに増える
    await expect(page.locator(".step-card")).toHaveCount(4);
  });

  test("メニューから削除で 2 ステップに", async ({ page }) => {
    await setupEditor(page);
    const firstCard = page.locator(".step-card").first();
    await firstCard.locator(".step-card-menu-btn").last().click();
    await page.getByRole("button", { name: /削除/ }).first().click();
    // ghost にはならず、即削除
    await expect(page.locator(".step-card")).toHaveCount(2);
  });
});

test.describe.skip("ステップヘッダクリックで展開・閉じる (#246)", () => {
  test("type label クリックで body が表示される", async ({ page }) => {
    await setupEditor(page);
    const firstCard = page.locator(".step-card").first();
    // 初期は閉じている
    await expect(firstCard.locator(".step-card-body")).toHaveCount(0);
    // type label クリックで展開
    await firstCard.locator(".step-card-type-label").click();
    await expect(firstCard.locator(".step-card-body")).toBeVisible();
  });
});

test.describe.skip("メタバッジクリックで展開 (#236)", () => {
  test("runIf を設定したステップのアイコンクリックで展開される", async ({ page }) => {
    // 事前に runIf 入りのステップを用意
    const withRunIfGroup = {
      ...dummyGroup,
      actions: [
        {
          ...dummyGroup.actions[0],
          steps: [
            { ...dummyGroup.actions[0].steps[0], runIf: "@x > 0" },
            ...dummyGroup.actions[0].steps.slice(1),
          ],
        },
      ],
    };
    await page.addInitScript(({ project, group }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
    }, { project: dummyProject, group: withRunIfGroup });
    await page.goto(`/process-flow/edit/${groupId}`);
    const firstCard = page.locator(".step-card").first();
    // runIf アイコン (funnel) のクリック可能 button を探す
    const runIfBtn = firstCard.locator('button[title*="runIf"]').first();
    await runIfBtn.click();
    // body が表示される
    await expect(firstCard.locator(".step-card-body")).toBeVisible();
  });
});
