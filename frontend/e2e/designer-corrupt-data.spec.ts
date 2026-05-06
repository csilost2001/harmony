/**
 * 画面データが空・破損している場合でも Designer が起動できることを検証する (#131)。
 *
 * 背景: remoteStorage.load() が空 {} や pages 欠落データを返すと、GrapesJS の Canvas.init が
 *       getFrames() undefined で落ち、RightPanel もその editor を触ってクラッシュする連鎖があった。
 * 対応: ensureValidProject() で最小構造を常に保証。抑制対象のイベント（初期ロード時の
 *       Canvas.init）が実際に発火する不正データ形状で検証する。
 */
import { test, expect, type Page } from "@playwright/test";

const SCREEN_ID = "bbbbbbbb-0001-4000-8000-bbbbbbbbbbbb";

const project = {
  version: 1,
  name: "corrupt-data test",
  screens: [
    {
      id: SCREEN_ID,
      name: "破損テスト画面",
      path: "/corrupt",
      description: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  groups: [],
  edges: [],
  tables: [],
  updatedAt: new Date().toISOString(),
};

const dummyTab = {
  id: `design:${SCREEN_ID}`,
  type: "design",
  resourceId: SCREEN_ID,
  label: "破損テスト画面",
  isDirty: false,
  isPinned: false,
};

async function setupDesignerWithRawData(page: Page, rawData: unknown, withDraft: boolean) {
  await page.addInitScript(
    ({ project, screenId, tab, rawData, withDraft }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem(`gjs-screen-${screenId}`, JSON.stringify(rawData));
      localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
      localStorage.setItem("harmony-active-tab", tab.id);
      if (withDraft) {
        // draftKey="1" にすると load() は localStorage を優先参照するため破損データが直接使われる
        localStorage.setItem(`gjs-screen-${screenId}-draft`, "1");
      } else {
        localStorage.removeItem(`gjs-screen-${screenId}-draft`);
      }
    },
    { project, screenId: SCREEN_ID, tab: dummyTab, rawData, withDraft },
  );
  await page.goto(`/screen/design/${SCREEN_ID}`);
}

test.describe("Designer 破損データ耐性 (#131)", () => {
  test("空オブジェクト {} でも起動し、TabErrorFallback が出ない", async ({ page }) => {
    await setupDesignerWithRawData(page, {}, /* withDraft */ true);

    // エラーフォールバックが出ていないこと
    await expect(page.locator(".tab-error-fallback")).not.toBeVisible();
    await expect(page.locator(".app-error-fallback")).not.toBeVisible();

    // リセットボタン（= Designer 起動成功のマーカー）が出ること
    await expect(page.locator(".srb-btn-reset")).toBeVisible({ timeout: 15000 });
  });

  test("pages 欠落データでも起動し、ErrorDialog も出ない", async ({ page }) => {
    await setupDesignerWithRawData(
      page,
      { assets: [], styles: [], dataSources: [] }, // pages 欠落
      /* withDraft */ true,
    );

    await expect(page.locator(".tab-error-fallback")).not.toBeVisible();
    await expect(page.locator(".error-dialog-panel")).not.toBeVisible();
    await expect(page.locator(".srb-btn-reset")).toBeVisible({ timeout: 15000 });
  });

  test("破損データ起動時に errorLog に痕跡が残る", async ({ page }) => {
    await setupDesignerWithRawData(page, {}, /* withDraft */ true);
    await expect(page.locator(".srb-btn-reset")).toBeVisible({ timeout: 15000 });

    const log = await page.evaluate(() => {
      const raw = localStorage.getItem("designer-error-log");
      return raw ? JSON.parse(raw) : [];
    });
    // デバッグ用: 失敗時に実際のログを見られるよう assertion 前にダンプ
    console.log("[test] errorLog entries:", log.map((e: { message: string }) => e.message));
    expect(log.length).toBeGreaterThan(0);
    // "画面データ" または "pages" を含むメッセージが残っていること
    expect(
      log.some((e: { message: string }) => /画面データ|pages/.test(e.message)),
    ).toBe(true);
  });
});
