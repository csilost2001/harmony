/**
 * Screen rename smoke (ScreenListView 起点) — #1370
 *
 * #1330 で実装した「行右クリック → ID 変更…」起動点の e2e。本体機能 PR #1369 では
 * scope 外として trace を確立、本 ISSUE で実装する。
 *
 * 検証:
 *   1. ScreenListView でターゲット行を右クリック → context menu 表示
 *   2. 「ID 変更…」を click → RenameEntityDialog 表示
 *   3. 新 id 入力 → 「シミュレーション」 → 「実行」
 *   4. URL は `/screen/list` に留まる (`skipOpenNewTab: true` / `originRoute: () => "/screen/list"`)
 *   5. 一覧の行 id が新 id に reflect される
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const WS_KEY = "issue-1370-screen-list-rename";
const OLD_SCREEN_ID = "cart";
const NEW_SCREEN_ID = "cart-renamed-1370-list";

let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe.configure({ mode: "serial" });

test.describe("Screen rename smoke (ScreenListView 起点) — #1370", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      fromExample: "retail",
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page: _page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("ScreenListView 行右クリック起点で rename 後 /screen/list に留まり行 id が更新される", async ({ page }) => {
    // 1. ScreenListView へ navigate
    await ws.gotoActive(page, "/screen/list");
    await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 10000 });

    // 行が render されるまで待つ (sort 適用後の DOM 確定を保証)
    const targetRow = page.locator(`[data-row-id="${OLD_SCREEN_ID}"]`).first();
    await expect(targetRow).toBeVisible({ timeout: 10000 });

    // 2. 単一選択してから右クリック (#1330: 「ID 変更は 1 件選択時のみ」)
    await targetRow.click();
    await targetRow.click({ button: "right" });

    // 3. context menu の「ID 変更…」を click
    const renameItem = page.getByTestId("list-context-menu-item-rename-id");
    await expect(renameItem).toBeVisible({ timeout: 5000 });
    await expect(renameItem).toBeEnabled();
    await renameItem.click();

    // 4. RenameEntityDialog 表示 → 新 id 入力 → 「シミュレーション」
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("entity-id-input").fill(NEW_SCREEN_ID);
    const previewBtn = page.getByTestId("rename-entity-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 3000 });
    await previewBtn.click();
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 5000 });

    // 5. 「実行」 → URL は /screen/list 維持 (#1330 の核)
    const execBtn = page.getByTestId("rename-entity-execute-btn");
    await expect(execBtn).toBeEnabled();
    await execBtn.click();

    // URL が `/screen/list` のまま (起動点維持) — wsId prefix を含む path で検証
    await expect(page).toHaveURL(/\/screen\/list(\?|$)/, { timeout: 10000 });

    // 6. 一覧の行 id が新 id に更新される (backend `screenChanged` broadcast → editor.reload()
    //    経由で再描画される。timeout は broadcast + reload の round trip を見越して長めに取る)
    await expect(page.locator(`[data-row-id="${NEW_SCREEN_ID}"]`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-row-id="${OLD_SCREEN_ID}"]`)).toHaveCount(0, { timeout: 5000 });
  });
});
