/**
 * カスタムステップカードパレット (#447)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   extensions/steps.json は test workspace 配下の harmony/extensions/ に直接書き出す。
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const groupId = "ag-extension-palette";
const dummyGroupBody = buildProcessFlow({
  id: groupId,
  name: "extension palette",
  kind: "screen",
  mode: "upstream",
  actions: [{ id: "act-1", name: "ボタン", trigger: "click", maturity: "draft", responses: [], steps: [] }] as ReturnType<typeof buildProcessFlow>["actions"],
});
const dummyProject = buildProject({
  name: "extension-palette",
  entities: {
    processFlows: [{ id: groupId, no: 1, name: "extension palette", kind: "screen", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const E2E_FIXTURE = {
  namespace: "e2e",
  steps: {
    "e2e:TestBatch": {
      label: "テストカスタム",
      icon: "bi-gear",
      description: "E2E テスト用フィクスチャ",
      schema: { type: "object", properties: {} },
    },
  },
};

const WS_KEY = "issue-926-extensions-palette";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("カスタムステップカードパレット (#447)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      processFlows: [dummyGroupBody],
    });
    // workspace の extensions/steps.json に fixture を書き込み
    const stepsFile = path.join(ws.workspacePath, "harmony", "extensions", "steps.json");
    await fs.mkdir(path.dirname(stepsFile), { recursive: true });
    await fs.writeFile(stepsFile, JSON.stringify(E2E_FIXTURE, null, 2), "utf-8");
  });

  test("カスタムセクションに表示され、配置ボタンは disabled", async ({ page }) => {
    await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
    await expect(page.locator(".step-editor")).toBeVisible({ timeout: 10000 });

    // edit-mode-start で editing に入ると step-toolbar が出る
    await page.waitForTimeout(500);
    if (await page.locator(".edit-mode-modal-backdrop").isVisible({ timeout: 500 }).catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    }
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();

    // カスタムセクションのラベル (.step-toolbar 内の小見出しを限定; div.small.text-muted)
    await expect(page.locator(".step-toolbar div.small.text-muted").filter({ hasText: /^カスタム$/ })).toBeVisible();
    const card = page.getByRole("button", { name: /テストカスタム/ }).first();
    await expect(card).toBeDisabled();
  });
});
