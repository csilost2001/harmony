/**
 * Screen rename smoke (ScreenItemsView 起点) — #1370
 *
 * #1330 acceptance #4 で trace 確立した e2e (本体機能 PR #1369 では scope 外、本 ISSUE
 * #1370 で実装)。
 *
 * 検証:
 *   1. ScreenItemsView header の「ID 変更」ボタンを押下 → RenameEntityDialog 表示
 *   2. 新 id 入力 → 「シミュレーション」 → preview 表示
 *   3. 「実行」 → URL が `/screen/items/<newId>` に遷移 (起動点維持)
 *   4. 一覧 reload (gotoActive) 後も新 id で開けること
 *
 * 既存 frontend/e2e/refactor/rename-entity.spec.ts は Table の representative smoke で
 * preview state machine / atomic rollback / undo の logic 網羅を担当している。本 spec は
 * **起動点 (entry point) 別の navigate 挙動** に絞った smoke。
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const WS_KEY = "issue-1370-screen-items-rename";
const OLD_SCREEN_ID = "cart";
const NEW_SCREEN_ID = "cart-renamed-1370-items";

let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe.configure({ mode: "serial" });

test.describe("Screen rename smoke (ScreenItemsView 起点) — #1370", { tag: ["@regression"] }, () => {
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

  test("ScreenItemsView 起点で rename 後 /screen/items/<newId> に navigate される", async ({ page }) => {
    // 1. ScreenItemsView へ navigate
    await ws.gotoActive(page, `/screen/items/${OLD_SCREEN_ID}`);
    await expect(page.locator(".screen-items-page, .screen-items-content").first()).toBeVisible({ timeout: 10000 });

    // 編集モードに切替 (rename button 自体は readonly でも render されるが、readonly 状態
    // では rename button の onClick が dispatch しても showRenameDialog が反映されない事例を
    // 観測。editing mode で state を安定化させる)。
    //
    // workers=2 並列実行下では `edit-mode-save` の表示が 5s を超える事例を Codex Round 1 で
    // 観測したため 15s 余裕を取る。click 自体は Playwright `editBtn.click()` を使う
    // (evaluate-based だと state 反映の wait が無く後段の rename click が早すぎる事例あり)。
    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    }

    // 2. header の「ID 変更」 button を押下
    //
    // Note: `<div class="editor-header-extra">` が button の親で全幅に広がっており、
    // Chromium の elementFromPoint が button の代わりに親 div を返すため Playwright
    // actionability check が intercept で失敗する (test-strategy skill `esd-root` パターン
    // と同じ)。DOM 上の button 要素に直接 click を dispatch して bypass する。
    const openBtn = page.getByTestId("screen-items-rename-open-btn");
    await expect(openBtn).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => {
      (document.querySelector('[data-testid="screen-items-rename-open-btn"]') as HTMLButtonElement | null)?.click();
    });
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });

    // 3. 新 id 入力 → 「シミュレーション」
    //
    // Note: ScreenItemsView の existingIds / fetchExistingIds は親 render ごとに再生成
    // されるため RenameEntityDialog の `useEffect([fetchExistingIds])` が再 fire し、
    // 結果 EntityIdInput を含む dialog 内容が頻繁に re-render される。Playwright の
    // `fill` は actionability re-check のたびに element detach を観測してリトライし
    // timeout する。setter 経由で直接 value をセット + input イベント発火で bypass する。
    await expect(page.getByTestId("entity-id-input")).toBeVisible({ timeout: 5000 });
    await page.evaluate((val) => {
      const input = document.querySelector('[data-testid="entity-id-input"]') as HTMLInputElement | null;
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, NEW_SCREEN_ID);
    // RenameEntityDialog 内の button click は `page.evaluate` 経由で direct DOM click。
    // 親 `fetchExistingIds` inline arrow による useEffect 再 fire で dialog 内容が頻繁に
    // re-render し、Playwright actionability check が「element detached」を繰り返して
    // timeout する事例を workers=2 並列下で観測。
    const previewBtn = page.getByTestId("rename-entity-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 5000 });
    await page.evaluate(() => {
      (document.querySelector('[data-testid="rename-entity-preview-btn"]') as HTMLButtonElement | null)?.click();
    });
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 5000 });

    // 4. 「実行」 → URL が `/screen/items/<newId>` に遷移 (起動点維持、#1330 の核)
    const execBtn = page.getByTestId("rename-entity-execute-btn");
    await expect(execBtn).toBeEnabled();
    await page.evaluate(() => {
      (document.querySelector('[data-testid="rename-entity-execute-btn"]') as HTMLButtonElement | null)?.click();
    });
    await expect(page).toHaveURL(new RegExp(`/screen/items/${NEW_SCREEN_ID}(\\?|$)`), { timeout: 10000 });

    // 5. reload 後も新 id で開ける (永続化確認)
    await ws.gotoActive(page, `/screen/items/${NEW_SCREEN_ID}`);
    await expect(page.locator(".screen-items-page, .screen-items-content").first()).toBeVisible({ timeout: 10000 });
    // 旧 id へ navigate すると not-found 扱いになることは不検証 (Designer / ScreenItemsView の
    // onNotFound 動作は per-editor 個別 spec のスコープで、本 smoke は entry point の navigate
    // 挙動に絞る)。
  });
});
