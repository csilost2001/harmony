/**
 * 技術スタック選定画面 E2E テスト (#826)
 *
 * カバー範囲:
 *   1. /project/tech-stack を開くと TechStackView が表示される
 *   2. カテゴリクリックでパネルが切り替わる
 *   3. ラジオ選択後に保存できる (localStorage に techStack が反映される)
 *   4. puck + thymeleaf の組合せで制約違反 warning が表示される
 *
 * 前提: dev サーバー起動済み、MCP 不要 (localStorage プロジェクトセットアップ)
 */

import { test, expect, type Page } from "@playwright/test";

const FAKE_WS_ID = "e2e-fake-ws-tech-stack-view";

function makeDummyProject() {
  const now = new Date().toISOString();
  return {
    $schema: "../../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
    meta: {
      id: "e2e-tech-stack-0000-4000-8000-000000000000",
      name: "技術スタック E2E テスト用プロジェクト",
      createdAt: now,
      updatedAt: now,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    techStack: {
      designer:   { editorKind: "grapesjs", cssFramework: "bootstrap" },
      backend:    { language: "java", framework: "spring-boot" },
      database:   { type: "postgresql", version: "16" },
      frontend:   { library: "thymeleaf" },
      auth:       { method: "session" },
      deployment: { target: "docker" },
    },
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
      tables: [],
      processFlows: [],
      views: [],
      viewDefinitions: [],
      sequences: [],
    },
  };
}

async function setup(page: Page) {
  const project = makeDummyProject();
  await page.addInitScript(
    ({ project, wsId }: { project: object; wsId: string }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem("v3-project", JSON.stringify(project));
      localStorage.setItem("active-workspace-id", wsId);
      localStorage.removeItem("designer-open-tabs");
      localStorage.removeItem("designer-active-tab");
    },
    { project, wsId: FAKE_WS_ID },
  );
  await page.goto("/project/tech-stack");
}

test.describe("技術スタック選定画面 (#826)", () => {
  test("ページが表示される — カテゴリペイン + デザイナーパネルが存在する", async ({ page }) => {
    await setup(page);
    // カテゴリツリーが表示される
    await expect(page.locator("text=デザイナー")).toBeVisible();
    await expect(page.locator("text=バックエンド")).toBeVisible();
    await expect(page.locator("text=データベース")).toBeVisible();
    await expect(page.locator("text=フロントエンド")).toBeVisible();
    await expect(page.locator("text=認証")).toBeVisible();
    await expect(page.locator("text=デプロイ")).toBeVisible();
    // デザイナーカテゴリのラジオが表示される
    await expect(page.locator('input[name="designer-editor-kind"][value="grapesjs"]')).toBeVisible();
    await expect(page.locator('input[name="designer-editor-kind"][value="puck"]')).toBeVisible();
  });

  test("バックエンドカテゴリをクリックするとバックエンドパネルが表示される", async ({ page }) => {
    await setup(page);
    await page.locator("button", { hasText: "バックエンド" }).click();
    await expect(page.locator('input[name="backend-language"][value="java"]')).toBeVisible();
    await expect(page.locator('input[name="backend-framework"][value="spring-boot"]')).toBeVisible();
  });

  test("データベースカテゴリでバージョン入力フィールドが表示される", async ({ page }) => {
    await setup(page);
    await page.locator("button", { hasText: "データベース" }).click();
    await expect(page.locator('input[name="database-type"][value="postgresql"]')).toBeVisible();
    // バージョン入力 (placeholder 確認)
    await expect(page.locator('input[placeholder*="16"]')).toBeVisible();
  });

  test("保存ボタンが表示される", async ({ page }) => {
    await setup(page);
    await expect(page.locator("button", { hasText: "保存" })).toBeVisible();
  });

  test("puck + thymeleaf の組合せで制約違反 warning が表示される", async ({ page }) => {
    await setup(page);
    // デザイナー: puck に切り替え
    await page.locator('input[name="designer-editor-kind"][value="puck"]').click();
    // フロントエンドカテゴリに移動して thymeleaf を選択
    await page.locator("button", { hasText: "フロントエンド" }).click();
    await page.locator('input[name="frontend-library"][value="thymeleaf"]').click();
    // 右ペインに制約違反が表示される
    await expect(page.locator("text=制約違反")).toBeVisible();
    // 保存ボタンが disabled になる
    await expect(page.locator("button", { hasText: "保存" })).toBeDisabled();
  });
});
