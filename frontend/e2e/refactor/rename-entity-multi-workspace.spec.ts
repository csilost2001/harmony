/**
 * Rename entity multi-workspace E2E — workspace 切替後の undo capability 永続化 smoke
 * (#1299 I-7 Round 3 G-4 / K-2 申し送り、RFC #1284 / メタ #1292)
 *
 * テスト対象 (K-2 申し送り):
 *   1. workspace A で rename 実行 → undo toast 表示 + sessionStorage に保存
 *      (key 規約: `harmony-rename-undo:<wsId>:<entityType>:<currentId>`)
 *   2. workspace B に切替 (gotoActive(B))
 *      → useRenameEntityUndoToast hook の wsId 引数が B に変わり、A の rename metadata
 *         を間違って参照しない (Phase M Codex SF-1 で実装された wsId scoping を実機検証)
 *      → B 側で同 entity (例: order テーブル) を開いても undo toast は表示されない
 *   3. workspace A に戻る → A 側の undo toast が復元される (sessionStorage key は A の wsId なので残存)
 *   4. 復元された toast の「元に戻す」を押 → A 側の rename が正常に rollback
 *
 * 既存 `rename-entity.spec.ts` は単一 workspace の rename/undo path、本 spec は
 * **workspace 跨ぎでの key isolation + 復元** をカバー。
 *
 * 実装側参照:
 *   - `frontend/src/components/common/useRenameEntityUndoToast.ts:39-45` (key 規約 + wsId scoping)
 *   - Phase M Codex SF-1 (#1298 round 8): sessionStorage key に wsId を含める修正
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "../helpers/realWorkspace";

const WS_KEY_A = "issue-1299-rename-mw-A";
const WS_KEY_B = "issue-1299-rename-mw-B";
const OLD_TABLE_ID = "order"; // 両 workspace に共通で存在 (examples/retail/harmony/tables/order.json)
const NEW_TABLE_ID_A = "order-mw-renamed-1299";

let mcpAvailable = false;
let wsA: OpenedWorkspace;
let wsB: OpenedWorkspace;

test.describe.configure({ mode: "serial" });

test.describe("Rename entity multi-workspace — wsId scoped undo capability (#1299 I-7 K-2)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    wsA = await setupTestWorkspace({
      key: WS_KEY_A,
      fromExample: "retail",
    });
    wsB = await setupTestWorkspace({
      key: WS_KEY_B,
      fromExample: "retail",
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY_A, WS_KEY_B]);
  });

  test.beforeEach(async ({ page: _page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("workspace 切替 (A → B → A) を跨いでも A の rename undo capability が復元される", async ({ page }) => {
    // ── Phase 1: workspace A で rename 実行 ──
    await wsA.gotoActive(page, `/table/edit/${OLD_TABLE_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });

    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    }

    await page.getByTestId("rename-entity-open-btn-table").click();
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("entity-id-input").fill(NEW_TABLE_ID_A);
    await page.getByTestId("rename-entity-preview-btn").click();
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("rename-entity-execute-btn").click();

    await expect(page).toHaveURL(new RegExp(`/table/edit/${NEW_TABLE_ID_A}(\\?|$)`), { timeout: 10000 });
    await expect(page.getByTestId("rename-entity-undo-toast")).toBeVisible({ timeout: 5000 });

    // wsA の wsId を含む sessionStorage key が存在することを assert
    const wsAUndoKeyExists = await page.evaluate((newId) => {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("harmony-rename-undo:") && key.includes(`:table:${newId}`)) {
          return key;
        }
      }
      return null;
    }, NEW_TABLE_ID_A);
    expect(wsAUndoKeyExists).not.toBeNull();
    // wsA に scope された key であることを記録 (中身は wsA.wsId)
    expect(wsAUndoKeyExists).toContain(wsA.wsId);

    // ── Phase 2: workspace B に切替 ──
    // gotoActive(B) で per-session activePath を B に切替 + AppShellInner 再 mount
    await wsB.gotoActive(page, `/table/edit/${OLD_TABLE_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });

    // B 側で同 entity (order テーブル、未 rename) を開いても undo toast は表示されない
    // (useRenameEntityUndoToast の key は wsB.wsId scoped、wsA の metadata は引っかからない)
    // 短い待機後、toast が非表示であることを assert
    await page.waitForTimeout(1000);
    const toastOnB = page.getByTestId("rename-entity-undo-toast");
    await expect(toastOnB).not.toBeVisible({ timeout: 2000 });

    // ── Phase 3: workspace A に戻る ──
    await wsA.gotoActive(page, `/table/edit/${NEW_TABLE_ID_A}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });

    // A 側に戻ると undo toast が復元される (sessionStorage は wsA scope で残存、TTL 内)
    await expect(page.getByTestId("rename-entity-undo-toast")).toBeVisible({ timeout: 10000 });

    // ── Phase 4: A 側で undo 実行 → 旧 id に rollback ──
    await page.getByTestId("rename-entity-undo-btn").click();
    await expect(page).toHaveURL(new RegExp(`/table/edit/${OLD_TABLE_ID}(\\?|$)`), { timeout: 10000 });
  });
});
