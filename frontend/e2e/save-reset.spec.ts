/**
 * 保存/リセットボタン E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */

import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  seedTabsForWorkspace,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

// "test-table" は hex でないため UUID_V4_RE に match せず normalizeId が deterministic
// UUID を生成する。fixture file 名 / project meta の id / URL を全て同じ正規化済 UUID で
// 揃えないと、loadTable が null を返して TableEditor が render されない (#945)。
const TABLE_ID = normalizeId("test-table-0001-4000-8000-000000000001");
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyTable = {
  id: TABLE_ID,
  physicalName: "users",
  name: "ユーザーマスタ",
  description: "",
  category: "マスタ",
  columns: [
    {
      id: "col-0001",
      physicalName: "id",
      name: "ユーザーID",
      dataType: "INTEGER",
      notNull: true,
      primaryKey: true,
      unique: false,
      autoIncrement: true,
    },
  ],
  indexes: [],
  constraints: [],
};

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト",
  entities: {
    tables: [
      { id: TABLE_ID, no: 1, physicalName: "users", name: "ユーザーマスタ", category: "マスタ", columnCount: 1, updatedAt: FIXED_TS },
    ],
  } as ProjectEntities,
});

const TABLE_NORM = normalizeId(TABLE_ID);
const dummyTab = {
  id: `table:${TABLE_NORM}`,
  type: "table",
  resourceId: TABLE_NORM,
  label: "ユーザーマスタ",
  isDirty: false,
  isPinned: false,
};

const WS_KEY = "issue-926-save-reset";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupTableEditor(page: Page): Promise<void> {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    tables: [dummyTable],
  });
  await seedTabsForWorkspace(page, ws.wsId, [dummyTab], dummyTab.id);
  await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
  // gotoActive の routeMarkerMap には個別 editor (/table/edit/:id) が含まれず render 完了を
  // 待たない。フル run で前 spec の workspace switch race と重なるため timeout を拡張。
  await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 15000 });
  // 過去 test 残骸の discarded EditSession が listAll に残るため (active + discarded
  // の両方を返す仕様) ResumeOrDiscardDialog が出る場合がある。
  // 出ていれば JS 経由で「破棄して本体を読み込む」を発火 (Playwright click は
  // edit-mode-modal-footer に intercept されるため evaluate で直接 click イベントを送る)。
  if (await page.locator(".edit-mode-modal-backdrop").isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null;
      btn?.click();
    });
    await expect(page.locator(".edit-mode-modal-backdrop")).toBeHidden({ timeout: 5000 });
  }
  // 編集モードに入る (#683 edit-session-draft モデル)。
  // readonly では .srb-btn-save / .srb-btn-reset / カラム追加 ボタンが UI に出ないので、
  // editing モードに入ってから assertion を始める。
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

test.describe("テーブルエディタ：保存/リセットボタン", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("初期状態では保存・リセットボタンが無効", async ({ page }) => {
    await setupTableEditor(page);
    await expect(page.locator(".srb-btn-save")).toBeDisabled();
    await expect(page.locator(".srb-btn-reset")).toBeDisabled();
  });

  test("カラム追加後に保存・リセットボタンが有効になる", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".srb-btn-save")).toBeEnabled();
    await expect(page.locator(".srb-btn-reset")).toBeEnabled();
  });

  test("変更後にタブの dirty インジケーターが表示される", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
    await expect(page.locator(".tabbar-tab-dirty")).toBeVisible();
  });

  test("リセット後に保存・リセットボタンが無効に戻る", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".srb-btn-save")).toBeEnabled();
    await page.locator(".srb-btn-reset").click();
    // window.confirm 承認後 → DiscardConfirmDialog (#683 edit-session-draft) が出るので確定する。
    await page.getByTestId("discard-confirm").click();
    // 破棄完了 → readonly モードに戻り SaveResetButtons は非表示、edit-mode-start 再表示。
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".srb-btn-save")).toHaveCount(0);
    await expect(page.locator(".srb-btn-reset")).toHaveCount(0);
  });

  test("リセット後に dirty インジケーターが消える", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
    await page.locator(".srb-btn-reset").click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.locator(".tabbar-tab.dirty")).not.toBeVisible();
  });

  test("リセットクリックで確認ダイアログが表示される", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    let dialogType = "";
    let dialogMessage = "";
    page.once("dialog", async (d) => {
      dialogType = d.type();
      dialogMessage = d.message();
      await d.dismiss();
    });
    await page.locator(".srb-btn-reset").click();
    expect(dialogType).toBe("confirm");
    expect(dialogMessage).toContain("保存済み状態に戻します");
  });

  test("確認ダイアログをキャンセルすると編集状態が保持される", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".srb-btn-save")).toBeEnabled();
    await page.locator(".srb-btn-reset").click();
    await expect(page.locator(".srb-btn-save")).toBeEnabled();
    await expect(page.locator(".srb-btn-reset")).toBeEnabled();
    await expect(page.locator(".tabbar-tab.dirty")).toBeVisible();
  });

  test("確認ダイアログを承認するとリセットが実行される", async ({ page }) => {
    await setupTableEditor(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".srb-btn-save")).toBeEnabled();
    await page.locator(".srb-btn-reset").click();
    await page.getByTestId("discard-confirm").click();
    // 破棄完了 → readonly モードに戻る (edit-mode-start が再表示) + SaveResetButtons 消失。
    // tab.dirty は別タスクで follow-up (上記 skip テスト参照)。
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".srb-btn-save")).toHaveCount(0);
  });

  test("Ctrl+S で保存が実行されて保存ボタンが無効に戻る", async ({ page }) => {
    await setupTableEditor(page);
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(page.locator(".srb-btn-save")).toBeEnabled();
    await page.keyboard.press("Control+s");
    await expect(page.locator(".srb-btn-save")).toBeDisabled();
  });
});
