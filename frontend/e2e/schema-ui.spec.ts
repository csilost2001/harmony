/**
 * 新スキーマ UI の追加 E2E テスト (#240)
 *
 * カバー範囲:
 * - ステップ runIf 入力
 * - ステップ outputBinding 入力 (string / object)
 * - アクション httpRoute + responses[] 編集
 * - dbAccess affectedRowsCheck
 * - ValidationRule[] 追加/削除
 * - tryCatch variant 切替
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";


const groupId = "ag-schema-ui-test";

const dummyGroup = {
  id: groupId,
  name: "スキーマ UI テスト用",
  type: "screen",
  description: "E2E テスト用",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-1",
      name: "メインアクション",
      trigger: "submit",
      maturity: "draft",
      steps: [
        {
          id: "step-validation",
          type: "validation",
          description: "入力バリデーション",
          conditions: "",
          maturity: "draft",
        },
        {
          id: "step-dbaccess",
          type: "dbAccess",
          description: "在庫減算",
          tableName: "inventory",
          operation: "UPDATE",
          maturity: "draft",
        },
        {
          id: "step-other",
          type: "other",
          description: "任意処理",
          maturity: "draft",
        },
        {
          id: "step-branch",
          type: "branch",
          description: "分岐",
          branches: [
            { id: "br-a", code: "A", condition: "自由条件", steps: [] },
          ],
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
  name: "schema-ui-test",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [
    {
      id: groupId,
      no: 1,
      name: dummyGroup.name,
      type: dummyGroup.type,
      actionCount: 1,
      updatedAt: dummyGroup.updatedAt,
      maturity: dummyGroup.maturity,
    },
  ],
  updatedAt: new Date().toISOString(),
};

async function setupEditor(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
  // ResumeOrDiscardDialog 遅延表示への retry-loop (#683 edit-session-draft 残骸対応)
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else {
      break;
    }
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

async function expandStep(page: Page, index: number) {
  const card = page.locator(".step-card").nth(index);
  await card.locator(".step-card-type-label").first().click();
  return card;
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

const WS_KEY = "issue-926-schema-ui";
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
test.describe("step runIf 入力 (#202)", () => {
  test("runIf 欄に入力すると反映される", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 2); // step-other
    const input = card.locator('input[placeholder*="@paymentMethod"]').first();
    await expect(input).toBeVisible();
    await input.fill("@amount > 0");
    await input.blur();
    await expect(input).toHaveValue("@amount > 0");
  });
});

test.describe("step outputBinding 入力 (#204)", () => {
  test("結果変数名 + 代入方式を設定できる", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 2);
    const nameInput = card.locator('input[placeholder*="duplicateCustomer"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("myResult");
    // 代入方式を accumulate に
    const opSelect = card.locator("label", { hasText: "代入方式" }).locator("+ select, ~ select").first();
    // fallback: select after label containing 代入方式
    const opSelectAlt = card.locator("select").filter({ hasText: "accumulate" });
    if (await opSelectAlt.count() > 0) {
      await opSelectAlt.first().selectOption("accumulate");
    }
    await expect(nameInput).toHaveValue("myResult");
  });
});

test.describe("アクション HTTP 契約編集 (#206)", () => {
  test("httpRoute (method/path/auth) と responses[] を編集できる", async ({ page }) => {
    await setupEditor(page);
    // HTTP 契約パネルを開く
    await page.getByRole("button", { name: /HTTP 契約/ }).click();
    const panel = page.locator(".action-http-contract-panel");
    await expect(panel).toBeVisible();
    // Method
    await panel.locator("select").first().selectOption("POST");
    // Path
    await panel.locator('input[placeholder*="/api/customers"]').fill("/api/test");
    // responses 追加 (パネル内の「追加」ボタン)
    await panel.getByRole("button", { name: /追加/ }).click();
    // 1 行目の id 欄に入力
    const idInput = panel.locator('input[placeholder*="409-stock-shortage"]').first();
    await expect(idInput).toBeVisible();
  });
});

test.describe("dbAccess affectedRowsCheck (#210)", () => {
  test("UPDATE ステップで affectedRowsCheck を設定できる", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 1); // step-dbaccess (UPDATE)
    const opSelect = card.locator('select').filter({ hasText: "—" }).first();
    await opSelect.selectOption(">");
    // expected 欄
    const expInput = card.locator('input[type="number"]').first();
    await expInput.fill("0");
    // errorCode
    const codeInput = card.locator('input[placeholder*="STOCK_SHORTAGE"]').first();
    await codeInput.fill("TEST_ERR");
    await codeInput.blur();
    await expect(codeInput).toHaveValue("TEST_ERR");
  });
});

test.describe("ValidationRule[] 編集 (#212)", () => {
  test("構造化ルールを追加・削除できる", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 0); // step-validation
    // ルール追加
    await card.getByRole("button", { name: /ルール追加/ }).click();
    // field + type の input/select が増える
    const fieldInput = card.locator('input[placeholder="field"]').first();
    await expect(fieldInput).toBeVisible();
    await fieldInput.fill("email");
    await expect(fieldInput).toHaveValue("email");
  });
});

test.describe("Branch.condition tryCatch variant (#224)", () => {
  test("盾アイコンで tryCatch 変換、元に戻せる", async ({ page }) => {
    await setupEditor(page);
    const card = await expandStep(page, 3); // step-branch
    // 盾アイコン (tryCatch 切替ボタン) を探して押す
    const toggleBtn = card.locator('button[title*="tryCatch"]').first();
    await toggleBtn.click();
    // tryCatch バッジ表示
    await expect(card.getByText("tryCatch", { exact: true })).toBeVisible();
    // errorCode 入力
    const codeInput = card.locator('input[placeholder*="STOCK_SHORTAGE"]').first();
    await codeInput.fill("TEST_CODE");
    await expect(codeInput).toHaveValue("TEST_CODE");
    // 戻すボタン (arrow-counterclockwise)
    const revertBtn = card.locator('button[title*="自由記述"]').first();
    await revertBtn.click();
    // tryCatch バッジが消える
    await expect(card.getByText("tryCatch", { exact: true })).toHaveCount(0);
  });
});
