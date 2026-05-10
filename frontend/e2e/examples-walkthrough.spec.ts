/**
 * examples-walkthrough endurance spec — ISSUE #931
 *
 * 5 つの example ワークスペース (retail / english-learning /
 * english-learning-tailwind / realestate / diary) を順次展開し、各々で:
 *   - 全 singleton 画面 (Dashboard / 画面フロー / 画面一覧 / テーブル一覧 /
 *     ER 図 / 処理フロー一覧 / 拡張管理) を順次 open
 *   - 個別エディタ (Designer / TableEditor / ProcessFlowEditor) の open
 *   - TableEditor / ProcessFlowEditor の round-trip (編集 → 保存 → タブ閉じる
 *     → 再オープン → 反映確認)
 *   - 各 example のドメイン特性 (table 数 / Puck container / cssFramework 等) を
 *     最低 1 検証
 *
 * タグ: @endurance — デフォルト除外、E2E_INCLUDE_ENDURANCE=1 で実行。
 *
 * 実行コマンド (canonical):
 *   npm run test:e2e:endurance       # E2E_INCLUDE_ENDURANCE=1 を内包
 *
 * `npm run test:e2e -- --grep @endurance` のみだと playwright.config の
 * `grepInvert: /@endurance/` (E2E_INCLUDE_ENDURANCE 未設定時にデフォルト適用) が
 * 後勝ちで効くため 0 tests になる。AC 文言の `--grep @endurance` を素のまま
 * 受け取らないこと (#930 で導入された env-gated 除外仕様)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { isMcpRunning, sendBrowserRequest } from "./mcp/_helpers";
import {
  cleanupRealWorkspaces,
  copyExampleWorkspace,
  resetWorkspaceRuntimeState,
  type RealWorkspaceFixture,
} from "./helpers/realWorkspace";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExampleSpec {
  name: string;       // examples/<name>
  fixtureKey: string; // unique key for copyExampleWorkspace
  domainAssertion: (page: Page, workspacePath: string) => Promise<void>;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * harmony.json をファイルシステムから直接読み込む。
 * sendBrowserRequest 経由だと RPC 名不一致 / レスポンス shape 不一致 /
 * per-session activePath 未設定の問題があるため fs 直読みで代替する。
 */
async function readHarmonyJson(workspacePath: string): Promise<{
  techStack?: { designer?: { cssFramework?: string; editorKind?: string } };
}> {
  const file = path.join(workspacePath, "harmony.json");
  const content = await fs.readFile(file, "utf-8");
  return JSON.parse(content);
}

/**
 * SPA navigation (history.pushState) でワークスペース接続を維持しながら遷移する。
 * page.goto は WS 接続を切断するため使用しない (#945)。
 */
async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p: string) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/**
 * 現在の URL から /w/<wsId> prefix を取得する。
 * workspace-navigation-smoke.spec.ts lines 45-50 と同一実装。
 */
async function currentWorkspaceRoot(page: Page): Promise<string> {
  const pathname = await page.evaluate(() => location.pathname);
  const match = pathname.match(/^\/w\/[^/]+/);
  if (!match) throw new Error(`workspace URL expected, got ${pathname}`);
  return match[0];
}

/**
 * /workspace/select から workspace を追加してダッシュボードへ遷移する。
 * workspace-navigation-smoke.spec.ts lines 22-33 と同一実装。
 */
async function addWorkspaceFromSelect(page: Page, workspacePath: string): Promise<void> {
  await page.goto("/workspace/select");
  await page.locator("button").filter({ has: page.locator(".bi-plus-lg") }).first().click();
  await expect(page.locator(".tbl-modal")).toBeVisible();
  await page.locator(".tbl-modal input[type='text']").fill(workspacePath);
  // 400ms debounce + inspectWorkspace RPC を待つ → status: ready → primary 「開く」 が出る
  const primaryBtn = page.locator(".tbl-modal .tbl-btn-primary");
  await expect(primaryBtn).toBeVisible({ timeout: 10000 });
  await expect(primaryBtn).toBeEnabled();
  await primaryBtn.click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/$/);
  await expect(page.locator(".dashboard-view")).toBeVisible();
}

/**
 * HeaderMenu から各 singleton 画面へ遷移して root 要素の存在を確認する。
 * workspace-navigation-smoke.spec.ts lines 137-148 と同一順序。
 */
