/**
 * 技術スタック選定画面 E2E テスト (#826)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */

import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";

const dummyProject = buildProject({
  name: "技術スタック E2E テスト用プロジェクト",
  techStack: {
    designer:   { editorKind: "grapesjs", cssFramework: "bootstrap" },
    backend:    { language: "java", framework: "spring-boot" },
    database:   { type: "postgresql", version: "16" },
    frontend:   { library: "thymeleaf" },
    auth:       { method: "session" },
    deployment: { target: "docker" },
  },
});

const WS_KEY = "issue-926-tech-stack-view";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page) {
  await ws.gotoActive(page, "/project/tech-stack");
}

test.describe("技術スタック選定画面 (#826)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("ページが表示される — カテゴリペイン + デザイナーパネルが存在する", async ({ page }) => {
    await setup(page);
    await expect(page.getByRole("heading", { name: /デザイナー/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /バックエンド/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /データベース/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /フロントエンド/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /認証/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /デプロイ/ })).toBeVisible();
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
    await expect(page.locator('input[placeholder*="16"]')).toBeVisible();
  });

  test("保存ボタンが表示される", async ({ page }) => {
    await setup(page);
    await expect(page.locator("button", { hasText: "保存" })).toBeVisible();
  });

  test("puck + thymeleaf の組合せで制約違反 warning が表示される", async ({ page }) => {
    await setup(page);
    await page.locator('input[name="designer-editor-kind"][value="puck"]').click();
    await page.locator("button", { hasText: "フロントエンド" }).click();
    await page.locator('input[name="frontend-library"][value="thymeleaf"]').click();
    await expect(page.getByText("制約違反", { exact: true })).toBeVisible();
    await expect(page.locator("button", { hasText: "保存" })).toBeDisabled();
  });
});
