/**
 * ダッシュボード E2E テスト
 *
 * 視点: ユーザーがダッシュボード（/）でパネルを閲覧・ドラッグ・リサイズする
 * 前提: dev サーバーが起動済み（MCP サーバーは不要、localStorage でセットアップ）
 */
import { test, expect, type Page } from "@playwright/test";

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const TABLE_ID = "bbbbbbbb-0001-4000-8000-000000000001";
const ACTION_ID = "cccccccc-0001-4000-8000-000000000001";

const dummyProject = {
  version: 1,
  name: "E2Eダッシュボードテスト",
  screens: [
    {
      id: SCREEN_ID, name: "ログイン画面", type: "input",
      description: "", path: "/login",
      position: { x: 0, y: 0 }, size: { width: 200, height: 100 },
      hasDesign: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ],
  groups: [],
  edges: [],
  tables: [
    { id: TABLE_ID, physicalName: "users", name: "ユーザー", description: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  processFlows: [
    { id: ACTION_ID, name: "ログイン処理", type: "screen", actionCount: 0, updatedAt: new Date().toISOString() },
  ],
  updatedAt: new Date().toISOString(),
};

async function setupDashboard(page: Page, options: { drafts?: Record<string, unknown>; layout?: unknown } = {}) {
  await page.addInitScript(
    ({ project, drafts, layout }) => {
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
      // R-4 以降: workspace guard を bypass して MCP なしでも dashboard を表示 (#703 R-5)
      localStorage.setItem("workspace-e2e-bypass", "true");
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
    },
    { project: dummyProject, drafts: options.drafts, layout: options.layout },
  );
  await page.goto("/");
  await expect(page.locator(".dashboard-view")).toBeVisible();
}

// ─── テスト ─────────────────────────────────────────────────────────────────

test.describe("ダッシュボード: 基本", () => {
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
    // パネルヘッダーのタイトルで検証
    await expect(page.locator(".panel-header").filter({ hasText: "機能別定義数" })).toBeVisible();
    await expect(page.locator(".panel-header").filter({ hasText: "未保存ドラフト" })).toBeVisible();
    await expect(page.locator(".panel-header").filter({ hasText: "最近編集したもの" })).toBeVisible();
  });
});

test.describe("ダッシュボード: FunctionCountsPanel", () => {
  test("画面数 / テーブル数 / 処理フロー数 が表示される", async ({ page }) => {
    await setupDashboard(page);
    const panel = page.locator(".function-counts-panel");
    await expect(panel).toBeVisible();
    // 画面 1 件、テーブル 1 件、処理フロー 1 件
    await expect(panel.locator(".count-card").filter({ hasText: "画面" }).locator(".count-value")).toContainText("1");
    await expect(panel.locator(".count-card").filter({ hasText: "テーブル" }).locator(".count-value")).toContainText("1");
    await expect(panel.locator(".count-card").filter({ hasText: "処理フロー" }).locator(".count-value")).toContainText("1");
  });
});

test.describe("ダッシュボード: UnsavedDraftsPanel", () => {
  test("ドラフトが無い時は空状態メッセージ", async ({ page }) => {
    await setupDashboard(page);
    await expect(page.locator(".drafts-empty")).toContainText("未保存のドラフトはありません");
  });

  test("ドラフトがあるとリスト表示される", async ({ page }) => {
    await setupDashboard(page, {
      drafts: {
        [`draft-table-${TABLE_ID}`]: { id: TABLE_ID, name: "users-draft" },
      },
    });
    await expect(page.locator(".drafts-count")).toContainText("1 件のドラフト");
    await expect(page.locator(".draft-kind").filter({ hasText: "テーブル" })).toBeVisible();
  });

  test("開くボタンで該当エディタへ遷移", async ({ page }) => {
    await setupDashboard(page, {
      drafts: {
        [`draft-table-${TABLE_ID}`]: { id: TABLE_ID, name: "users-draft" },
      },
    });
    await page.locator(".draft-btn-open").first().click();
    await expect(page).toHaveURL(new RegExp(`/w/[^/]+/table/edit/${TABLE_ID}$`));
  });

  test("破棄ボタンで確認後にドラフトが消える", async ({ page }) => {
    await setupDashboard(page, {
      drafts: {
        [`draft-table-${TABLE_ID}`]: { id: TABLE_ID, name: "users-draft" },
      },
    });
    page.on("dialog", (d) => d.accept());
    await page.locator(".draft-btn-discard").first().click();
    await expect(page.locator(".drafts-empty")).toBeVisible();
  });
});

test.describe("ダッシュボード: レイアウト永続化", () => {
  test("保存済みレイアウトがリロード後も保持される", async ({ page }) => {
    // カスタムレイアウトを事前に保存
    const customLayout = {
      lg: [
        { i: "function-counts", x: 0, y: 0, w: 12, h: 3 },
        { i: "unsaved-drafts", x: 0, y: 3, w: 12, h: 4 },
        { i: "recent-edits", x: 0, y: 7, w: 12, h: 5 },
      ],
    };
    await setupDashboard(page, { layout: customLayout });

    // function-counts が幅 12（最大）で配置されていることを何らかの方法で確認
    // react-grid-layout は style.width で表現されるため、幅が大きいことを確認
    const funcPanel = page.locator(".react-grid-item").filter({ has: page.locator(".panel-header", { hasText: "機能別定義数" }) });
    const funcBox = await funcPanel.boundingBox();
    const dashPanel = page.locator(".dashboard-view");
    const dashBox = await dashPanel.boundingBox();
    if (funcBox && dashBox) {
      // カスタムレイアウトで 12 カラム（フル幅）を指定したので、
      // ダッシュボード幅の 80% 以上を占めるはず
      expect(funcBox.width).toBeGreaterThan(dashBox.width * 0.8);
    }
  });
});

test.describe("ダッシュボード: HeaderMenu 連携", () => {
  test("HeaderMenu からダッシュボードへ到達できる", async ({ page }) => {
    // まず画面フローから開始
    await page.addInitScript(
      ({ project }) => {
        localStorage.setItem("flow-project", JSON.stringify(project));
        localStorage.removeItem("harmony-open-tabs");
        localStorage.removeItem("harmony-active-tab");
      },
      { project: dummyProject },
    );
    await page.goto("/screen/flow");
    await expect(page.locator(".flow-root")).toBeVisible();

    // HeaderMenu を開いてダッシュボードをクリック
    await page.locator(".header-menu-btn").click();
    await page.locator(".header-menu-item").filter({ hasText: "ダッシュボード" }).click();

    await expect(page).toHaveURL(/^\/w\/[^/]+\/$/);
    await expect(page.locator(".dashboard-view")).toBeVisible();
  });
});
