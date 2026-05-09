/**
 * 処理フロー一覧 (/process-flow/list) E2E テスト — #133
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

// header (project.processFlows[]) 用 — actionCount / kind 等の表示用 meta を持つ
// schema v3 EntryBase: id (Uuid), no, name, updatedAt 必須
const dummyGroups = [
  { id: "11111111-1111-4111-8111-111111111111", no: 1, name: "ログイン処理", kind: "screen", actionCount: 3, screenId: "screen-1", updatedAt: FIXED_TS },
  { id: "22222222-2222-4222-8222-222222222222", no: 2, name: "月次集計バッチ", kind: "batch", actionCount: 5, updatedAt: FIXED_TS },
  { id: "33333333-3333-4333-8333-333333333333", no: 3, name: "共通バリデーション", kind: "common", actionCount: 2, updatedAt: FIXED_TS },
];

// body (process-flows/<id>.json) 用 — v3 ProcessFlow shape
const dummyGroupBodies = dummyGroups.map((g) =>
  buildProcessFlow({ id: g.id, name: g.name, kind: g.kind as Parameters<typeof buildProcessFlow>[0]["kind"], mode: "upstream" })
);

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
  entities: {
    processFlows: dummyGroups,
  } as ProjectEntities,
});

const WS_KEY = "issue-926-action-list";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("処理フロー一覧", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  // 各テストで destructive な操作 (削除/複製/保存) が backend ファイルに残るため、
  // beforeEach で workspace を再 seed して isolation を確保する。
  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      processFlows: dummyGroupBodies,
    });
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.locator(".process-flow-page")).toBeVisible();
  });

  test("カード既定、表切替・種別フィルタ・ダブルクリック遷移", async ({ page }) => {
    await expect(page.locator(".data-list-layout-grid")).toHaveCount(1);
    // backend からの projects 取得 + ProcessFlow body load を待つ
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".data-list-card")).toHaveCount(3);
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".data-list-row")).toHaveCount(3);
    await page.getByRole("button", { name: "カード表示" }).click();
    await page.getByRole("button", { name: /^バッチ \(/ }).click();
    await expect(page.locator(".data-list-card")).toHaveCount(1);
    await expect(page.locator(".filter-bar")).toBeVisible();
    await page.locator(".data-list-card").first().dblclick();
    await expect(page).toHaveURL(/\/w\/[^/]+\/process-flow\/edit\//);
  });

  test("削除マークで ghost 表示、保存で確定", async ({ page }) => {
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(1);
    await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    await page.getByTestId("list-save-btn").click();
    await expect(page.locator(".data-list-card")).toHaveCount(2);
  });

  test("Ctrl+D で複製", async ({ page }) => {
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Control+d");
    await expect(page.locator(".data-list-card")).toHaveCount(4, { timeout: 15000 });
  });
});
