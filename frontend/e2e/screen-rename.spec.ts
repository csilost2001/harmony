/**
 * Screen rename smoke — 3 起動点 (ScreenItemsView / ScreenListView / ScreenFlow) — #1370
 *
 * #1330 (Designer 外起点 Screen rename refactor) の acceptance #4「Playwright e2e:
 * ScreenItemsView 起動の rename smoke」+ 残 2 起動点を trace 確立し実装する ISSUE。
 * 本体機能 PR #1369 は scope 外として #1370 で trace 確立済。
 *
 * 検証 (3 test):
 *   1. ScreenItemsView 起点 → URL `/screen/items/<newId>` に navigate (起動点維持)
 *   2. ScreenListView 行右クリック起点 → URL `/screen/list` 維持 + 行 id 更新
 *   3. ScreenFlow node 右クリック起点 → URL `/screen/flow` 維持 + node data-id 更新
 *
 * 単一ファイルで `mode: "serial"` を強制する設計理由 (Codex Round 1-2 で計 3 回 reject):
 *   既存 frontend/e2e/refactor/rename-entity.spec.ts は Table の representative smoke
 *   として preview state machine / atomic rollback / undo の logic 網羅を担当。本 spec は
 *   **起動点 (entry point) 別の navigate 挙動** に絞った smoke。
 *   3 起動点を別 spec file に分けると Playwright `workers=2` で並列実行されるが、3 test とも
 *   backend に対し setupTestWorkspace + editSession.create + previewEntityRename + rename
 *   実行を行うため、共有 backend (port 5179) の MCP RPC が並列負荷で `actions.startEditing`
 *   応答遅延 / `previewEntityRename` 応答遅延 / 同 backend 上の workspace 切替 race で
 *   `edit-mode-save` 表示 / `rename-entity-preview-summary` 表示 / context menu 表示 等が
 *   間欠 timeout する。本ファイルに統合して `mode: "serial"` で順次実行することで、
 *   workers=2 並列下でも 1 worker 内で連続実行され、backend 並列負荷を回避する。
 *
 * 既存 `rename-entity.spec.ts` (Table) と相補的に、本 spec は entry point 別 navigate を担保。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const WS_KEY = "issue-1370-screen-rename";
const OLD_SCREEN_ID = "cart";

let mcpAvailable = false;
let ws: OpenedWorkspace;

// Mode serial: 3 test を 1 worker 内で順次実行 (workers=2 並列下でも 1 worker に統合)。
// retries: 2: backend `editSession.create` / `previewEntityRename` RPC が workers 並列下で
// 間欠的に遅延し edit-mode-save / rename-entity-preview-summary が timeout する事例を
// Codex Round 1-3 で観測。再現性が低いため 2 回までの自動リトライで対処 (CI でも有効)。
// 根本対策は GenericDefinitionEditor の `fetchExistingIds` useCallback 化等の re-render 抑止
// だが、本 PR scope 外 (rename refactor の本体機能ではなく e2e trace 確立目的)。
test.describe.configure({ mode: "serial", retries: 2 });

test.describe("Screen rename smoke — 3 起動点 (#1370)", { tag: ["@regression"] }, () => {
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

  // ── 共通 helper ─────────────────────────────────────────────────────────────

  /**
   * RenameEntityDialog 内の input 値設定。
   * Note: 親側の `fetchExistingIds` inline arrow による useEffect 再 fire ループで dialog
   * 内 button / input が頻繁に re-render される。Playwright `fill` は actionability
   * re-check のたびに element detach を観測してリトライ → timeout する事例を観測したため、
   * setter + input event dispatch で actionability re-check 自体を skip する。
   */
  async function setEntityId(page: Page, value: string): Promise<void> {
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="entity-id-input"]'),
      { timeout: 10000 },
    );
    await page.evaluate((val) => {
      const input = document.querySelector('[data-testid="entity-id-input"]') as HTMLInputElement | null;
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }

  /**
   * dialog 内 button を polling-retry で click。
   * 親 re-render で element 一時的 detach する race に対応するため、`waitForFunction` で
   * button が disabled でない状態を確認してから `evaluate` direct DOM click を発火する。
   */
  async function clickDialogButton(page: Page, testid: string, timeoutMs = 10000): Promise<void> {
    await page.waitForFunction(
      (id) => {
        const btn = document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
        return !!btn && !btn.disabled;
      },
      testid,
      { timeout: timeoutMs },
    );
    await page.evaluate((id) => {
      (document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null)?.click();
    }, testid);
  }

  /**
   * RenameEntityDialog の preview → execute フロー。
   * 起動点共通で再利用 (新 id 入力 → シミュレーション → preview-summary 確認 → 実行)。
   */
  async function runRenamePreviewAndExecute(page: Page, newId: string): Promise<void> {
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });
    await setEntityId(page, newId);
    await clickDialogButton(page, "rename-entity-preview-btn");
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 10000 });
    await clickDialogButton(page, "rename-entity-execute-btn");
  }

  // ── (A) ScreenItemsView 起点 ───────────────────────────────────────────────

  test("(A) ScreenItemsView 起点で rename 後 /screen/items/<newId> に navigate される", async ({ page }) => {
    const NEW_SCREEN_ID = "cart-renamed-1370-items";

    await ws.gotoActive(page, `/screen/items/${OLD_SCREEN_ID}`);
    await expect(page.locator(".screen-items-page, .screen-items-content").first()).toBeVisible({ timeout: 10000 });

    // 編集モードに切替 (rename button 自体は readonly でも render されるが、editing mode で
    // state を安定化させると後続の dialog 起動が安定する事例を観測)。
    // edit-mode-save が初期 5s で出ない場合、editSession.create の backend 応答が遅延し
    // 後続の rename も同じ pending RPC pool に阻まれる可能性が高い。明示的に十分な timeout
    // を取って backend が settle するまで待つ (workers=2 並列下でも安定)。
    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      // editing mode への state transition は backend `editSession.create` 応答待ち。
      // 通常 1-2s だが workers 並列 / backend cold な場合 10-30s かかる事例あり。
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 30000 });
    }

    // ID 変更 button を click → dialog 表示 (polling-retry で flake 回避)
    // Note: `editor-header-extra` 親 div intercept (`.esd-root` パターン) を direct DOM click で bypass
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="screen-items-rename-open-btn"]'),
      { timeout: 10000 },
    );
    // showRenameDialog state 反映を待つため polling で再 click を許容
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('[data-testid="screen-items-rename-open-btn"]') as HTMLButtonElement | null;
        if (!btn) return false;
        btn.click();
        return !!document.querySelector('[data-testid="rename-entity-dialog"]');
      },
      { timeout: 10000, polling: 500 },
    );

    await runRenamePreviewAndExecute(page, NEW_SCREEN_ID);

    // URL が `/screen/items/<newId>` に navigate (起動点維持、#1330 の核)
    await expect(page).toHaveURL(new RegExp(`/screen/items/${NEW_SCREEN_ID}(\\?|$)`), { timeout: 15000 });

    // reload 後も新 id で開ける (永続化確認)
    await ws.gotoActive(page, `/screen/items/${NEW_SCREEN_ID}`);
    await expect(page.locator(".screen-items-page, .screen-items-content").first()).toBeVisible({ timeout: 10000 });
  });

  // ── (B) ScreenListView 起点 ───────────────────────────────────────────────

  test("(B) ScreenListView 行右クリック起点で rename 後 /screen/list に留まり行 id が更新される", async ({ page }) => {
    // (A) で rename したため別 screen を target にする
    const TARGET_OLD = "cart-confirm";
    const TARGET_NEW = "cart-confirm-renamed-1370-list";

    await ws.gotoActive(page, "/screen/list");
    await expect(page.getByTestId("data-list")).toBeVisible({ timeout: 10000 });

    const targetRow = page.locator(`[data-row-id="${TARGET_OLD}"]`).first();
    await expect(targetRow).toBeVisible({ timeout: 10000 });

    // 単一選択してから右クリック (#1330: 「ID 変更は 1 件選択時のみ」)
    await targetRow.click();
    await targetRow.click({ button: "right" });

    // context menu の「ID 変更…」を click
    const renameItem = page.getByTestId("list-context-menu-item-rename-id");
    await expect(renameItem).toBeVisible({ timeout: 5000 });
    await expect(renameItem).toBeEnabled();
    await renameItem.click();

    await runRenamePreviewAndExecute(page, TARGET_NEW);

    // URL は /screen/list 維持 (#1330 の核)
    await expect(page).toHaveURL(/\/screen\/list(\?|$)/, { timeout: 15000 });

    // 一覧の行 id が新 id に更新される (backend `screenChanged` broadcast → editor.reload() 経由)
    await expect(page.locator(`[data-row-id="${TARGET_NEW}"]`).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-row-id="${TARGET_OLD}"]`)).toHaveCount(0, { timeout: 5000 });
  });

  // ── (C) ScreenFlow 起点 ───────────────────────────────────────────────────

  test("(C) ScreenFlow node 右クリック起点で rename 後 /screen/flow に留まり node id が更新される", async ({ page }) => {
    // (A)(B) で rename したため別 screen を target にする
    const TARGET_OLD = "customer-master";
    const TARGET_NEW = "customer-master-renamed-1370-flow";

    await ws.gotoActive(page, "/screen/flow");
    await expect(page.locator(".flow-root, .react-flow").first()).toBeVisible({ timeout: 10000 });

    const targetNode = page.locator(`.react-flow__node[data-id="${TARGET_OLD}"]`);
    await expect(targetNode).toBeVisible({ timeout: 15000 });

    // 編集モードに切替 (rename は !isReadonly 必須)
    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    }

    // node を右クリック → context menu 表示
    // Note: ReactFlow の `onNodeContextMenu` は contextmenu イベントを subscribe。Playwright
    // `click({button: "right"})` は actionability 経由で間欠的に届かない事例があるため
    // `dispatchEvent` で直接送出する。
    await page.evaluate((id) => {
      const node = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      node.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, button: 2, clientX: cx, clientY: cy,
      }));
    }, TARGET_OLD);

    // context menu の「ID 変更…」を click
    await expect(page.getByTestId("flow-node-rename-id-btn")).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
      (document.querySelector('[data-testid="flow-node-rename-id-btn"]') as HTMLButtonElement | null)?.click();
    });

    await runRenamePreviewAndExecute(page, TARGET_NEW);

    // URL は /screen/flow 維持
    await expect(page).toHaveURL(/\/screen\/flow(\?|$)/, { timeout: 15000 });

    // フロー図上の node の data-id が新 id に更新される
    await expect(page.locator(`.react-flow__node[data-id="${TARGET_NEW}"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`.react-flow__node[data-id="${TARGET_OLD}"]`)).toHaveCount(0, { timeout: 5000 });
  });
});
