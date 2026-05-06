/**
 * ステップ高度機能 E2E (#248)
 * - branch 新規追加 (ツールバーから)
 * - loop 新規追加 + loopKind 切替
 * - template ボタン (既存テンプレート適用)
 * - subtype picker (subStep 追加)
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-advanced";

const dummyGroup = {
  id: groupId,
  name: "高度機能テスト",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-1",
      name: "ボタン",
      trigger: "click",
      maturity: "draft",
      steps: [
        {
          id: "step-base",
          type: "other",
          description: "親ステップ",
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
  name: "advanced",
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

test.describe("ステップ追加 (条件分岐 / ループ) (#248)", () => {
  test("ツールバーから 条件分岐 を追加", async ({ page }) => {
    await setupEditor(page);
    await expect(page.locator(".step-card")).toHaveCount(1);
    await page.getByRole("button", { name: /条件分岐/ }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(2);
    // 2 つ目のカードが branch 型
    await expect(page.locator(".step-card").nth(1)).toContainText(/条件分岐|branch/);
  });

  test("ツールバーから ループ を追加", async ({ page }) => {
    await setupEditor(page);
    await page.getByRole("button", { name: /ループ$/ }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(2);
    await expect(page.locator(".step-card").nth(1)).toContainText(/ループ|loop/);
  });

  test("計算/代入 (compute) ツールバーから追加", async ({ page }) => {
    await setupEditor(page);
    await page.getByRole("button", { name: /計算\/代入|計算・代入/ }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(2);
  });
});

test.describe("Subtype picker でサブステップ追加 (#248)", () => {
  test("コンテキストメニュー → サブステップ追加 → 種別選択", async ({ page }) => {
    await setupEditor(page);
    const firstCard = page.locator(".step-card").first();
    await firstCard.locator(".step-card-menu-btn").last().click();
    await page.getByRole("button", { name: /サブステップ追加/ }).click();
    // 種別ピッカーが出る
    await page.getByRole("button", { name: /バリデーション/ }).first().click();
    // サブステップがカード内に追加される (sub element or nested)
    // 検証はサブステップカードの存在 — step-card のネストが増える
    await expect(page.locator(".step-card")).toHaveCount(2);
  });
});

test.describe("テンプレートボタン (#248)", () => {
  test("テンプレートボタンをクリックで選択ダイアログが開く", async ({ page }) => {
    await setupEditor(page);
    const tplBtn = page.getByRole("button", { name: /テンプレート/ }).first();
    await tplBtn.click();
    // ダイアログ or drawer / 選択肢が出る
    // action.ts の STEP_TEMPLATES から「バリデーション + エラー表示」などが表示される想定
    await expect(page.getByText(/バリデーション.*エラー表示|DB検索.*結果表示|DB登録.*完了画面遷移|認証.*権限チェック/).first()).toBeVisible();
  });
});
