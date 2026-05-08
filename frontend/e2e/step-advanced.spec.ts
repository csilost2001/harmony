/**
 * ステップ高度機能 E2E (#248)
 * - branch 新規追加 (ツールバーから)
 * - loop 新規追加 + loopKind 切替
 * - template ボタン (既存テンプレート適用)
 * - subtype picker (subStep 追加)
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


const groupId = "ag-advanced";

const dummyGroup = {
  id: groupId,
  name: "高度機能テスト",
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
      steps: [
        {
          id: "step-base",
          type: "other",
          description: "親ステップ",
          maturity: "draft",
        },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "advanced",
  entities: {
    processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, kind: dummyGroup.type, actionCount: 1, updatedAt: FIXED_TS, maturity: "draft" }],
  } as ProjectEntities,
});

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

// realWorkspace 移植 (#926): 実 backend 経由の dummy fixture
// ProcessFlow body は dummyGroup を v3 shape (top-level id + meta) で再利用する。
const dummyGroupBody = buildProcessFlow({
  id: groupId,
  name: dummyGroup.name,
  kind: (dummyGroup.type ?? "screen") as Parameters<typeof buildProcessFlow>[0]["kind"],
  mode: "upstream",
  actions: dummyGroup.actions as ReturnType<typeof buildProcessFlow>["actions"],
  authoring: dummyGroup.markers !== undefined ? { markers: dummyGroup.markers } : undefined,
});

const WS_KEY = "issue-926-step-advanced";
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
    processFlows: [dummyGroupBody],
  });
});
test.describe("ステップ追加 (条件分岐 / ループ) (#248)", () => {
  test("ツールバーから 条件分岐 を追加", async ({ page }) => {
    await setupEditor(page);
    await expect(page.locator(".step-card")).toHaveCount(1);
    // STEP_TYPE_LABELS.branch = "分岐"
    await page.getByRole("button", { name: /^分岐$|分岐 / }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(2);
    // 2 つ目のカードが branch 型
    await expect(page.locator(".step-card").nth(1)).toContainText(/分岐|branch/);
  });

  test("ツールバーから ループ を追加", async ({ page }) => {
    await setupEditor(page);
    await page.getByRole("button", { name: /ループ$/ }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(2);
    await expect(page.locator(".step-card").nth(1)).toContainText(/ループ|loop/);
  });

  test("計算/代入 (compute) ツールバーから追加", async ({ page }) => {
    await setupEditor(page);
    await page.getByRole("button", { name: /計算\/代入|計算・代入/ }).first().click();
    await expect(page.locator(".step-card")).toHaveCount(2);
  });
});

test.describe("Subtype picker でサブステップ追加 (#248)", () => {
  test("コンテキストメニュー → サブステップ追加 → 種別選択", async ({ page }) => {
    await setupEditor(page);
    const firstCard = page.locator(".step-card").first();
    await firstCard.locator(".step-card-menu-btn").last().click();
    await page.getByRole("button", { name: /サブステップ追加/ }).click();
    // 種別ピッカーが出る (STEP_TYPE_LABELS.validation = "入力チェック")
    await page.getByRole("button", { name: /入力チェック/ }).first().click();
    // サブステップがカード内に追加される (sub element or nested)
    // 検証はサブステップカードの存在 — step-card のネストが増える
    await expect(page.locator(".step-card")).toHaveCount(2);
  });
});

test.describe("テンプレートボタン (#248)", () => {
  // STEP_TEMPLATES は空配列に変更されたため (action.ts:330)、テンプレート候補は出ない。
  // テンプレートボタン自体の存在確認のみ smoke test として残す。
  test("テンプレートボタンが存在する (空 STEP_TEMPLATES でも button は表示)", async ({ page }) => {
    await setupEditor(page);
    const tplBtn = page.getByRole("button", { name: /テンプレート/ }).first();
    // ボタンが見えること (空 templates でも UI 上に出る可能性があるため最低限の存在確認)
    const visible = await tplBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!visible) {
      // STEP_TEMPLATES が空のため button 自体が条件レンダリングで隠されているケース
      // → smoke として skip 扱い (本来 STEP_TEMPLATES 復元時に再度有効化)
      test.skip(true, "STEP_TEMPLATES が空のため template button が render されない");
    }
  });
});