async function visitAllSingletons(page: Page): Promise<void> {
  const navigate = async (label: string, urlPattern: RegExp, contentSelector: string) => {
    await page.locator(".header-menu-btn").click();
    await page.locator(".header-menu-item").filter({ hasText: label }).click();
    await expect(page).toHaveURL(urlPattern);
    await expect(page.locator(contentSelector)).toBeVisible({ timeout: 15000 });
  };

  const wsPrefix = /\/w\/[^/]+/;
  await navigate("画面フロー",    new RegExp(`${wsPrefix.source}/screen/flow$`),        ".flow-root");
  await navigate("画面一覧",      new RegExp(`${wsPrefix.source}/screen/list$`),        ".screen-list-page");
  await navigate("テーブル一覧",  new RegExp(`${wsPrefix.source}/table/list$`),         ".table-list-page");
  await navigate("ER図",          new RegExp(`${wsPrefix.source}/table/er$`),           ".er-diagram, .er-diagram-page, .er-page");
  await navigate("処理フロー一覧",new RegExp(`${wsPrefix.source}/process-flow/list$`),  ".process-flow-page");
  await navigate("拡張管理",      new RegExp(`${wsPrefix.source}/extensions$`),         ".extensions-panel, .extensions-page");
  await navigate("ダッシュボード",new RegExp(`${wsPrefix.source}/$`),                   ".dashboard-view");
}

/**
 * ResumeOrDiscardDialog が表示されている場合に破棄して閉じる。
 * save-reset.spec.ts lines 85-91 と同一パターン。
 */
async function dismissResumeDialogIfAny(page: Page): Promise<void> {
  const backdrop = page.locator(".edit-mode-modal-backdrop");
  if (await backdrop.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null;
      btn?.click();
    });
    await expect(backdrop).toBeHidden({ timeout: 5000 });
  }
}

/**
 * 画面一覧から最初の画面デザイナーを開いて確認し、タブを閉じる。
 * editorKind に応じて .designer-root (GrapesJS) または
 * [data-testid='puck-editor-container'] (Puck) のいずれかが存在すれば OK。
 */
async function openAndCloseDesigner(page: Page): Promise<void> {
  const wsRoot = await currentWorkspaceRoot(page);
  const wsPrefix = "/w/[^/]+";
  await spaNavigate(page, `${wsRoot}/screen/list`);
  await expect(page.locator(".screen-list-page")).toBeVisible({ timeout: 15000 });
  const firstRow = page.locator("[data-row-id]").first();
  await expect(firstRow).toBeVisible({ timeout: 10000 });
  await firstRow.dblclick();
  await expect(page).toHaveURL(new RegExp(`${wsPrefix}/screen/design/[^/]+$`));
  // GrapesJS または Puck のどちらかが表示されれば OK (20 秒 timeout)
  await expect(
    page.locator(".designer-root, [data-testid='puck-editor-container']"),
  ).toBeVisible({ timeout: 20000 });
  // アクティブタブを閉じる
  await page.locator(".tabbar-tab.active .tabbar-tab-close").click({ force: true });
  // 閉じた後 URL が変化することを待つ (完全消滅しなくても OK)
  await page.waitForTimeout(500);
}

/**
 * TableEditor の round-trip テスト:
 *   テーブル一覧 → 最初の行をダブルクリック → edit mode → カラム追加 →
 *   Ctrl+S 保存 → タブ閉じる → 再オープン → カラム数 +1 確認
 */
