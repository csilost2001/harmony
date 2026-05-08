/**
 * 一覧の削除 UI 統一 — #147
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
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "Delete UI Test",
  entities: {
    screens: [
      { id: "s-1", no: 1, name: "画面A", kind: "other", path: "/a", updatedAt: FIXED_TS },
      { id: "s-2", no: 2, name: "画面B", kind: "other", path: "/b", updatedAt: FIXED_TS },
      { id: "s-3", no: 3, name: "画面C", kind: "other", path: "/c", updatedAt: FIXED_TS },
    ],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-list-delete-ui";
const WS_KEY_EMPTY = "issue-926-list-delete-ui-empty";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("#147 一覧 削除 UI", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY, WS_KEY_EMPTY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
    // 表モードを localStorage で記憶 (per-browser UI state、削除されない)
    await page.addInitScript(() => {
      localStorage.setItem("list-view-mode:screen-list", JSON.stringify("table"));
    });
    await ws.gotoActive(page, "/screen/list");
    await expect(page.locator(".screen-list-page")).toBeVisible();
    await expect(page.locator(".data-list-row")).toHaveCount(3);
  });

  test.describe("行ゴミ箱アイコン (§3.11 / §4.6)", () => {
    test("各行に行ゴミ箱ボタンが存在する (ホバーで表示)", async ({ page }) => {
      await expect(page.locator(".data-list-td-row-delete")).toHaveCount(3);
    });

    test("行ゴミ箱クリックでその行が ghost 化、保存ボタン有効化", async ({ page }) => {
      await page.locator(".data-list-row").first().locator(".data-list-td-row-delete").click({ force: true });
      await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
      await expect(page.getByTestId("list-save-btn")).toBeEnabled();
    });
  });

  test.describe("上部削除ボタン (§3.11 / §4.6)", () => {
    test("選択ゼロ時は disabled 常駐", async ({ page }) => {
      const deleteBtn = page.locator(".screen-list-header button", { hasText: "削除" });
      await expect(deleteBtn).toBeVisible();
      await expect(deleteBtn).toBeDisabled();
    });

    test("選択すると有効化され、件数が表示される", async ({ page }) => {
      await page.locator(".data-list-row").first().click();
      const deleteBtn = page.getByRole("button", { name: /削除 \(1\)/ });
      await expect(deleteBtn).toBeEnabled();
    });

    test("上部削除ボタンで複数選択を一括 ghost 化", async ({ page }) => {
      await page.locator(".data-list-row").first().click();
      await page.locator(".data-list-row").nth(2).click({ modifiers: ["Control"] });
      await page.getByRole("button", { name: /削除 \(2\)/ }).click();
      await expect(page.locator(".data-list-row.ghost")).toHaveCount(2);
    });
  });

  test.describe("右クリックメニュー (§3.11 / §4.6 / §5.10)", () => {
    test("行を右クリックするとメニューが開き、全項目が表示される", async ({ page }) => {
      await page.locator(".data-list-row").first().click({ button: "right" });
      const menu = page.locator(".list-context-menu");
      await expect(menu).toBeVisible();
      await expect(menu).toContainText("新規作成");
      await expect(menu).toContainText("コピー");
      await expect(menu).toContainText("切り取り");
      await expect(menu).toContainText("貼り付け");
      await expect(menu).toContainText("複製");
      await expect(menu).toContainText("削除");
      await expect(menu.locator("[role='separator']")).toHaveCount(3);
    });

    test("Esc キーでメニューが閉じる", async ({ page }) => {
      await page.locator(".data-list-row").first().click({ button: "right" });
      await expect(page.locator(".list-context-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".list-context-menu")).toBeHidden();
    });

    test("右クリックメニューの「削除」で ghost 化", async ({ page }) => {
      await page.locator(".data-list-row").first().click({ button: "right" });
      await page.locator(".list-context-menu-item", { hasText: "削除" }).click();
      await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
    });
  });

  test.describe("ソート中の右クリックメニュー (§3.9 / §3.11 整合)", () => {
    test("ソート中は「新規作成 / 貼り付け / 複製」が disabled、「削除 / コピー / 切り取り」は有効", async ({ page }) => {
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await page.locator(".data-list-row").first().click({ button: "right" });
      const menu = page.locator(".list-context-menu");
      await expect(menu).toBeVisible();
      const newItem = menu.locator(".list-context-menu-item", { hasText: "新規作成" });
      const pasteItem = menu.locator(".list-context-menu-item", { hasText: "貼り付け" });
      const duplicateItem = menu.locator(".list-context-menu-item", { hasText: "複製" });
      await expect(newItem).toBeDisabled();
      await expect(pasteItem).toBeDisabled();
      await expect(duplicateItem).toBeDisabled();
      const copyItem = menu.locator(".list-context-menu-item", { hasText: "コピー" });
      const cutItem = menu.locator(".list-context-menu-item", { hasText: "切り取り" });
      const deleteItem = menu.locator(".list-context-menu-item", { hasText: "削除" });
      await expect(copyItem).toBeEnabled();
      await expect(cutItem).toBeEnabled();
      await expect(deleteItem).toBeEnabled();
    });

    test("ソート中でも行ゴミ箱 / 上部削除ボタンは有効 (Delete は §3.9 の例外)", async ({ page }) => {
      await page.locator(".data-list-th-sortable", { hasText: "画面名" }).click();
      await page.locator(".data-list-row").first().locator(".data-list-td-row-delete").click({ force: true });
      await expect(page.locator(".data-list-row.ghost")).toHaveCount(1);
      await page.locator(".data-list-row").nth(1).click();
      await expect(page.getByRole("button", { name: /削除 \(1\)/ })).toBeEnabled();
    });
  });

  test.describe("キーボード代替 (§3.11)", () => {
    test("Shift+F10 でコンテキストメニューが開く", async ({ page }) => {
      await page.locator(".data-list-row").first().click();
      await page.keyboard.press("Shift+F10");
      const menu = page.locator(".list-context-menu");
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    });

    test("ContextMenu キーでコンテキストメニューが開く", async ({ page }) => {
      await page.locator(".data-list-row").first().click();
      await page.keyboard.press("ContextMenu");
      await expect(page.locator(".list-context-menu")).toBeVisible();
    });
  });
});

test.describe("#147 空状態の右クリック", () => {
  let emptyWs: OpenedWorkspace;

  test.beforeAll(async () => {
    if (!mcpAvailable) return;
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    emptyWs = await setupTestWorkspace({
      key: WS_KEY_EMPTY,
      project: buildProject({ name: "Delete UI Test" }),
    });
    await page.addInitScript(() => {
      localStorage.setItem("list-view-mode:screen-list", JSON.stringify("table"));
    });
    await emptyWs.gotoActive(page, "/screen/list");
    await expect(page.locator(".data-list-empty")).toBeVisible();
  });

  test("空領域の右クリックは「新規作成」のみの絞り込みメニュー", async ({ page }) => {
    await page.locator(".data-list-empty").click({ button: "right" });
    const menu = page.locator(".list-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".list-context-menu-item")).toHaveCount(1);
    await expect(menu).toContainText("新規作成");
  });
});
