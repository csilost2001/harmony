import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const groupId = "ag-extension-palette";

const dummyGroup = {
  id: groupId,
  name: "extension palette",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [{ id: "act-1", name: "ボタン", trigger: "click", maturity: "draft", responses: [], steps: [] }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1,
  name: "extension-palette",
  screens: [],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, type: dummyGroup.type, actionCount: 1, updatedAt: dummyGroup.updatedAt, maturity: "draft" }],
  updatedAt: new Date().toISOString(),
};

// E2E テスト用ステップ拡張 fixture (#455)
// __dirname は e2e/ ディレクトリ。../../data が worktree ルート直下の data/
const STEPS_FILE = path.resolve(__dirname, "../../data/extensions/steps.json");
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

async function setup(page: Page) {
  await page.addInitScript(({ project, group }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: dummyGroup });
}

test.describe("カスタムステップカードパレット (#447)", () => {
  // describe スコープの局所変数 — モジュールスコープに漏らさない
  let originalStepsContent: string | null = null;

  test.beforeEach(async () => {
    // 既存ファイルを退避し、テスト用 fixture を注入
    try {
      originalStepsContent = await fs.readFile(STEPS_FILE, "utf-8");
    } catch {
      originalStepsContent = null;
    }
    await fs.mkdir(path.dirname(STEPS_FILE), { recursive: true });
    await fs.writeFile(STEPS_FILE, JSON.stringify(E2E_FIXTURE, null, 2), "utf-8");
  });

  test.afterEach(async () => {
    // テスト後にファイルを元に戻す
    if (originalStepsContent !== null) {
      await fs.writeFile(STEPS_FILE, originalStepsContent, "utf-8");
    } else {
      await fs.writeFile(
        STEPS_FILE,
        JSON.stringify({ namespace: "", steps: {} }, null, 2),
        "utf-8"
      );
    }
  });

  test("カスタムセクションに表示され、配置ボタンは disabled", async ({ page }) => {
    await setup(page);
    await page.goto(`/process-flow/edit/${groupId}`);
    await expect(page.locator(".step-editor")).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("カスタム")).toBeVisible();
    const card = page.getByRole("button", { name: /テストカスタム/ }).first();
    await expect(card).toBeDisabled();
  });
});
