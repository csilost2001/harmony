/**
 * ProcessFlowListView の追加 E2E (#248)
 * - view mode toggle (card ⇔ table)
 * - type ヘッダクリックソート (表モード)
 * - 複数選択 (Shift+Click)
 * - Ctrl+A 全選択
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
import type { ProjectEntities, Timestamp, ProcessFlowKind, Maturity } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const listGroups = [
  { id: "g-a", no: 1, name: "Alpha ログイン", kind: "screen" as ProcessFlowKind, actionCount: 2, updatedAt: FIXED_TS, maturity: "committed" as Maturity },
  { id: "g-b", no: 2, name: "Beta バッチ", kind: "batch" as ProcessFlowKind, actionCount: 1, updatedAt: FIXED_TS, maturity: "provisional" as Maturity },
  { id: "g-c", no: 3, name: "Charlie 共通", kind: "common" as ProcessFlowKind, actionCount: 1, updatedAt: FIXED_TS, maturity: "draft" as Maturity },
  { id: "g-d", no: 4, name: "Delta 登録", kind: "screen" as ProcessFlowKind, actionCount: 3, updatedAt: FIXED_TS, maturity: "draft" as Maturity },
];

const listGroupBodies = listGroups.map((g) =>
  buildProcessFlow({ id: g.id, name: g.name, kind: g.kind, maturity: g.maturity, mode: "upstream" }),
);

const project = buildProject({
  name: "list-ops",
  entities: {
    processFlows: listGroups,
  } as ProjectEntities,
});

const WS_KEY = "issue-926-list-ops";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("ProcessFlowListView 操作 (#248)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project,
      processFlows: listGroupBodies,
    });
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.locator(".process-flow-page")).toBeVisible();
  });

  test("view mode toggle でカード ⇔ 表切替", async ({ page }) => {
    await expect(page.locator(".data-list-layout-grid")).toHaveCount(1);
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator(".data-list-row")).toHaveCount(4);
    await page.getByRole("button", { name: "カード表示" }).click();
    await expect(page.locator(".data-list-card")).toHaveCount(4);
  });

  test("表モードで 名前列 ヘッダクリックでソート", async ({ page }) => {
    await page.getByRole("button", { name: "表表示" }).click();
    const rowsBefore = await page.locator(".data-list-row").allTextContents();
    expect(rowsBefore[0]).toContain("Alpha");
    await page.getByRole("columnheader", { name: /名前/ }).click();
    await page.getByRole("columnheader", { name: /名前/ }).click();
    const rowsDesc = await page.locator(".data-list-row").allTextContents();
    expect(rowsDesc[0]).toContain("Delta");
  });

  test("Ctrl+A で全件選択、Delete で ghost 表示", async ({ page }) => {
    // backend からの projects 取得を待つ
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
    await page.locator(".data-list-card").first().click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await expect(page.locator(".data-list-card.ghost")).toHaveCount(4);
  });

  test("成熟度サマリバーが total を表示する", async ({ page }) => {
    // groups load を待つ (groups.length > 0 で初めて 全体: が render される)
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
    const header = page.locator(".process-flow-list-header");
    await expect(header.getByText("全体:")).toBeVisible();
  });
});
