/**
 * 処理フローエディタ：保存/リセットボタン E2E テスト
 *
 * 視点: ユーザーが処理フローエディタ (/process-flow/edit/:id) で編集・保存・リセットを行う
 * 前提: dev サーバーが起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 — localStorage で処理フローを直接セットアップ
 */

import { test, expect, type Page } from "@playwright/test";

// ─── テスト用ダミーデータ ───────────────────────────────────────────────────

const PROCESS_FLOW_ID = "test-ag-0001-4000-8000-000000000001";

const dummyProcessFlow = {
  id: PROCESS_FLOW_ID,
  name: "テスト処理フロー",
  type: "screen",
  description: "",
  actions: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [],
  groups: [],
  edges: [],
  processFlows: [
    {
      id: PROCESS_FLOW_ID,
      name: dummyProcessFlow.name,
      type: dummyProcessFlow.type,
      actionCount: 0,
      updatedAt: dummyProcessFlow.updatedAt,
    },
  ],
  updatedAt: new Date().toISOString(),
};

const dummyTab = {
  id: `action:${PROCESS_FLOW_ID}`,
  type: "action",
  resourceId: PROCESS_FLOW_ID,
  label: dummyProcessFlow.name,
  isDirty: false,
  isPinned: false,
};

// ツールバーの保存/リセット（モーダル内のボタンと衝突しないよう）
const toolbarSave = ".save-reset-buttons button.srb-btn-save";
const toolbarReset = ".save-reset-buttons button.srb-btn-reset";

async function setupProcessFlowEditor(page: Page, draft: object | null = null) {
  await page.addInitScript(
    ({ project, group, groupId, tab, draft }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem(`process-flow-${groupId}`, JSON.stringify(group));
      localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
      localStorage.setItem("harmony-active-tab", tab.id);
      if (draft) {
        localStorage.setItem(`draft-action-${groupId}`, JSON.stringify(draft));
      } else {
        localStorage.removeItem(`draft-action-${groupId}`);
      }
    },
    {
      project: dummyProject,
      group: dummyProcessFlow,
      groupId: PROCESS_FLOW_ID,
      tab: dummyTab,
      draft,
    },
  );
  await page.goto(`/process-flow/edit/${PROCESS_FLOW_ID}`);
  await expect(page.locator(".process-flow-page")).toBeVisible();
}

/** アクションを追加してアクティブにする（ステップ追加の前提条件） */
async function addAction(page: Page, name: string) {
  // 「+」ボタン（アクション追加）をクリック
  await page.locator(".process-flow-tab-add").click();
  await page.locator(".process-flow-modal input.form-control").first().fill(name);
  await page.locator(".process-flow-modal button.btn-primary").click();
  // モーダルが閉じるまで待つ
  await expect(page.locator(".process-flow-modal")).not.toBeVisible();
}

// ─── テスト ────────────────────────────────────────────────────────────────

test.describe("処理フローエディタ：保存/リセットボタン", () => {
  test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupProcessFlowEditor(page);

    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("アクション追加後に保存・リセットボタンが有効になる", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("変更後にタブの dirty インジケーターが表示される", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");

    const tabLocator = page.locator(".tabbar-tab").filter({ hasText: dummyProcessFlow.name });
    await expect(tabLocator).toHaveClass(/\bdirty\b/);
  });

  test("リセット確認をキャンセルすると編集状態が保持される", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.dismiss());

    await addAction(page, "登録ボタン");
    await page.locator(toolbarReset).click();

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("リセット確認を承認するとボタンが無効に戻る", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.accept());

    await addAction(page, "登録ボタン");
    await page.locator(toolbarReset).click();

    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("リセット後にタブの dirty インジケーターが消える", async ({ page }) => {
    await setupProcessFlowEditor(page);
    page.on("dialog", (d) => d.accept());

    await addAction(page, "登録ボタン");
    const tabLocator = page.locator(".tabbar-tab").filter({ hasText: dummyProcessFlow.name });
    await expect(tabLocator).toHaveClass(/\bdirty\b/);

    await page.locator(toolbarReset).click();
    await expect(tabLocator).not.toHaveClass(/\bdirty\b/);
  });

  test("Ctrl+S で保存が実行されて保存ボタンが無効に戻る", async ({ page }) => {
    await setupProcessFlowEditor(page);
    await addAction(page, "登録ボタン");

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await page.keyboard.press("Control+s");

    await expect(page.locator(toolbarSave)).toBeDisabled();
  });

  test("ドラフトが事前に存在するとリロード後も isDirty 状態で復元される", async ({ page }) => {
    const drafted = {
      ...dummyProcessFlow,
      actions: [
        {
          id: "act-0001",
          name: "ドラフトアクション",
          trigger: "click",
          steps: [],
          inputs: "",
          outputs: "",
        },
      ],
    };
    await setupProcessFlowEditor(page, drafted);

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });
});
