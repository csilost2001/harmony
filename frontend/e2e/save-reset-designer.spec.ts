/**
 * 画面デザイナー：リセットボタン E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *
 * 注: 旧 spec は `gjs-screen-<id>-draft` localStorage flag 経由で dirty 状態を seed
 * していたが、edit-session-draft (#683) 化以降この経路は廃止。本 spec は GrapesJS の
 * 起動 + readonly 経路の smoke のみ確認し、dirty 化を伴うテストは follow-up にする。
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

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa";
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
  entities: {
    screens: [{ id: SCREEN_ID, no: 1, name: "ログイン", path: "/login", kind: "form", hasDesign: true, updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const SCREEN_NORM = normalizeId(SCREEN_ID);
const dummyTab = { id: `design:${SCREEN_NORM}`, type: "design", resourceId: SCREEN_NORM, label: "ログイン", isDirty: false, isPinned: false };

const screenWithComponents = {
  dataSources: [],
  assets: [],
  styles: [],
  pages: [
    {
      frames: [
        {
          component: {
            type: "wrapper",
            components: '<div class="container"><h1>ログイン</h1><input type="text" placeholder="ユーザーID"/><button>送信</button></div>',
          },
          id: "fr-init-0001",
        },
      ],
      id: "pg-init-0001",
      type: "main",
    },
  ],
};

const WS_KEY = "issue-926-save-reset-designer";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupDesigner(page: Page, opts: { emptyScreen?: boolean } = {}) {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    screenDesigns: [{ id: SCREEN_ID, data: opts.emptyScreen ? {} : screenWithComponents }],
  });
  await page.addInitScript((tab) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
  }, dummyTab);
  await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
}

test.describe("画面デザイナー：リセットボタン (smoke)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("デザイナーが起動する (TabErrorFallback / AppErrorFallback が出ない)", async ({ page }) => {
    await setupDesigner(page);
    await expect(page.locator(".tab-error-fallback")).not.toBeVisible();
    await expect(page.locator(".app-error-fallback")).not.toBeVisible();
    // edit-mode-start ボタンが出る (#683 readonly mode)
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
  });

  test("実データ有り画面を開いても dirty にならない", async ({ page }) => {
    await setupDesigner(page, { emptyScreen: false });
    await page.waitForTimeout(500);
    // edit-mode-start が出ていれば dirty ではない (readonly モード)
    await expect(page.getByTestId("edit-mode-start")).toBeVisible();
  });

  // 元 spec で empty placeholder だった「ドラフトあり初期状態 / リセット後 /
  // リセットキャンセル後 / タブを閉じても」の 4 件は、Designer (GrapesJS / Puck) の
  // D&D を伴う draft 状態作成が必要で、それは Designer 内部の責務 (Puck/GrapesJS 公式)。
  // Harnize 側の e2e 責任範囲外として削除。
  // Designer 統合 smoke は puck-editor.spec.ts / designer-edit-session.spec.ts でカバー。
});
