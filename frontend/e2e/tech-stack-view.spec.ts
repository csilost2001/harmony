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
    designer:   { cssFramework: "bootstrap" },
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

test.describe("技術スタック選定画面 (#826)", { tag: ["@regression"] }, () => {
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

  test.afterEach(async ({ page }) => {
    if (mcpAvailable) await ws.resetRuntimeState(page);
  });

  test("ページが表示される — カテゴリペイン + 画面デザインパネルが存在する", async ({ page }) => {
    await setup(page);
    await expect(page.getByRole("button", { name: /画面デザイン/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /バックエンド/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /データベース/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /フロントエンド/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /認証/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /デプロイ/ })).toBeVisible();
    // 旧エディタ (GrapesJS / Puck) の廃止により、エディタ種別の選択は無い。CSS フレームワークだけを選ぶ
    await expect(page.locator('input[name="designer-css-framework"][value="bootstrap"]')).toBeVisible();
    await expect(page.locator('input[name="designer-css-framework"][value="tailwind"]')).toBeVisible();
    await expect(page.locator('input[name="designer-editor-kind"]')).toHaveCount(0);
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

  test("バックエンド言語とフレームワークの組合せ違反で制約違反 warning が表示され、保存できない", async ({ page }) => {
    await setup(page);
    await page.locator("button", { hasText: "バックエンド" }).click();
    await page.locator('input[name="backend-language"][value="java"]').click();
    await page.locator('input[name="backend-framework"][value="gin"]').click();
    await expect(page.getByText("制約違反", { exact: true })).toBeVisible();
    await expect(page.locator("button", { hasText: "保存" })).toBeDisabled();
  });
});
