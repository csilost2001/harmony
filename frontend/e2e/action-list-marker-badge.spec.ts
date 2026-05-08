/**
 * 処理フロー一覧 マーカー件数バッジ (#261)
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
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyGroups = [
  { id: "ag-with-markers", no: 1, name: "マーカー入り", kind: "screen", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS },
  { id: "ag-clean", no: 2, name: "マーカーなし", kind: "batch", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS },
];

const baseFlowWithMarkers = buildProcessFlow({
  id: "ag-with-markers",
  name: "マーカー入り",
  kind: "screen",
  mode: "upstream",
  actions: [{ id: "act-1", name: "", trigger: "click", maturity: "draft", responses: [{ id: "201-ok", status: 201 }], steps: [] }] as ReturnType<typeof buildProcessFlow>["actions"],
});
const fullGroupWithMarkers = {
  ...baseFlowWithMarkers,
  authoring: {
    markers: [
      { id: "m1", kind: "todo", body: "ここ直して", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
      { id: "m2", kind: "todo", body: "これも", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
      { id: "m3", kind: "question", body: "なぜ?", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
      { id: "m4", kind: "attention", body: "注意", author: "human", createdAt: "2026-04-21T00:00:00.000Z" },
      { id: "m5", kind: "todo", body: "処理済", author: "human", createdAt: "2026-04-21T00:00:00.000Z", resolvedAt: "2026-04-21T01:00:00.000Z", resolvedBy: "ai" },
    ],
  },
};

const fullGroupClean = buildProcessFlow({
  id: "ag-clean",
  name: "マーカーなし",
  kind: "batch",
  mode: "upstream",
  actions: [{ id: "act-2", name: "", trigger: "click", maturity: "draft", responses: [{ id: "201-ok", status: 201 }], steps: [] }] as ReturnType<typeof buildProcessFlow>["actions"],
});

const dummyProject = buildProject({
  name: "marker badge test",
  entities: {
    processFlows: dummyGroups,
  } as ProjectEntities,
});

const WS_KEY = "issue-926-action-list-marker-badge";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("list-view-mode:process-flow-list");
  });
  await ws.gotoActive(page, "/process-flow/list");
  await expect(page.locator(".process-flow-page")).toBeVisible();
  await expect(page.locator(".process-flow-marker-badges").first()).toBeVisible({ timeout: 10000 });
}

test.describe("処理フロー一覧 マーカー件数バッジ (#261)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      processFlows: [fullGroupWithMarkers, fullGroupClean],
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("カードビューで marker 件数バッジが kind 別に表示される", async ({ page }) => {
    await setup(page);
    const markerCard = page.locator(".data-list-card").filter({ hasText: "マーカー入り" });
    const cleanCard = page.locator(".data-list-card").filter({ hasText: "マーカーなし" });
    await expect(markerCard.locator(".process-flow-marker-badge.kind-todo")).toContainText("2");
    await expect(markerCard.locator(".process-flow-marker-badge.kind-question")).toContainText("1");
    await expect(markerCard.locator(".process-flow-marker-badge.kind-attention")).toContainText("1");
    await expect(markerCard.locator(".process-flow-marker-badge.kind-chat")).toHaveCount(0);
    await expect(markerCard.locator(".process-flow-marker-badge.kind-todo")).not.toContainText("3");
    await expect(cleanCard.locator(".process-flow-marker-badges")).toHaveCount(0);
  });

  test("表ビューに マーカー 列が出て、badge が表示される", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator("thead th").filter({ hasText: "マーカー" })).toBeVisible();
    const markerRow = page.locator(".data-list-row").filter({ hasText: "マーカー入り" });
    await expect(markerRow.locator(".process-flow-marker-badge.kind-todo")).toContainText("2");
    await expect(markerRow.locator(".process-flow-marker-badge.kind-question")).toContainText("1");
  });

  test("ヘッダ全体サマリにマーカー合計が表示される", async ({ page }) => {
    await setup(page);
    const headerSummary = page.locator(".process-flow-list-header").locator("span[title*='マーカー']");
    await expect(headerSummary).toContainText("4");
  });

  test("「マーカーありのみ」フィルタで marker 入りの AG だけ表示", async ({ page }) => {
    await setup(page);
    await page.locator(".process-flow-list-check-label").filter({ hasText: "マーカーあり" }).click();
    await expect(page.locator(".data-list-card").filter({ hasText: "マーカー入り" })).toBeVisible();
    await expect(page.locator(".data-list-card").filter({ hasText: "マーカーなし" })).toHaveCount(0);
    await expect(page.locator(".filter-bar")).toContainText("マーカーあり");
  });
});
