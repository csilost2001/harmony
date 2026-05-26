/**
 * Rename entity → GenericDefinition stale-save banner browser smoke
 * (#1334 K-3 Part A / I-7 Round 8 D, Round 7 Codex M-R7-4)
 *
 * 目的:
 *   GenericDefinitionEditor が dirty 状態の時、別ソースで entity rename が走り
 *   genericDefinitionChanged broadcast (reload: true) が届いた際に、Editor 上
 *   に stale-save banner が表示 + 保存ボタンが disabled になり、reload 後は最新
 *   def が editor に再ロードされることを browser lifecycle レベルで確認する。
 *
 * 既存の component test
 *   (frontend/src/components/generic-definition/GenericDefinitionEditor.test.tsx:52-72)
 * は mock broadcast でロジックを検証済。本 e2e は、実 backend を経由して broadcast
 * payload が wsBridge → mcpBridge → React subscription まで伝わることを保証する
 * (component test では拾えない通信レイヤの regression を検出)。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  type OpenedWorkspace,
} from "../helpers/realWorkspace";
import {
  isMcpRunning,
  sendBrowserRequest as sendPersistent,
  openBrowserSessionWorkspace,
  closeBrowserSession,
} from "../mcp/_helpers";

const WS_KEY = "issue-1334-k3-genericdef-stale-save";
const GD_KIND = "data-contract";
const GD_NAME = "OrderForm";
const TARGET_TABLE_ID = "order"; // examples/retail/harmony/tables/order.json
const NEW_TABLE_ID = "order-k3";

let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe.configure({ mode: "serial" });

test.describe(
  "Rename entity → GenericDefinition stale-save banner (#1334 K-3 / I-7 Round 8 D)",
  { tag: ["@regression"] },
  () => {
    test.beforeAll(async () => {
      mcpAvailable = await isMcpRunning();
      if (!mcpAvailable) return;
      ws = await setupTestWorkspace({
        key: WS_KEY,
        fromExample: "retail",
      });
      // 永続 WS を ws.workspacePath に open しておく
      // (sendPersistent 経由の rename が activePath を持つために必須、#958 と同じパターン)
      await openBrowserSessionWorkspace(ws.workspacePath);
    });

    test.afterAll(async () => {
      await closeBrowserSession();
      if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
    });

    test.beforeEach(async () => {
      test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    });

    test("dirty GD editor + 外部 table rename → banner 表示 + 保存 disabled + reload で復旧", async ({ page }) => {
      // 1. GenericDefinitionEditor を開く
      await ws.gotoActive(page, `/generic-definition/${GD_KIND}/${GD_NAME}`);

      // editor が読み込まれるまで待機 (purpose textarea が登場)。
      // 「名前」input は readOnly なので textarea 1 件目 (= purpose) を狙う。
      const purposeField = page.locator('textarea').first();
      await expect(purposeField).toBeVisible({ timeout: 10000 });

      // 2. dirty 化: purpose を編集する。
      //    GenericDefinitionEditor は state-controlled なので、purpose に 1 文字追加
      //    するだけで initialSnapshotRef !== current となり dirty 判定される。
      const initialValue = await purposeField.inputValue();
      await purposeField.fill(`${initialValue}__DIRTY_K3`);

      // 3. 外部から Table rename を発火 — backend が genericDefinitionChanged を
      //    { reload: true } で broadcast する (refactor.ts:272-284 参照)。
      //    sendPersistent (mcp/_helpers) は workspace.open 済みの永続 WS を使うため、
      //    rename handler が wid 取得に成功し broadcast が page session にも届く。
      await sendPersistent("renameEntityId", {
        entityType: "table",
        oldId: TARGET_TABLE_ID,
        newId: NEW_TABLE_ID,
      });

      // 4. stale-save banner が出る + 保存ボタンが disabled になる
      await expect(page.getByTestId("generic-definition-reload-banner")).toBeVisible({ timeout: 8000 });
      const saveBtn = page.getByRole("button", { name: "保存" });
      await expect(saveBtn).toBeDisabled();

      // 5. 「再読み込み」を押す → banner が消える + 編集内容が破棄されて initial value に戻る
      await page.getByTestId("generic-definition-reload-btn").click();
      await expect(page.getByTestId("generic-definition-reload-banner")).toBeHidden({ timeout: 5000 });
      await expect(saveBtn).toBeEnabled({ timeout: 5000 });
      const reloadedValue = await purposeField.inputValue();
      expect(reloadedValue).toBe(initialValue);

      // cleanup: 後続テストへの影響回避は workspace cleanup (afterAll) で十分。
    });
  },
);
