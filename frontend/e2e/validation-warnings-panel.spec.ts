/**
 * 警告詳細パネルの UI 配線テスト (#261 UI 統合)
 *
 * aggregateValidation が新バリデータ (referentialIntegrity / identifierScope)
 * の issue を ValidationError にマップし、ProcessFlowEditor 側で:
 * - 警告バッジが表示される
 * - クリックで詳細パネルが開く
 * - 詳細パネルに code / message / path が表示される
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";


const groupId = "ag-validation-test";

// 意図的に未定義 @ 参照 + 未定義 responseRef を含むグループ
const dummyGroup = {
  id: groupId,
  name: "警告テスト用",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-1",
      name: "ボタン",
      trigger: "click",
      maturity: "draft",
      responses: [{ id: "201-ok", status: 201 }],
      steps: [
        // UNKNOWN_IDENTIFIER 発生: @undefinedVar が inputs/outputBinding/ambient いずれにも無い
        {
          id: "step-compute",
          type: "compute",
          description: "意図的な未定義参照",
          expression: "@undefinedVar * 2",
          outputBinding: "r",
          maturity: "draft",
        },
        // UNKNOWN_RESPONSE_REF: "404-missing" が responses[] に無い
        {
          id: "step-return",
          type: "return",
          description: "未定義 response 参照",
          responseRef: "404-missing",
          maturity: "draft",
        },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "validation-test",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [{
    id: groupId,
    no: 1,
    name: dummyGroup.name,
    type: dummyGroup.type,
    actionCount: 1,
    updatedAt: dummyGroup.updatedAt,
    maturity: "draft",
  }],
  updatedAt: new Date().toISOString(),
};

async function setupEditor(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
  if (await page.locator(".edit-mode-modal-backdrop").isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
    await expect(page.locator(".edit-mode-modal-backdrop")).toBeHidden({ timeout: 5000 });
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

// realWorkspace 移植 (#926): 実 backend 経由の dummy fixture
// ProcessFlow body は dummyGroup を v3 shape (top-level id + meta) で再利用する。
const dummyGroupBody: Record<string, unknown> = {
  id: groupId,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: groupId, name: dummyGroup.name, kind: dummyGroup.type ?? dummyGroup.kind ?? "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: dummyGroup.createdAt ?? "2026-05-08T00:00:00.000Z", updatedAt: dummyGroup.updatedAt ?? "2026-05-08T00:00:00.000Z" },
  actions: dummyGroup.actions,
  ...((dummyGroup as Record<string, unknown>).markers !== undefined ? { markers: (dummyGroup as Record<string, unknown>).markers } : {}),
};

const WS_KEY = "issue-926-validation-warnings-panel";
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
    project: dummyProject,
    processFlows: [dummyGroupBody as unknown as { id: string }],
  });
});
test.describe("警告パネル UI 配線 (#261 UI 統合)", () => {
  test("警告バッジが表示される (UNKNOWN_IDENTIFIER + UNKNOWN_RESPONSE_REF)", async ({ page }) => {
    await setupEditor(page);
    const badge = page.locator(".validation-badge.warning");
    await expect(badge).toBeVisible();
    // 最低 2 件 (identifier + responseRef) の警告が出る
    await expect(badge).toContainText(/2|3|4|5|\d+ 警告/);
  });

  test("バッジクリックで詳細パネルが開く", async ({ page }) => {
    await setupEditor(page);
    const panel = page.locator(".process-flow-validation-panel");
    await expect(panel).toHaveCount(0);

    await page.locator(".validation-badge.warning").click();
    await expect(panel).toBeVisible();
  });

  test("詳細パネルに UNKNOWN_IDENTIFIER / UNKNOWN_RESPONSE_REF code が表示", async ({ page }) => {
    await setupEditor(page);
    await page.locator(".validation-badge.warning").click();

    const panel = page.locator(".process-flow-validation-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("UNKNOWN_IDENTIFIER");
    await expect(panel).toContainText("UNKNOWN_RESPONSE_REF");
  });

  test("詳細パネルに path が表示される", async ({ page }) => {
    await setupEditor(page);
    await page.locator(".validation-badge.warning").click();

    // path の代表的な断片 (actions[0].steps) が含まれる
    await expect(page.locator(".validation-path").first()).toContainText("actions[0]");
  });

  test("閉じるボタンでパネルが閉じる", async ({ page }) => {
    await setupEditor(page);
    await page.locator(".validation-badge.warning").click();
    await expect(page.locator(".process-flow-validation-panel")).toBeVisible();

    // ヘッダには「全て AI に依頼」ボタンもあるため title="閉じる" で指定
    await page.locator('.process-flow-validation-panel-header button[title="閉じる"]').click();
    await expect(page.locator(".process-flow-validation-panel")).toHaveCount(0);
  });
});