async function roundTripTableEditor(page: Page): Promise<void> {
  const wsRoot = await currentWorkspaceRoot(page);
  const wsPrefix = "/w/[^/]+";

  // 1. テーブル一覧へ SPA 遷移
  await spaNavigate(page, `${wsRoot}/table/list`);
  await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 15000 });

  // 2. 最初の行を取得してダブルクリック
  const firstRow = page.locator(".table-list-page [data-row-id]").first();
  await expect(firstRow).toBeVisible({ timeout: 10000 });
  const tableId = await firstRow.getAttribute("data-row-id");
  await firstRow.dblclick();
  await expect(page).toHaveURL(new RegExp(`${wsPrefix}/table/edit/[^/]+$`));
  await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 15000 });

  // 3. ResumeOrDiscardDialog を dismiss
  await dismissResumeDialogIfAny(page);

  // 4. 編集モードに入る
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

  // 5. カラム追加前のカラム行数を計測
  // DataList で columns-data-list の中の [data-row-id] が各カラム行に対応する
  // columns タブが既にアクティブ (デフォルト) であること前提。
  // edit-mode 切替直後は DataList が一瞬空の可能性があるため、最低 1 行が出現するまで待つ
  // (carrousel 元で 0 行だった場合は、テーブルが空のため round-trip 検証は意味が薄いが、
  //  まずは最低 1 行 visible を待って、count() がゼロでない安定値になるのを保証する)
  const columnRowSelector = ".columns-data-list [data-row-id]";
  await page.locator(columnRowSelector).first().waitFor({ state: "visible", timeout: 10000 });
  const beforeCount = await page.locator(columnRowSelector).count();

  // 6. カラム追加ボタンをクリック
  await page.getByRole("button", { name: /カラム追加/ }).click();
  // dirty マークが出ることを確認
  await expect(page.locator(".tabbar-tab.dirty").first()).toBeVisible({ timeout: 5000 });

  // 7. Ctrl+S で保存 → save ボタンが無効になることを確認
  await page.keyboard.press("Control+s");
  await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 10000 });

  // 8. アクティブタブを閉じる
  await page.locator(".tabbar-tab.active .tabbar-tab-close").click({ force: true });
  await page.waitForTimeout(500);

  // 9. テーブル一覧に戻って同じ行を再オープン
  await spaNavigate(page, `${wsRoot}/table/list`);
  await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 15000 });
  if (tableId) {
    await page.locator(`[data-row-id="${tableId}"]`).first().dblclick();
  } else {
    await page.locator(".table-list-page [data-row-id]").first().dblclick();
  }
  // 再オープン後に edit URL であることを明示的に確認
  // (.table-editor-page は editor 専用 root class のため list と取り違えは起きないが、
  //  ProcessFlowEditor 側で発生しうる class 共有問題と整合させるため URL 確認を追加)
  await expect(page).toHaveURL(new RegExp(`${wsPrefix}/table/edit/[^/]+$`));
  await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 15000 });
  await dismissResumeDialogIfAny(page);
  // readonly モードのまま表示されているため edit-mode-start があるはず
  // カラム数を読み取る (readonly でも DataList は表示される)
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

  // 10. カラム行数が +1 されていることを確認
  // 再オープン後の DataList render を待ってから count() (5. と同じガード)
  await page.locator(columnRowSelector).first().waitFor({ state: "visible", timeout: 10000 });
  const afterCount = await page.locator(columnRowSelector).count();
  expect(afterCount).toBe(beforeCount + 1);

  // 11. edit mode から抜ける (次テストの干渉防止) — discard
  await page.getByTestId("edit-mode-discard").click().catch(() => undefined);
  if (await page.getByTestId("discard-confirm").isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.getByTestId("discard-confirm").click();
  }
}

/**
 * ProcessFlowEditor の round-trip テスト:
 *   処理フロー一覧 → 最初の行をダブルクリック → edit mode → アクション追加 →
 *   Ctrl+S 保存 → タブ閉じる → 再オープン → アクション(タブ)数 +1 確認
 */
