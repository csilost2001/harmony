/**
 * フロー画面：保存/リセットボタン E2E テスト
 *
 * 視点: ユーザーが画面フロー (/ の FlowEditor) で編集・保存・リセットを行う
 * 前提: dev サーバーが起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 — localStorage でプロジェクトを直接セットアップ
 */

import { test, expect, type Page } from "@playwright/test";

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [],
  groups: [],
  edges: [],
  updatedAt: new Date().toISOString(),
};

// ツールバーの保存/リセットを明示的に指し示すロケータ（モーダル内の「保存」と衝突しないよう）
const toolbarSave = ".save-reset-buttons button.srb-btn-save";
const toolbarReset = ".save-reset-buttons button.srb-btn-reset";

async function setupFlowEditor(page: Page, draft: object | null = null) {
  await page.addInitScript(
    ({ project, draft }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
      if (draft) {
        localStorage.setItem("draft-flow-project", JSON.stringify(draft));
      } else {
        localStorage.removeItem("draft-flow-project");
      }
    },
    { project: dummyProject, draft },
  );
  await page.goto("/screen/flow");
  await expect(page.locator(".flow-root")).toBeVisible();
}

async function addScreenViaModal(
  page: Page,
  name: string,
  options?: { editorKind?: "grapesjs" | "puck"; cssFramework?: "bootstrap" | "tailwind" },
) {
  // ツールバーの「画面を追加」（空状態 CTA "最初の画面を追加" とは別）
  await page.locator('.editor-header button.flow-btn-primary').filter({ hasText: "画面を追加" }).click();
  await page.locator("#screen-name").fill(name);
  if (options?.editorKind) {
    await page.locator(`input[name="screen-editor-kind"][value="${options.editorKind}"]`).click();
  }
  if (options?.cssFramework) {
    await page.locator(`input[name="screen-css-framework"][value="${options.cssFramework}"]`).click();
  }
  await page.locator('.flow-modal button[type="submit"]').click();
}

test.describe("フロー画面：保存/リセットボタン", () => {
  test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupFlowEditor(page);

    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("画面追加後に保存・リセットボタンが有効になる", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "テスト画面");

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("リセット確認をキャンセルすると編集状態が保持される", async ({ page }) => {
    await setupFlowEditor(page);
    page.on("dialog", (d) => d.dismiss());

    await addScreenViaModal(page, "テスト画面");

    await page.locator(toolbarReset).click();

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });

  test("リセット確認を承認するとボタンが無効に戻る", async ({ page }) => {
    await setupFlowEditor(page);
    page.on("dialog", (d) => d.accept());

    await addScreenViaModal(page, "テスト画面");

    await page.locator(toolbarReset).click();

    await expect(page.locator(toolbarSave)).toBeDisabled();
    await expect(page.locator(toolbarReset)).toBeDisabled();
  });

  test("Ctrl+S で保存が実行されてボタンが無効に戻る", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "テスト画面");

    await expect(page.locator(toolbarSave)).toBeEnabled();

    await page.keyboard.press("Control+s");

    await expect(page.locator(toolbarSave)).toBeDisabled();
  });

  test("ドラフトが事前に存在するとリロード後も isDirty 状態で復元される", async ({ page }) => {
    const projectWithScreen = {
      ...dummyProject,
      screens: [
        {
          id: "aaaaaaaa-0001-4000-8000-000000000001",
          name: "ドラフト画面",
          type: "list",
          description: "",
          path: "/draft",
          position: { x: 0, y: 0 },
          size: { width: 200, height: 100 },
          hasDesign: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    await setupFlowEditor(page, projectWithScreen);

    await expect(page.locator(toolbarSave)).toBeEnabled();
    await expect(page.locator(toolbarReset)).toBeEnabled();
  });
});
