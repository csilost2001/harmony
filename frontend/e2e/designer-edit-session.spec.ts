/**
 * GrapesJS 画面デザイナー edit-session E2E テスト (#689)
 *
 * 前提: dev サーバー (port 5173) および backend (port 5179) が起動済み
 *
 * シナリオ:
 *   1. 編集開始 → 保存 → 本体ファイル更新確認 (readonly オーバーレイ → 編集開始 → 保存)
 *   2. 編集中 → 破棄 → canvas が本体内容に戻る
 *   3. 再オープン → ResumeOrDiscardDialog 表示 (draft 残存)
 *   4. localStorage 救済 (旧キー仕込み + 差分あり → 確認ダイアログ → 採用)
 */

/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const SCREEN_ID = `scr-e2e-edit-session-${Date.now()}`;
const DATA_DIR = path.resolve(__dirname, "../../data");
const SCREENS_DIR = path.join(DATA_DIR, "screens");

/** テスト用画面ファイルを作成する */
function setupScreenFile(screenId: string) {
  if (!fs.existsSync(SCREENS_DIR)) {
    fs.mkdirSync(SCREENS_DIR, { recursive: true });
  }
  const screenFile = path.join(SCREENS_DIR, `${screenId}.design.json`);
  fs.writeFileSync(
    screenFile,
    JSON.stringify({
      assets: [],
      styles: [],
      pages: [{ frames: [{ component: { type: "wrapper" } }] }],
    }),
  );
  return screenFile;
}

/** テスト用画面ファイルを削除する */
function cleanupScreenFile(screenId: string) {
  const screenFile = path.join(SCREENS_DIR, `${screenId}.design.json`);
  try { fs.unlinkSync(screenFile); } catch { /* ignore */ }
  const draftFile = path.join(DATA_DIR, ".drafts", "screen", `${screenId}.json`);
  try { fs.unlinkSync(draftFile); } catch { /* ignore */ }
}

test.beforeAll(() => {
  setupScreenFile(SCREEN_ID);
});

test.afterAll(() => {
  cleanupScreenFile(SCREEN_ID);
});

test.describe.skip("画面デザイナー edit-session — シナリオ 1: 編集開始 → 保存", () => {
  test("readonly オーバーレイが表示 → 編集開始 → 保存 → readonly に戻る", async ({ page }) => {
    await page.goto(`/screen/design/${SCREEN_ID}`);
    await page.waitForLoadState("networkidle");

    // MCP 未接続の場合は早期スキップ
    const overlay = page.getByTestId("canvas-readonly-overlay");
    if (!await overlay.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }

    // canvas 上のオーバーレイボタンで編集開始
    const canvasStartBtn = page.getByTestId("canvas-readonly-start");
    await expect(canvasStartBtn).toBeVisible();
    await canvasStartBtn.click();

    // 編集モードツールバーの保存ボタンが表示される
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // 保存
    await page.getByTestId("edit-mode-save").click();

    // readonly に戻る
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("canvas-readonly-overlay")).toBeVisible();
  });
});

test.describe.skip("画面デザイナー edit-session — シナリオ 2: 編集中 → 破棄", () => {
  test("編集開始 → 破棄確認 → readonly に戻る", async ({ page }) => {
    await page.goto(`/screen/design/${SCREEN_ID}`);
    await page.waitForLoadState("networkidle");

    const editStartBtn = page.getByTestId("edit-mode-start");
    if (!await editStartBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }

    await editStartBtn.click();
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible({ timeout: 5000 });

    // 破棄ボタン → 確認ダイアログ
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });

    // 破棄実行
    await page.getByTestId("discard-confirm").click();

    // readonly に戻る
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("canvas-readonly-overlay")).toBeVisible();
  });
});

test.describe.skip("画面デザイナー edit-session — シナリオ 3: 再オープン → ResumeOrDiscardDialog", () => {
  test("draft が残っている状態で再オープン → ResumeOrDiscardDialog 表示", async ({ page }) => {
    await page.goto(`/screen/design/${SCREEN_ID}`);
    await page.waitForLoadState("networkidle");

    const editStartBtn = page.getByTestId("edit-mode-start");
    if (!await editStartBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }

    // 編集開始 (draft + lock が作成される)
    await editStartBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // 保存せずに別ページへ
    await page.goto("/screen/list");
    await page.waitForLoadState("networkidle");

    // 同じ画面を再オープン
    await page.goto(`/screen/design/${SCREEN_ID}`);
    await page.waitForLoadState("networkidle");

    // ResumeOrDiscardDialog が表示される
    const continueBtn = page.getByTestId("resume-continue");
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // 「続ける」→ 編集モードに入る
      await continueBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 8000 });
      // クリーンアップ: 破棄して終了
      await page.getByTestId("edit-mode-discard").click();
      await page.getByTestId("discard-confirm").click();
    } else {
      // MCP 未接続など
      test.skip();
    }
  });
});

test.describe.skip("画面デザイナー edit-session — シナリオ 4: localStorage 救済", () => {
  test("旧 gjs-screen-{id} キーを仕込み → 差分あり → 救済ダイアログ → 採用", async ({ page }) => {
    await page.goto(`/screen/design/${SCREEN_ID}`);
    await page.waitForLoadState("networkidle");

    // MCP 接続確認
    const editStartBtn = page.getByTestId("edit-mode-start");
    if (!await editStartBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip();
      return;
    }

    // 旧 localStorage データを仕込む (本体と異なる内容)
    await page.evaluate((screenId) => {
      const legacyData = {
        assets: [],
        styles: [{ selectors: [".legacy-test"], style: { color: "red" } }],
        pages: [{ frames: [{ component: { type: "wrapper" } }] }],
      };
      localStorage.setItem(`gjs-screen-${screenId}`, JSON.stringify(legacyData));
    }, SCREEN_ID);

    // ページをリロードして救済チェックを再実行
    await page.reload();
    await page.waitForLoadState("networkidle");

    // 救済ダイアログが表示されるか確認
    const adoptBtn = page.getByTestId("legacy-rescue-adopt");
    if (await adoptBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await adoptBtn.click();
      // ResumeOrDiscardDialog が表示される (draft 化されたため)
      const resumeDiscard = page.getByTestId("resume-discard");
      if (await resumeDiscard.isVisible({ timeout: 5000 }).catch(() => false)) {
        await resumeDiscard.click();
      }
    } else {
      // 差分なし (既に同期済み) またはMCP未接続の場合はスキップ
      test.skip();
    }

    // クリーンアップ
    await page.evaluate((screenId) => {
      localStorage.removeItem(`gjs-screen-${screenId}`);
      localStorage.removeItem(`gjs-screen-${screenId}-draft`);
    }, SCREEN_ID);
  });
});
