/**
 * 画面一覧 (/screen/list) E2E テスト — #133
 *
 * #926: realWorkspace + 実 backend 経由に移植。前提として `cd backend && npm run dev` が起動済。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
  entities: {
    screens: [
      { id: "screen-0001", no: 1, name: "ログイン画面", kind: "login", path: "/login", hasDesign: false, updatedAt: FIXED_TS },
      { id: "screen-0002", no: 2, name: "ダッシュボード", kind: "dashboard", path: "/dashboard", hasDesign: true, updatedAt: FIXED_TS },
      { id: "screen-0003", no: 3, name: "ユーザー一覧", kind: "list", path: "/users", hasDesign: false, updatedAt: FIXED_TS },
    ],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-screen-list";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("画面一覧", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    await ws.gotoActive(page, "/screen/list");
    await expect(page.locator(".screen-list-page")).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    if (mcpAvailable) await ws.resetRuntimeState(page);
  });

  test("カード既定で 3 件、表切替可、検索絞り込み", async ({ page }) => {
    // backend からの projects + screens 取得を待つ
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".data-list-card")).toHaveCount(3);
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".data-list-row")).toHaveCount(3);
    await page.getByRole("button", { name: "カード表示" }).click();
    await page.locator(".screen-list-search input").fill("ログイン");
    await expect(page.locator(".data-list-card")).toHaveCount(1);
  });

  test("ダブルクリックで画面デザイナーへ遷移", async ({ page }) => {
    const card = page.locator(".data-list-card").first();
    await card.dblclick();
    await expect(page).toHaveURL(/\/w\/[^/]+\/screen\/design\//);
  });

  test("Delete で ghost 表示、リセットで戻る", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    // backend からの screens 取得を待つ
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    await page.getByTestId("list-reset-btn").click();
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(0);
  });

  test("HeaderMenu に「画面一覧」が出て active", async ({ page }) => {
    await page.locator(".header-menu-btn").click();
    await expect(page.locator(".header-menu-item.active", { hasText: "画面一覧" })).toBeVisible();
  });
});
