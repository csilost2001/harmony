/**
 * Rename entity undo restore E2E — page reload 後の undo capability 復元 smoke
 * (#1299 I-7 Round 3 G-4 / K-4 申し送り、RFC #1284 / メタ #1292)
 *
 * テスト対象 (K-4 申し送り):
 *   1. テーブル編集画面で rename 実行 → undo toast 表示
 *   2. page.reload() で editor を unmount → 再 mount
 *   3. `useRenameEntityUndoToast` hook が sessionStorage + bridge `listRecentUndoOperations`
 *      経由で undo state を復元する (TTL 内なので生存)
 *   4. 復元された toast の「元に戻す」ボタンを押 → undo 実行
 *   5. URL が旧 id に戻り、ファイル rename も実際に rollback される
 *
 * 既存 `rename-entity.spec.ts` は rename → 即時 undo の path をカバー、
 * 本 spec は **page reload + TTL 内 bridge 再問合せ** の復元 path をカバー。
 *
 * 参考:
 *   - `frontend/src/components/common/useRenameEntityUndoToast.ts:83-131` (mount 時 restore 経路)
 *   - `frontend/src/components/common/RenameEntityUndoToast.test.tsx` (unit test、TTL 期限切れ等の条件分岐)
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "../helpers/realWorkspace";

const WS_KEY = "issue-1299-rename-undo-restore";
const OLD_TABLE_ID = "order"; // examples/retail/harmony/tables/order.json
const NEW_TABLE_ID = "order-restored-1299";

let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe.configure({ mode: "serial" });

test.describe("Rename entity undo restore — page reload 後の TTL 内復元 (#1299 I-7 K-4)", { tag: ["@regression"] }, () => {
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

  test("rename → page.reload() → undo toast 復元 → undo 実行で旧 id に rollback", async ({ page }) => {
    // 1. テーブル編集画面へ navigate + 編集モード
    await ws.gotoActive(page, `/table/edit/${OLD_TABLE_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });

    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    }

    // 2. id 変更 dialog 経由で rename 実行
    await page.getByTestId("rename-entity-open-btn-table").click();
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("entity-id-input").fill(NEW_TABLE_ID);
    const previewBtn = page.getByTestId("rename-entity-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 3000 });
    await previewBtn.click();
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 5000 });

    const execBtn = page.getByTestId("rename-entity-execute-btn");
    await expect(execBtn).toBeEnabled();
    await execBtn.click();

    // URL が新 id に変わり、undo toast が表示される
    await expect(page).toHaveURL(new RegExp(`/table/edit/${NEW_TABLE_ID}(\\?|$)`), { timeout: 10000 });
    await expect(page.getByTestId("rename-entity-undo-toast")).toBeVisible({ timeout: 5000 });

    // sessionStorage に undo metadata が保存されていることを確認 (前提条件)
    const sessionHasUndo = await page.evaluate((newId) => {
      // useRenameEntityUndoToast の key 規約: `harmony-rename-undo:<wsId>:table:<currentId>`
      // wsId は不明なので全 key を走査して新 id を含む table key を探す
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("harmony-rename-undo:") && key.includes(`:table:${newId}`)) {
          return true;
        }
      }
      return false;
    }, NEW_TABLE_ID);
    expect(sessionHasUndo).toBe(true);

    // 3. page.reload() で editor を unmount → 再 mount (DOM toast が消える)
    await page.reload();
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });

    // 4. useRenameEntityUndoToast hook が sessionStorage + bridge `listRecentUndoOperations`
    //    経由で復元 (TTL 内なので生存)。reload 後に undo toast が再表示されることを assert。
    await expect(page.getByTestId("rename-entity-undo-toast")).toBeVisible({ timeout: 10000 });

    // 5. 復元された toast の「元に戻す」を押 → undo 実行
    await page.getByTestId("rename-entity-undo-btn").click();

    // undo 成功で URL が旧 id に遷移
    await expect(page).toHaveURL(new RegExp(`/table/edit/${OLD_TABLE_ID}(\\?|$)`), { timeout: 10000 });

    // 6. backend file system 上で実際に rollback されているか mcpBridge 経由で確認
    const tableAfterUndo = await page.evaluate(async (id) => {
      const bridge = (window as unknown as { __mcpBridge?: { request: (m: string, p: unknown) => Promise<unknown> } }).__mcpBridge;
      if (!bridge) return null;
      return bridge.request("loadTable", { id }).catch(() => null);
    }, OLD_TABLE_ID);
    expect(tableAfterUndo).not.toBeNull();
  });
});
