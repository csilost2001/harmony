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

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa";

const dummyProject = {
  version: 1, name: "E2Eテスト用プロジェクト",
  screens: [{ id: SCREEN_ID, no: 1, name: "ログイン", path: "/login", kind: "form", hasDesign: true }],
  groups: [], edges: [], tables: [],
};

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

  // TODO(#926 follow-up): edit-session-draft モデル下での dirty/reset シナリオは
  // backend draft seed 機構が必要。.srb-btn-save / .srb-btn-reset 経路は別途検証。
  test.skip("ドラフトあり初期状態では保存・リセットボタンが有効", () => { /* skip */ });
  test.skip("リセット後に保存・リセットボタンが無効に戻る", () => { /* skip */ });
  test.skip("リセットキャンセル後は保存・リセットボタンが有効のまま", () => { /* skip */ });
  test.skip("リセット後にタブを閉じても未保存ダイアログが出ない", () => { /* skip */ });
});