async function roundTripProcessFlowEditor(page: Page): Promise<void> {
  const wsRoot = await currentWorkspaceRoot(page);
  const wsPrefix = "/w/[^/]+";

  // 1. 処理フロー一覧へ SPA 遷移
  await spaNavigate(page, `${wsRoot}/process-flow/list`);
  await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 10000 });

  // 2. 最初の行をダブルクリック
  const firstPfRow = page.locator(".process-flow-page [data-row-id]").first();
  await expect(firstPfRow).toBeVisible({ timeout: 10000 });
  const pfId = await firstPfRow.getAttribute("data-row-id");
  await firstPfRow.dblclick();
  await expect(page).toHaveURL(new RegExp(`${wsPrefix}/process-flow/edit/[^/]+$`));
  await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 15000 });

  // 3. ResumeOrDiscardDialog を dismiss
  await dismissResumeDialogIfAny(page);

  // 4. 編集モードに入る
  const editStartBtn = page.getByTestId("edit-mode-start");
  await expect(editStartBtn).toBeVisible({ timeout: 5000 });
  await editStartBtn.click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

  // 5. アクション(タブ)数を計測
  const tabSelector = ".process-flow-tab";
  const beforeCount = await page.locator(tabSelector).count();

  // 6. アクション追加ボタンをクリック → モーダルに名前入力 → 確定
  const actionName = `e2e-walk-${Date.now()}`;
  await page.locator(".process-flow-tab-add").click();
  await page.locator(".process-flow-modal input.form-control").first().fill(actionName);
  await page.locator(".process-flow-modal button.btn-primary").click();
  await expect(page.locator(".process-flow-modal")).not.toBeVisible({ timeout: 5000 });

  // 7. Ctrl+S で保存
  await page.keyboard.press("Control+s");
  await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 10000 });

  // 8. アクティブタブを閉じる
  await page.locator(".tabbar-tab.active .tabbar-tab-close").click({ force: true });
  await page.waitForTimeout(500);

  // 9. 処理フロー一覧に戻って同じ行を再オープン
  await spaNavigate(page, `${wsRoot}/process-flow/list`);
  await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 10000 });
  if (pfId) {
    await page.locator(`[data-row-id="${pfId}"]`).first().dblclick();
  } else {
    await page.locator(".process-flow-page [data-row-id]").first().dblclick();
  }
  // 再オープン後に edit URL であることを明示的に確認。
  // ProcessFlowListView と ProcessFlowEditor は同じ `.process-flow-page` class を root
  // に持つため、URL を見ないと list が表示されたまま検証が通る誤動作を起こしうる。
  await expect(page).toHaveURL(new RegExp(`${wsPrefix}/process-flow/edit/[^/]+$`));
  await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 15000 });
  await dismissResumeDialogIfAny(page);

  // 10. 編集モードに入ってアクション数を確認
  const editStartBtn2 = page.getByTestId("edit-mode-start");
  await expect(editStartBtn2).toBeVisible({ timeout: 5000 });
  await editStartBtn2.click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

  const afterCount = await page.locator(tabSelector).count();
  expect(afterCount).toBe(beforeCount + 1);

  // 11. edit mode から抜ける (次テストの干渉防止) — discard
  await page.getByTestId("edit-mode-discard").click().catch(() => undefined);
  if (await page.getByTestId("discard-confirm").isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.getByTestId("discard-confirm").click();
  }
}

/**
 * ViewDefinition round-trip (optional: VD がゼロ件のワークスペースではスキップ)。
 * /view-definition/list に遷移して [data-row-id] が 0 件なら早期 return。
 */
async function maybeRoundTripViewDefinition(page: Page): Promise<void> {
  const wsRoot = await currentWorkspaceRoot(page);
  await spaNavigate(page, `${wsRoot}/view-definition/list`);
  // ページが存在しない場合 (route 未定義) は 404 扱いになるため寛容に待つ
  await page.waitForTimeout(1000);
  // [data-row-id] が 1 件以上あれば smoke check
  const rowCount = await page.locator("[data-row-id]").count();
  if (rowCount === 0) return;

  const firstRow = page.locator("[data-row-id]").first();
  await firstRow.dblclick();
  // ViewDefinitionEditor は .table-editor-page を root class として共有 (realWorkspace.ts 参照)
  await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 15000 });
}

// ── Example specs ─────────────────────────────────────────────────────────────

