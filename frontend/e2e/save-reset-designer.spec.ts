/**
 * 画面デザイナー：リセットボタン E2E テスト
 *
 * 視点: ユーザーが画面デザイナーでリセットを行う
 * 前提: dev サーバーが起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 — localStorage でドラフトマーカーを直接セットアップ
 *
 * GrapesJS キャンバス内部（iframe）はスコープ外。
 * ドラフトマーカーを localStorage に事前セットして isDirty=true の初期状態を再現し、
 * リセット後に dirty 状態が解除されることを検証する。
 */

/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

// ─── テスト用ダミーデータ ───────────────────────────────────────────────────

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa";

const dummyProject = {
  version: 1,
  name: "E2Eテスト用プロジェクト",
  screens: [
    {
      id: SCREEN_ID,
      name: "ログイン",
      path: "/login",
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
  label: "ログイン",
  isDirty: true,
  isPinned: false,
};

// ─── セットアップ ──────────────────────────────────────────────────────────

// 実画面データ相当: ロード時に複数 component:add が発火する程度のプロジェクト
// （初期ロード由来の markDirty 誤発火を再現するため、空 {} ではなく実データを使う）
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
            components:
              "<div class=\"container\"><h1>ログイン</h1><input type=\"text\" placeholder=\"ユーザーID\"/><button>送信</button></div>",
          },
          id: "fr-init-0001",
        },
      ],
      id: "pg-init-0001",
      type: "main",
    },
  ],
} as const;

async function setupDesigner(
  page: Page,
  { withDraft = true, emptyScreen = true }: { withDraft?: boolean; emptyScreen?: boolean } = {},
) {
  await page.addInitScript(
    ({ project, screenId, tab, withDraft, emptyScreen, screenData }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      // emptyScreen: GrapesJS 用の最小スクリーンデータ（ロード可能な空プロジェクト）
      // !emptyScreen: 実コンテンツ有り（component:add 発火を伴う初期ロードを再現）
      localStorage.setItem(
        `gjs-screen-${screenId}`,
        JSON.stringify(emptyScreen ? {} : screenData),
      );
      localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
      localStorage.setItem("harmony-active-tab", tab.id);
      if (withDraft) {
        // ドラフトマーカー: Designer が isDirty=true で初期化される
        localStorage.setItem(`gjs-screen-${screenId}-draft`, "1");
      } else {
        localStorage.removeItem(`gjs-screen-${screenId}-draft`);
      }
    },
    { project: dummyProject, screenId: SCREEN_ID, tab: dummyTab, withDraft, emptyScreen, screenData: screenWithComponents },
  );
  await page.goto(`/screen/design/${SCREEN_ID}`);
  // GrapesJS 初期化完了を待つ（リセットボタンが出現するまで）
  await expect(page.locator(".srb-btn-reset")).toBeVisible({ timeout: 15000 });
}

// ─── テスト ────────────────────────────────────────────────────────────────

test.describe.skip("画面デザイナー：リセットボタン", () => {
  test("ドラフトあり初期状態では保存・リセットボタンが有効", async ({ page }) => {
    await setupDesigner(page);

    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeEnabled();
  });

  test("リセット後に保存・リセットボタンが無効に戻る", async ({ page }) => {
    await setupDesigner(page);
    page.on("dialog", (d) => d.accept());

    await page.getByRole("button", { name: /リセット/ }).click();

    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeDisabled();
  });

  test("リセットキャンセル後は保存・リセットボタンが有効のまま", async ({ page }) => {
    await setupDesigner(page);
    page.on("dialog", (d) => d.dismiss());

    await page.getByRole("button", { name: /リセット/ }).click();

    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeEnabled();
  });

  test("リセット後にタブを閉じても未保存ダイアログが出ない", async ({ page }) => {
    await setupDesigner(page);
    page.on("dialog", (d) => d.accept());

    // リセット実行
    await page.getByRole("button", { name: /リセット/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();

    // タブの閉じるボタンをクリック
    const tab = page.locator(".tabbar-tab").filter({ hasText: "ログイン" });
    await tab.locator(".tabbar-tab-close").click({ force: true });

    // ダイアログが出ずにタブが閉じられること
    await expect(tab).not.toBeVisible();
  });

  test("ドラフトなし初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupDesigner(page, { withDraft: false });

    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeDisabled();
  });

  // 回帰: 初期ロード中の component:add が markDirty を発火させ
  //       開いただけで dirty になる / draftKey が立ち続けるバグを防ぐ（issue: 開くと未保存状態）
  test("実データ有り画面を開いても初期ロードだけで dirty にならない", async ({ page }) => {
    // withDraft=false でコンテンツ有り。旧実装では component:add→markDirty が発火して
    // ボタンが有効化されてしまう。
    await setupDesigner(page, { withDraft: false, emptyScreen: false });

    // Ready 到達後、イベントループが落ち着くのを待つ
    await page.waitForTimeout(500);

    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /リセット/ })).toBeDisabled();

    // さらに draftKey が立っていないこと（次回リロード時に stale 状態で起動しないこと）
    const draftFlag = await page.evaluate(
      (id) => localStorage.getItem(`gjs-screen-${id}-draft`),
      SCREEN_ID,
    );
    expect(draftFlag).toBeNull();
  });

});
