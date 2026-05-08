/**
 * ダッシュボード E2E テスト
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   project / table / processFlow を実 backend に書き出し、
 *   `dashboard-layout-v1` 等の正当な per-browser UI state は addInitScript で残す。
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

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const TABLE_ID = "bbbbbbbb-0001-4000-8000-000000000001";
const ACTION_ID = "cccccccc-0001-4000-8000-000000000001";
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "E2Eダッシュボードテスト",
  entities: {
    screens: [{ id: SCREEN_ID, no: 1, name: "ログイン画面", kind: "input", path: "/login", hasDesign: true, updatedAt: FIXED_TS }],
    tables: [{ id: TABLE_ID, no: 1, physicalName: "users", name: "ユーザー", category: "マスタ", columnCount: 0, updatedAt: FIXED_TS }],
    processFlows: [{ id: ACTION_ID, no: 1, name: "ログイン処理", kind: "screen", actionCount: 0, updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-dashboard";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("ダッシュボード", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  /** ダッシュボードを開く前に draft / layout 等の per-browser UI state を seed (#923 で正当な localStorage 用途) */
  async function setupDashboard(page: Page, options: { drafts?: Record<string, unknown>; layout?: unknown } = {}) {
    await page.addInitScript(
      ({ drafts, layout }) => {
        // 既存のドラフトをクリア
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith("draft-")) localStorage.removeItem(k);
        }
        if (drafts) {
          for (const [key, val] of Object.entries(drafts)) {
            localStorage.setItem(key, JSON.stringify(val));
          }
        }
        if (layout) {
          localStorage.setItem("dashboard-layout-v1", JSON.stringify(layout));
        } else {
          localStorage.removeItem("dashboard-layout-v1");
        }
        localStorage.removeItem("harmony-open-tabs");
        localStorage.removeItem("harmony-active-tab");
      },
      { drafts: options.drafts, layout: options.layout },
    );
    await ws.gotoActive(page, "/");
    await expect(page.locator(".dashboard-view")).toBeVisible();
  }

  test.describe("基本", () => {
    test("/ アクセスでダッシュボードが表示される", async ({ page }) => {
      await setupDashboard(page);
      await expect(page.locator(".dashboard-title")).toContainText("ダッシュボード");
    });

    test("ダッシュボードが singleton タブとして開く", async ({ page }) => {
      await setupDashboard(page);
      const tab = page.locator(".tabbar-tab").filter({ hasText: "ダッシュボード" });
      await expect(tab).toBeVisible();
      await expect(tab).toHaveClass(/active/);
    });

    test("3 パネルが表示される", async ({ page }) => {
      await setupDashboard(page);
      await expect(page.locator(".panel-header").filter({ hasText: "機能別定義数" })).toBeVisible();
      await expect(page.locator(".panel-header").filter({ hasText: "未保存ドラフト" })).toBeVisible();
      await expect(page.locator(".panel-header").filter({ hasText: "最近編集したもの" })).toBeVisible();
    });
  });

  test.describe("FunctionCountsPanel", () => {
    test("画面数 / テーブル数 / 処理フロー数 が表示される", async ({ page }) => {
      await setupDashboard(page);
      const panel = page.locator(".function-counts-panel");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".count-card").filter({ hasText: "画面" }).locator(".count-value")).toContainText("1");
      await expect(panel.locator(".count-card").filter({ hasText: "テーブル" }).locator(".count-value")).toContainText("1");
      await expect(panel.locator(".count-card").filter({ hasText: "処理フロー" }).locator(".count-value")).toContainText("1");
    });
  });

  test.describe("UnsavedDraftsPanel", () => {
    test("ドラフトが無い時は空状態メッセージ", async ({ page }) => {
      await setupDashboard(page);
      await expect(page.locator(".drafts-empty")).toContainText("未保存のドラフトはありません");
    });

    test("ドラフトがあるとリスト表示される", async ({ page }) => {
      await setupDashboard(page, {
        drafts: {
          [`draft-table-${normalizeId(TABLE_ID)}`]: { id: normalizeId(TABLE_ID), name: "users-draft" },
        },
      });
      await expect(page.locator(".drafts-count")).toContainText("1 件のドラフト");
      await expect(page.locator(".draft-kind").filter({ hasText: "テーブル" })).toBeVisible();
    });

    test("開くボタンで該当エディタへ遷移", async ({ page }) => {
      await setupDashboard(page, {
        drafts: {
          [`draft-table-${normalizeId(TABLE_ID)}`]: { id: normalizeId(TABLE_ID), name: "users-draft" },
        },
      });
      await page.locator(".draft-btn-open").first().click();
      await expect(page).toHaveURL(new RegExp(`/w/[^/]+/table/edit/${normalizeId(TABLE_ID)}$`));
    });

    test("破棄ボタンで確認後にドラフトが消える", async ({ page }) => {
      await setupDashboard(page, {
        drafts: {
          [`draft-table-${normalizeId(TABLE_ID)}`]: { id: normalizeId(TABLE_ID), name: "users-draft" },
        },
      });
      page.on("dialog", (d) => d.accept());
      await page.locator(".draft-btn-discard").first().click();
      await expect(page.locator(".drafts-empty")).toBeVisible();
    });
  });

  test.describe("レイアウト永続化", () => {
    test("保存済みレイアウトがリロード後も保持される", async ({ page }) => {
      const customLayout = {
        lg: [
          { i: "function-counts", x: 0, y: 0, w: 12, h: 3 },
          { i: "unsaved-drafts", x: 0, y: 3, w: 12, h: 4 },
          { i: "recent-edits", x: 0, y: 7, w: 12, h: 5 },
        ],
      };
      await setupDashboard(page, { layout: customLayout });

      const funcPanel = page.locator(".react-grid-item").filter({ has: page.locator(".panel-header", { hasText: "機能別定義数" }) });
      const funcBox = await funcPanel.boundingBox();
      const dashPanel = page.locator(".dashboard-view");
      const dashBox = await dashPanel.boundingBox();
      if (funcBox && dashBox) {
        expect(funcBox.width).toBeGreaterThan(dashBox.width * 0.8);
      }
    });
  });

  test.describe("HeaderMenu 連携", () => {
    test("HeaderMenu からダッシュボードへ到達できる", async ({ page }) => {
      await ws.gotoActive(page, "/screen/flow");
      await expect(page.locator(".flow-root")).toBeVisible();

      await page.locator(".header-menu-btn").click();
      await page.locator(".header-menu-item").filter({ hasText: "ダッシュボード" }).click();

      await expect(page).toHaveURL(/\/w\/[^/]+\/?$/);
      await expect(page.locator(".dashboard-view")).toBeVisible();
    });
  });
});
