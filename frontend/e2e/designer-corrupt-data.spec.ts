/**
 * 画面データが空・破損している場合でも Designer が起動できることを検証する (#131)。
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   破損データは harmony/screens/<id>.design.json に直接書き出して GrapesJS が
 *   その不正データを読み込む経路で検証する。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const SCREEN_ID = "bbbbbbbb-0001-4000-8000-bbbbbbbbbbbb";
const SCREEN_NORM = normalizeId(SCREEN_ID);
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const project = buildProject({
  name: "corrupt-data test",
  entities: {
    screens: [{ id: SCREEN_ID, no: 1, name: "破損テスト画面", path: "/corrupt", kind: "form", hasDesign: true, updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const dummyTab = {
  id: `design:${SCREEN_NORM}`,
  type: "design",
  resourceId: SCREEN_NORM,
  label: "破損テスト画面",
  isDirty: false,
  isPinned: false,
};

const WS_KEY_PREFIX = "issue-926-designer-corrupt-data";
let mcpAvailable = false;

async function setupDesignerWithRawData(page: Page, rawData: unknown, key: string): Promise<OpenedWorkspace> {
  const ws = await setupTestWorkspace({
    key,
    project,
    screenDesigns: [{ id: SCREEN_ID, data: rawData }],
  });
  await page.addInitScript((tab) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
  }, dummyTab);
  await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
  return ws;
}

test.describe("Designer 破損データ耐性 (#131)", () => {
  const wsKeys: string[] = [];

  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces(wsKeys);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("空オブジェクト {} でも起動し、TabErrorFallback が出ない", async ({ page }) => {
    const key = `${WS_KEY_PREFIX}-empty`;
    wsKeys.push(key);
    await setupDesignerWithRawData(page, {}, key);
    await expect(page.locator(".tab-error-fallback")).not.toBeVisible();
    await expect(page.locator(".app-error-fallback")).not.toBeVisible();
    // edit-session-draft (#683): readonly モードの edit-mode-start ボタンが Designer の起動成功マーカー
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
  });

  test("pages 欠落データでも起動し、ErrorDialog も出ない", async ({ page }) => {
    const key = `${WS_KEY_PREFIX}-pages-missing`;
    wsKeys.push(key);
    await setupDesignerWithRawData(page, { assets: [], styles: [], dataSources: [] }, key);
    await expect(page.locator(".tab-error-fallback")).not.toBeVisible();
    await expect(page.locator(".error-dialog-panel")).not.toBeVisible();
    // edit-session-draft (#683): readonly モードの edit-mode-start ボタンが Designer の起動成功マーカー
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
  });

  // #953: Designer の破損データ検知 → errorLog 記録 を復活。
  // 復活ポイントは Designer.tsx の grapesDraftRead (= backend.load の入口) で、
  // 空 / pages 欠落データを検知した時点で recordError() を呼ぶ。
  // edit-mode-start visible 時点 (= setGrapesState 後) には localStorage に書き込み済み。
  test("破損データ起動時に errorLog に痕跡が残る (#953 follow-up)", async ({ page }) => {
    const key = `${WS_KEY_PREFIX}-errorlog`;
    wsKeys.push(key);
    await setupDesignerWithRawData(page, {}, key);
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });

    // recordError が呼ばれるまで polling 待機 (race-safe)
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem("designer-error-log");
        if (!raw) return false;
        try {
          const log = JSON.parse(raw) as Array<{ message: string }>;
          return Array.isArray(log) && log.length > 0;
        } catch {
          return false;
        }
      },
      undefined,
      { timeout: 10000 },
    );

    const log = await page.evaluate(() => {
      const raw = localStorage.getItem("designer-error-log");
      return raw ? JSON.parse(raw) : [];
    });
    expect(log.length).toBeGreaterThan(0);
    expect(
      log.some((e: { message: string }) => /画面データ|pages/.test(e.message)),
    ).toBe(true);
  });
});
