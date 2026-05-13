/**
 * #1081: #1076 AI 依頼 UX の smoke。
 *
 * 実 Codex 応答は環境依存のためここでは叩かない。UI smoke では
 * step / action / flow の context chip 経路と Codex 未接続時の graceful degrade を確認する。
 * AI 応答後の diff preview / 部分採用は AiDiffPreviewDialog.test.tsx で stub 検証する。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const flowId = "pf-ai-ux-smoke";
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const action = {
  id: "act-main",
  name: "登録アクション",
  trigger: "click",
  maturity: "draft",
  steps: [
    {
      id: "step-parent",
      type: "other",
      description: "親ステップ",
      maturity: "draft",
      subSteps: [
        {
          id: "step-child",
          type: "validation",
          description: "サブ入力チェック",
          maturity: "draft",
        },
      ],
    },
    {
      id: "step-db",
      type: "dbAccess",
      description: "登録",
      tableName: "orders",
      operation: "INSERT",
      maturity: "draft",
    },
  ],
};

const project = buildProject({
  name: "process-flow-ai-ux",
  entities: {
    processFlows: [{
      id: flowId,
      no: 1,
      name: "AI UX Smoke",
      kind: "screen",
      actionCount: 1,
      updatedAt: FIXED_TS,
      maturity: "draft",
    }],
  } as ProjectEntities,
});

const processFlow = buildProcessFlow({
  id: flowId,
  name: "AI UX Smoke",
  kind: "screen",
  mode: "upstream",
  actions: [action] as ReturnType<typeof buildProcessFlow>["actions"],
});

const WS_KEY = "issue-1081-process-flow-ai-ux";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  mcpAvailable = await isMcpRunning();
});

test.afterAll(async () => {
  if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
});

test.beforeEach(async () => {
  test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project,
    processFlows: [processFlow],
  });
});

async function openEditor(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(flowId)}`);
  await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);
  if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
    await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
    await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
}

test.describe("ProcessFlow AI 依頼 UX (#1081)", { tag: ["@smoke"] }, () => {
  test("step / action / flow の context chip と未接続時 degrade を確認する", async ({ page }) => {
    await openEditor(page);

    const aiPanel = page.locator(".process-flow-ai-panel");
    await expect(aiPanel).toBeVisible();
    await expect(aiPanel).toContainText("未接続", { timeout: 10000 });

    await page.locator(".step-card").first().locator(".step-card-ai-btn").click();
    await expect(aiPanel.locator(".process-flow-ai-chip").filter({ hasText: "S1: 親ステップ" })).toBeVisible();

    await aiPanel.getByRole("button", { name: "アクション全体" }).click();
    await expect(aiPanel.locator(".process-flow-ai-chip").filter({ hasText: "登録アクション" })).toBeVisible();

    await aiPanel.getByRole("button", { name: "フロー全体" }).click();
    await expect(aiPanel.locator(".process-flow-ai-chip").filter({ hasText: "AI UX Smoke" })).toBeVisible();

    const prompt = aiPanel.getByLabel("AI 依頼内容");
    await prompt.fill("このフローの不足項目を補完してください。");
    await expect(aiPanel.locator(".process-flow-ai-submit")).toBeDisabled();
  });

  test("右クリック導線と rough の sub-step 折りたたみ方針を確認する", async ({ page }) => {
    await openEditor(page);

    const firstCard = page.locator(".step-card").first();
    await firstCard.click({ button: "right" });
    await page.getByRole("button", { name: /このステップを AI に依頼/ }).click();
    await expect(page.locator(".process-flow-ai-panel .process-flow-ai-chip").filter({ hasText: "S1: 親ステップ" })).toBeVisible();

    await expect(page.locator(".step-card:visible")).toHaveCount(3);
    await page.getByRole("button", { name: "ラフ" }).click();
    await expect(page.locator(".step-card:visible")).toHaveCount(2);
    await page.getByRole("button", { name: "詳細" }).click();
    await expect(page.locator(".step-card:visible")).toHaveCount(3);
  });
});