const EXAMPLES: ExampleSpec[] = [
  {
    name: "retail",
    fixtureKey: "issue-931-retail",
    domainAssertion: async (page: Page, workspacePath: string) => {
      void workspacePath;
      // retail: テーブル 8 件 (multi-store / EC / POS / 在庫 mix) — 最低 5 件を確認
      const wsRoot = await currentWorkspaceRoot(page);
      await spaNavigate(page, `${wsRoot}/table/list`);
      await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 15000 });
      const rows = await page.locator("[data-row-id]").count();
      expect(rows).toBeGreaterThanOrEqual(5);
    },
  },
  {
    name: "english-learning",
    fixtureKey: "issue-931-english-learning",
    domainAssertion: async (page: Page, workspacePath: string) => {
      // english-learning: editorKind=grapesjs / cssFramework=bootstrap
      // 画面一覧の最初の画面を開いて GrapesJS エディタが起動することを確認
      const wsRoot = await currentWorkspaceRoot(page);
      await spaNavigate(page, `${wsRoot}/screen/list`);
      await expect(page.locator(".screen-list-page")).toBeVisible({ timeout: 15000 });
      const firstScreen = page.locator("[data-row-id]").first();
      await expect(firstScreen).toBeVisible({ timeout: 10000 });
      await firstScreen.dblclick();
      // GrapesJS の場合: .designer-root が表示される
      await expect(
        page.locator(".designer-root, [data-testid='puck-editor-container']"),
      ).toBeVisible({ timeout: 20000 });
      // techStack を harmony.json から直接読む
      const project = await readHarmonyJson(workspacePath);
      expect(project.techStack?.designer?.editorKind).toBe("grapesjs");
      expect(project.techStack?.designer?.cssFramework).toBe("bootstrap");
    },
  },
  {
    name: "english-learning-tailwind",
    fixtureKey: "issue-931-english-tailwind",
    domainAssertion: async (page: Page, workspacePath: string) => {
      // english-learning-tailwind: editorKind=puck / cssFramework=tailwind
      const wsRoot = await currentWorkspaceRoot(page);
      await spaNavigate(page, `${wsRoot}/screen/list`);
      await expect(page.locator(".screen-list-page")).toBeVisible({ timeout: 15000 });
      const firstScreen = page.locator("[data-row-id]").first();
      await expect(firstScreen).toBeVisible({ timeout: 10000 });
      await firstScreen.dblclick();
      // Puck エディタが表示されることを確認
      await expect(
        page.locator("[data-testid='puck-editor-container']"),
      ).toBeVisible({ timeout: 20000 });
      // techStack を harmony.json から直接読む
      const project = await readHarmonyJson(workspacePath);
      expect(project.techStack?.designer?.editorKind).toBe("puck");
      expect(project.techStack?.designer?.cssFramework).toBe("tailwind");
    },
  },
  {
    name: "realestate",
    fixtureKey: "issue-931-realestate",
    domainAssertion: async (page: Page, workspacePath: string) => {
      void workspacePath;
      // realestate: テーブル 1 件のみ (minimal sample)
      const wsRoot = await currentWorkspaceRoot(page);
      await spaNavigate(page, `${wsRoot}/table/list`);
      await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 15000 });
      const rows = await page.locator("[data-row-id]").count();
      expect(rows).toBe(1);
    },
  },
  {
    name: "diary",
    fixtureKey: "issue-931-diary",
    domainAssertion: async (page: Page, workspacePath: string) => {
      void workspacePath;
      // diary: 処理フロー 17 件 (AI flows + photo upload) — 最低 10 件を確認
      const wsRoot = await currentWorkspaceRoot(page);
      await spaNavigate(page, `${wsRoot}/process-flow/list`);
      await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 10000 });
      const rows = await page.locator("[data-row-id]").count();
      expect(rows).toBeGreaterThanOrEqual(10);
    },
  },
];

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe(
  "examples-walkthrough endurance with backend",
  { tag: ["@endurance"] },
  () => {
    let mcpAvailable = false;
    const fixtures: Record<string, RealWorkspaceFixture> = {};

    test.beforeAll(async () => {
      mcpAvailable = await isMcpRunning();
      if (!mcpAvailable) return;
      for (const ex of EXAMPLES) {
        fixtures[ex.fixtureKey] = await copyExampleWorkspace(ex.name, ex.fixtureKey);
        await sendBrowserRequest("workspace.open", { path: fixtures[ex.fixtureKey].workspacePath });
      }
    });

    test.afterAll(async () => {
      if (!mcpAvailable) return;
      await cleanupRealWorkspaces(EXAMPLES.map((e) => e.fixtureKey));
    });

    test.beforeEach(async () => {
      test.skip(!mcpAvailable, "backend (port 5179) is not running");
    });

    test.afterEach(async ({ page }) => {
      if (!mcpAvailable) return;
      // editSessionStore の残骸を次テストに引き継がせないためにリセット
      await resetWorkspaceRuntimeState(page).catch(() => undefined);
    });

    for (const ex of EXAMPLES) {
      test(
        `${ex.name}: 全 singleton 画面遷移 + 個別エディタ round-trip`,
        async ({ page }) => {
          const wsPath = fixtures[ex.fixtureKey].workspacePath;
          // ワークスペースを開いてダッシュボードへ遷移
          await addWorkspaceFromSelect(page, wsPath);

          // 全 singleton 画面をヘッダーメニューから順に訪問
          await visitAllSingletons(page);

          // 画面デザイナーを開いて確認 → タブ閉じる
          await openAndCloseDesigner(page);

          // TableEditor の round-trip (編集 → 保存 → 閉じる → 再オープン → 確認)
          await roundTripTableEditor(page);

          // ProcessFlowEditor の round-trip
          await roundTripProcessFlowEditor(page);

          // ViewDefinition round-trip (VD がある場合のみ)
          await maybeRoundTripViewDefinition(page);

          // ドメイン固有アサーション
          await ex.domainAssertion(page, wsPath);
        },
      );
    }
  },
);
