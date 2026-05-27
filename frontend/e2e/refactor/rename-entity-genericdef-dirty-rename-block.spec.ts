/**
 * Rename entity → GenericDefinition dirty ref-side edit block browser smoke
 * (#1334 K-3 Part A / I-7 Round 8 D, Round 7 Codex M-R7-4)
 *
 * 目的:
 *   GenericDefinitionEditor が dirty 状態の時、別ソースで entity rename が走ると、
 *   server-side EditSession lock により rename が block され、編集中の GenericDefinition
 *   が stale な参照更新で上書きされないことを browser lifecycle レベルで確認する。
 *
 * 既存の component test
 *   (frontend/src/components/generic-definition/GenericDefinitionEditor.test.tsx)
 * で stale banner の mock broadcast 受信ロジックは検証済み。本 e2e は、実 backend
 * を経由する rename path が dirty 参照側 editor を block することを保証する。
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

const WS_KEY = "issue-1334-k3-genericdef-dirty-rename-block";
const GD_KIND = "data-contract";
const GD_NAME = "OrderForm";
const TARGET_TABLE_ID = "order"; // examples/retail/harmony/tables/order.json
const NEW_TABLE_ID = "order-k3";
const OLD_TABLE_REF = `tables/${TARGET_TABLE_ID}`;
const NEW_TABLE_REF = `tables/${NEW_TABLE_ID}`;
const GD_EDIT_SESSION_RESOURCE_ID = `${GD_KIND}__${GD_NAME}`;

let mcpAvailable = false;
let ws: OpenedWorkspace;

async function hasActiveGenericDefinitionEditorSession(): Promise<boolean> {
  const result = await sendPersistent("editSession.list", {
    resourceType: "generic-definition",
    resourceId: GD_EDIT_SESSION_RESOURCE_ID,
  }) as {
    sessions?: Array<{
      state?: string;
      participants?: Record<string, { role?: string }>;
    }>;
  } | null;
  return (result?.sessions ?? []).some((session) => (
    session.state === "Active"
    && Object.values(session.participants ?? {}).some((participant) => participant.role === "Edit")
  ));
}

test.describe.configure({ mode: "serial" });

test.describe(
  "Rename entity → GenericDefinition dirty ref-side edit block (#1334 K-3 / I-7 Round 8 D)",
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
      const baseDefinition = await sendPersistent("loadGenericDefinition", {
        kind: GD_KIND,
        name: GD_NAME,
      }) as Record<string, unknown>;
      await sendPersistent("saveGenericDefinition", {
        kind: GD_KIND,
        name: GD_NAME,
        data: {
          ...baseDefinition,
          relations: [
            { kind: "uses", ref: OLD_TABLE_REF, description: "rename browser smoke target" },
          ],
        },
      });
    });

    test.afterAll(async () => {
      await closeBrowserSession();
      if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
    });

    test.beforeEach(async () => {
      test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    });

    test("dirty GD editor + 外部 table rename → rename block + dirty 編集保持", async ({ page }) => {
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
      const relationRefField = page.locator(
        'input[placeholder="generic-definitions/data-contract/OrderForm"]',
      ).first();
      await expect(relationRefField).toHaveValue(OLD_TABLE_REF);

      // 3. 外部から Table rename を発火 — 現行契約では参照側 GenericDefinition の
      //    dirty EditSession があるため backend が rename を block する。
      await expect.poll(
        hasActiveGenericDefinitionEditorSession,
        { timeout: 5000, message: "GenericDefinition dirty edit session should be active before rename" },
      ).toBe(true);
      await expect(sendPersistent("renameEntityId", {
        entityType: "table",
        oldId: TARGET_TABLE_ID,
        newId: NEW_TABLE_ID,
      })).rejects.toThrow(/参照側 entity を編集中の他 session/);

      // 4. rename は成立しないため reload banner は出ず、dirty 編集も保持される。
      await expect(page.getByTestId("generic-definition-reload-banner")).toHaveCount(0);
      expect(await purposeField.inputValue()).toBe(`${initialValue}__DIRTY_K3`);
      await expect(relationRefField).toHaveValue(OLD_TABLE_REF);
      const persistedDefinition = await sendPersistent("loadGenericDefinition", {
        kind: GD_KIND,
        name: GD_NAME,
      }) as { relations?: Array<{ ref?: string }> };
      expect(persistedDefinition.relations?.map((rel) => rel.ref)).toContain(OLD_TABLE_REF);
      expect(persistedDefinition.relations?.map((rel) => rel.ref)).not.toContain(NEW_TABLE_REF);

      // cleanup: 後続テストへの影響回避は workspace cleanup (afterAll) で十分。
    });
  },
);
