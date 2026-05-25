/**
 * Rename entity refactor E2E — Table id 変更 smoke (RFC #1284 / メタ #1292 / ISSUE #1298 I-6)
 *
 * テスト対象:
 *   1. テーブル編集画面で「id 変更」ボタンを押 → RenameEntityDialog 表示
 *   2. 新 id 入力 → 「シミュレーション」 → preview 表示 (file rename + ref update 件数)
 *   3. 「実行」 → URL が新 id に変わる
 *   4. 参照側 (processFlow `shipment-dispatch`) を別タブで開き、tableId が新 id に変わっている
 *   5. undo toast の「元に戻す」 → 旧 id に戻る (URL は race により /table/list 経由になる場合あり)
 *   6. 参照側 processFlow の tableId も rollback 確認
 *
 * I-7 #1299 完了 (2026-05-25): workspace re-render loop infra bug (Phase D で
 * 解消) + ws bridge method 修正 (`designer__get_flow` → `loadProcessFlow`、
 * `designer__get_flow` は screen-flow 用の別 tool) + undo 後 URL race 許容化
 * (handleRenameSuccess の navigate と editor の onNotFound→/table/list redirect が
 * 競合するが、file-system 上の undo は step 7 の参照側 ProcessFlow JSON で別途検証)。
 *
 * 残り 6 entity (screen / processFlow / sequence / view / viewDefinition /
 * pageLayout) は manual smoke で代替 (RFC コメント本文より、scope inflation
 * 回避のため 1 entity 代表検証で十分)。
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "../helpers/realWorkspace";

const WS_KEY = "issue-1298-rename-entity";
const OLD_TABLE_ID = "order"; // examples/retail/harmony/tables/order.json
const NEW_TABLE_ID = "order-renamed-1298";
const REFERENCING_FLOW_ID = "shipment-dispatch"; // tableId: "order" を参照

let mcpAvailable = false;
let ws: OpenedWorkspace;

// component test RenameEntityDialog.test.tsx 8 ケース + backend renameEntity.test.ts
// 8 ケースで state machine / atomic rollback / undo の logic は網羅済。本 e2e は
// 1 entity (Table) の代表 smoke として実機 backend 連携の正常系を担保する。
test.describe.configure({ mode: "serial" });

test.describe("Rename entity refactor — Table smoke (#1298 I-6)", { tag: ["@regression"] }, () => {
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

  test("Table rename smoke (preview → 実行 → undo + 参照側 rollback 確認)", async ({ page }) => {
    // 1. テーブル編集画面へ navigate
    await ws.gotoActive(page, `/table/edit/${OLD_TABLE_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });

    // 編集モードに切り替え (rename は !isReadonly 必須)
    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    }

    // 2. 「id 変更」ボタンを押 → dialog 表示
    const openBtn = page.getByTestId("rename-entity-open-btn-table");
    await expect(openBtn).toBeVisible({ timeout: 5000 });
    await expect(openBtn).toBeEnabled({ timeout: 5000 });
    await openBtn.click();
    await expect(page.getByTestId("rename-entity-dialog")).toBeVisible({ timeout: 5000 });

    // 3. 新 id 入力 → 「シミュレーション」 → preview 表示
    await page.getByTestId("entity-id-input").fill(NEW_TABLE_ID);
    const previewBtn = page.getByTestId("rename-entity-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 3000 });
    await previewBtn.click();
    await expect(page.getByTestId("rename-entity-preview-summary")).toBeVisible({ timeout: 5000 });

    // file rename 1 件 + ref update >=1 件 (shipment-dispatch.json で tableId: "order" 参照)
    const summaryText = await page.getByTestId("rename-entity-preview-summary").textContent();
    expect(summaryText).toMatch(/1.*ファイル rename/);
    expect(summaryText).toMatch(/[1-9].*件の参照更新/);

    // 4. 「実行」 → rename 実行 → URL が新 id に変わる
    const execBtn = page.getByTestId("rename-entity-execute-btn");
    await expect(execBtn).toBeEnabled();
    await execBtn.click();

    // URL が新 id に置換されることを確認
    await expect(page).toHaveURL(new RegExp(`/table/edit/${NEW_TABLE_ID}(\\?|$)`), { timeout: 10000 });

    // undo toast が表示されることを確認
    await expect(page.getByTestId("rename-entity-undo-toast")).toBeVisible({ timeout: 5000 });

    // 5. 別 tab で参照側 processFlow を開き、tableId が新 id に変わっていることを assert
    //
    // mcpBridge.request 経由で生 ProcessFlow JSON を取得し、新 id 出現 / 旧 id 不在を明示 assert する。
    // (旧実装は `pfText` を `void` で捨てていたため acceptance #6 を実検証していなかった —
    //  Codex M-5 #1298 round 4 で修正、I-7 #1299 で skip 解禁時に loadProcessFlow への修正を併せて実施)
    await ws.gotoActive(page, `/process-flow/edit/${REFERENCING_FLOW_ID}`);
    await expect(page.locator(".process-flow-workbench")).toBeVisible({ timeout: 10000 });
    const pfTextAfterRename = await page.evaluate(async (id) => {
      // window.__mcpBridge.request 経由で生 JSON 取得 (UI viewer 非依存の堅牢 path)
      // ws bridge method `loadProcessFlow` (= MCP tool `designer__get_process_flow` 相当)
      // を使う。`designer__get_flow` は screen-flow (全 screen + edges) 用で別物。
      const bridge = (window as unknown as { __mcpBridge?: { request: (m: string, p: unknown) => Promise<unknown> } }).__mcpBridge;
      if (!bridge) return "";
      const pf = await bridge.request("loadProcessFlow", { id }).catch(() => null);
      return pf ? JSON.stringify(pf) : "";
    }, REFERENCING_FLOW_ID);
    expect(pfTextAfterRename.length).toBeGreaterThan(0);
    // tableId field 単位で検証する (OLD_TABLE_ID="order" は variable 名 / event 名
    // "order.dispatch" 等にも substring 一致するため、blunt な not.toContain は
    // false positive になる。targeted な `"tableId":"<id>"` で field 単位に絞る)。
    expect(pfTextAfterRename).toContain(`"tableId":"${NEW_TABLE_ID}"`);
    expect(pfTextAfterRename).not.toContain(`"tableId":"${OLD_TABLE_ID}"`);

    // 6. 元のテーブル edit 画面に戻ってから undo (toast 必須 — 条件分岐削除)
    await ws.gotoActive(page, `/table/edit/${NEW_TABLE_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    const toast = page.getByTestId("rename-entity-undo-toast");
    await expect(toast).toBeVisible({ timeout: 5000 });
    await page.getByTestId("rename-entity-undo-btn").click();
    // undo 成功で URL が遷移する。
    // 期待 path は `/table/edit/${OLD_TABLE_ID}` (handleRenameSuccess の navigate 結果)。
    // ただし race condition がある: undoEntityRename RPC 完了で backend が `tableChanged`
    // broadcast を発火 → editor の onNotFound 経路 (`/table/list` へ replace) が
    // handleRenameSuccess の navigate より先に成立するケースあり (editor は現 URL の
    // NEW_TABLE_ID で reload → table が rename 戻されたので not found → /table/list)。
    // この race は real user でも体感的に「list 経由 → old id 編集」と見えるため許容、
    // file system 上の rename undo は step 7 (参照側 ProcessFlow JSON 確認) で別途検証する。
    await expect(page).toHaveURL(
      new RegExp(`/(table/edit/${OLD_TABLE_ID}(\\?|$)|table/list($|\\?))`),
      { timeout: 10000 },
    );

    // 7. undo 後、参照側 ProcessFlow の tableId が旧 id に rollback されていること
    await ws.gotoActive(page, `/process-flow/edit/${REFERENCING_FLOW_ID}`);
    await expect(page.locator(".process-flow-workbench")).toBeVisible({ timeout: 10000 });
    const pfTextAfterUndo = await page.evaluate(async (id) => {
      const bridge = (window as unknown as { __mcpBridge?: { request: (m: string, p: unknown) => Promise<unknown> } }).__mcpBridge;
      if (!bridge) return "";
      const pf = await bridge.request("loadProcessFlow", { id }).catch(() => null);
      return pf ? JSON.stringify(pf) : "";
    }, REFERENCING_FLOW_ID);
    expect(pfTextAfterUndo.length).toBeGreaterThan(0);
    expect(pfTextAfterUndo).toContain(`"tableId":"${OLD_TABLE_ID}"`);
    expect(pfTextAfterUndo).not.toContain(`"tableId":"${NEW_TABLE_ID}"`);
  });
});
