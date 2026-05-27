/**
 * Screen rename smoke (ScreenFlow 起点) — #1370
 *
 * #1330 で実装した「ScreenFlow node 右クリック → ID 変更…」起動点の e2e。本体機能
 * PR #1369 では scope 外として trace を確立、本 ISSUE で実装する。
 *
 * 検証:
 *   1. ScreenFlow (画面フロー図) を開く
 *   2. ターゲット node を右クリック → context menu 表示
 *   3. 「ID 変更…」を click → RenameEntityDialog 表示
 *   4. 新 id 入力 → 「シミュレーション」 → 「実行」
 *   5. URL は `/screen/flow` に留まる (skipOpenNewTab + originRoute => "/screen/flow")
 *   6. フロー図上の node が新 id で render される (data-id 属性が更新される)
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { startNewDraft } from "./helpers/editSessionDropdown";

const WS_KEY = "issue-1370-screen-flow-rename";
const OLD_SCREEN_ID = "cart";
const NEW_SCREEN_ID = "cart-renamed-1370-flow";

let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe.configure({ mode: "serial" });

test.describe("Screen rename smoke (ScreenFlow 起点) — #1370", { tag: ["@regression"] }, () => {
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

  test("ScreenFlow node 右クリック起点で rename 後 /screen/flow に留まり node id が更新される", async ({ page }) => {
    // 1. ScreenFlow へ navigate
    await ws.gotoActive(page, "/screen/flow");
    await expect(page.locator(".flow-root, .react-flow").first()).toBeVisible({ timeout: 10000 });

    // ターゲット node が ReactFlow に render されるまで待つ (workers=2 並列下では
    // FlowEditor の lazy project load + ReactFlow fitView がやや遅い)。
    const targetNode = page.locator(`.react-flow__node[data-id="${OLD_SCREEN_ID}"]`);
    await expect(targetNode).toBeVisible({ timeout: 15000 });

    // 編集モードに切替 (rename は !isReadonly 必須 — readonly モードでは ReactFlow の
    // `onNodeContextMenu` が undefined のため context menu 自体が起動しない)。
    //
    // FlowEditor は edit-mode-start ボタンではなく EditSessionDropdown 経由で editing 開始する
    // 設計のため、e2e helper `startNewDraft(page)` を使う (#980-A の `.esd-root` intercept
    // 回避が必須、`locator.click()` 直接呼出しは禁止)。
    //
    // workers=2 並列下で edit-mode-save の表示が 5s を超える事例を Codex Round 1 で観測。
    // FlowEditor は editSession.create + payload fetch + ReactFlow mode 切替 + EditSessionDropdown
    // 内部 re-render の 4 段で role=Edit 反映に時間を要するため 15s 余裕を取る。
    await startNewDraft(page);
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });

    // 2. node を右クリック → context menu 表示
    //
    // Note: ReactFlow の `onNodeContextMenu` は contextmenu イベントを subscribe する。
    // Playwright の `click({ button: "right" })` は actionability check と座標 click を
    // 経由するため間欠的に届かないことがある (flow canvas 上の overlay 要素 / SelectionLayer)。
    // node 要素に直接 dispatchEvent で安定化する。
    await page.evaluate((id) => {
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      node.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, button: 2, clientX: cx, clientY: cy,
      }));
    }, OLD_SCREEN_ID);

    // 3. context menu の「ID 変更…」(flow-node-rename-id-btn) を click
    const renameBtn = page.getByTestId("flow-node-rename-id-btn");
    await expect(renameBtn).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => {
      (document.querySelector('[data-testid="flow-node-rename-id-btn"]') as HTMLButtonElement | null)?.click();
    });

    // 4. RenameEntityDialog 表示 → 新 id 入力 → 「シミュレーション」
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("entity-id-input").fill(NEW_SCREEN_ID);
    const previewBtn = page.getByTestId("rename-entity-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 3000 });
    await previewBtn.click();
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 5000 });

    // 5. 「実行」 → URL は /screen/flow 維持
    const execBtn = page.getByTestId("rename-entity-execute-btn");
    await expect(execBtn).toBeEnabled();
    await execBtn.click();

    await expect(page).toHaveURL(/\/screen\/flow(\?|$)/, { timeout: 10000 });

    // 6. フロー図上の node の data-id が新 id に更新される (`screenChanged` broadcast → reload で
    //    nodes が再構築される。ReactFlow が data-id 属性を更新するまで余裕を持って待つ)
    await expect(page.locator(`.react-flow__node[data-id="${NEW_SCREEN_ID}"]`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`.react-flow__node[data-id="${OLD_SCREEN_ID}"]`)).toHaveCount(0, { timeout: 5000 });
  });
});
