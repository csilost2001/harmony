/**
 * 成熟度・付箋・モード UI の E2E テスト (#238)
 *
 * カバー範囲:
 * - ステップ成熟度バッジの表示
 * - 成熟度クリックで循環切替 (draft → provisional → committed → draft)
 * - 付箋の追加・削除
 * - グループ成熟度バッジ (ProcessFlowListView)
 * - mode 切替 (upstream/downstream)
 * - ProcessFlowListView の maturity フィルタ
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

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;


const groupId = "ag-maturity-test";

const dummyGroup = {
  id: groupId,
  name: "成熟度テスト用",
  type: "screen",
  description: "E2E テスト用",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-1",
      name: "ボタン A",
      trigger: "click",
      maturity: "draft",
      steps: [
        {
          id: "step-1",
          kind: "validation",
          description: "入力チェック",
          conditions: "必須",
          maturity: "draft",
        },
        {
          id: "step-2",
          kind: "dbAccess",
          description: "ユーザー検索",
          tableName: "users",
          operation: "SELECT",
          maturity: "provisional",
        },
      ],
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const committedGroupId = "ag-maturity-committed";
const provisionalGroupId = "ag-maturity-provisional";

const dummyProject = buildProject({
  name: "maturity-test",
  entities: {
    processFlows: [
      { id: groupId, no: 1, name: dummyGroup.name, kind: dummyGroup.type, actionCount: 1, updatedAt: FIXED_TS, maturity: "draft" },
      { id: committedGroupId, no: 2, name: "確定フロー", kind: "screen", actionCount: 0, maturity: "committed", updatedAt: FIXED_TS },
      { id: provisionalGroupId, no: 3, name: "暫定フロー", kind: "screen", actionCount: 0, maturity: "provisional", updatedAt: FIXED_TS },
    ],
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
// NOTE(#966): top-level `markers` spread は v3 schema 違反だが、product 側の MarkersSummaryPanel.tsx
// が `g.markers` (top-level) を読むため互換目的で維持。MarkersSummaryPanel 修正後 (#966) に
// `authoring.markers` への集約を予定。
const baseGroupBody = buildProcessFlow({
  id: groupId,
  name: dummyGroup.name,
  kind: (dummyGroup.type ?? "screen") as Parameters<typeof buildProcessFlow>[0]["kind"],
  mode: "upstream",
  actions: dummyGroup.actions as ReturnType<typeof buildProcessFlow>["actions"],
});
const dummyGroupBody = dummyGroup.markers !== undefined
  ? { ...baseGroupBody, markers: dummyGroup.markers }
  : baseGroupBody;

const WS_KEY = "issue-926-maturity-notes";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  mcpAvailable = await isMcpRunning();
});

test.afterAll(async () => {
  if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
});

const committedGroupBody = buildProcessFlow({
  id: committedGroupId,
  name: "確定フロー",
  kind: "screen",
  mode: "upstream",
  maturity: "committed",
});
const provisionalGroupBody = buildProcessFlow({
  id: provisionalGroupId,
  name: "暫定フロー",
  kind: "screen",
  mode: "upstream",
  maturity: "provisional",
});

test.beforeEach(async () => {
  test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    processFlows: [
      dummyGroupBody,
      committedGroupBody,
      provisionalGroupBody,
    ],
  });
});
test.describe("成熟度バッジ (#185/#189)", () => {
  test("ステップカードに maturity バッジが表示される", async ({ page }) => {
    await setupEditor(page);
    // アクションタブが開いており、ステップが表示されている
    const firstStepCard = page.locator("[data-testid='data-list-row'], .step-card").first();
    // MaturityBadge は role=button または span (onChange 渡しているので role=button)
    const badges = page.locator(".maturity-badge");
    await expect(badges.first()).toBeVisible();
  });

  test("成熟度バッジクリックで循環切替 (draft → provisional → committed → draft)", async ({ page }) => {
    await setupEditor(page);
    // step-1 (draft) の最初のバッジをクリック
    const firstBadge = page.locator(".step-card .maturity-badge.editable").first();
    await expect(firstBadge).toBeVisible();
    // クリック前: draft の色 (#f59e0b)
    await firstBadge.click();
    // クリック後の title 属性が provisional になっていることを期待
    // title には "(クリックで切替)" が含まれる
    await expect(firstBadge).toHaveAttribute("title", /暫定|provisional/);
    await firstBadge.click();
    await expect(firstBadge).toHaveAttribute("title", /確定|committed/);
    await firstBadge.click();
    await expect(firstBadge).toHaveAttribute("title", /下書き|draft/);
  });
});

test.describe("付箋 (#195/#199)", () => {
  // TODO(#961): dummy data が schema v3 違反 (step.kind 以外も古い前提が
  // 残存) で TabErrorFallback "Cannot read properties of undefined (reading 'label')"
  // 発生。dummy 全体を v3 schema 準拠に書き直す必要あり (#961 で対応、#952 完了後に実施)。
  test.skip("ステップを展開して付箋を追加できる、件数バッジが出る (#961 follow-up: dummy v3 化)", async ({ page }) => {
    await setupEditor(page);
    // 最初のステップカードのヘッダをクリックして展開
    const firstCard = page.locator(".step-card").first();
    const header = firstCard.locator(".step-card-header, .step-card-body").first();
    // step-card の上部 (type-label 付近) をクリックで展開
    await firstCard.locator(".step-card-type-label").first().click();
    // 付箋を追加ボタンが見える
    const addButton = firstCard.locator("button", { hasText: "付箋を追加" }).first();
    await addButton.click();
    // type select + body input が表示
    const bodyInput = firstCard.locator('input[placeholder*="付箋の本文"]').first();
    await expect(bodyInput).toBeVisible();
    await bodyInput.fill("E2E テスト付箋");
    // Enter で追加
    await bodyInput.press("Enter");
    // 付箋リストに "E2E テスト付箋" が現れる
    await expect(firstCard.locator("textarea", { hasText: "E2E テスト付箋" })).toBeVisible();
  });
});

test.describe("モード切替 + 下流警告 (#191/#197)", () => {
  // TODO(#961): 同じく dummy data v3 違反由来の TabErrorFallback。
  test.skip("モードを下流に切り替えると warning が表示される (draft あり) (#961 follow-up)", async ({ page }) => {
    await setupEditor(page);
    // 基本情報 タブを開く (下流ボタンは基本情報 expand 配下)
    await page.locator(".action-meta-tab-bar button, .step-meta-tab").filter({ hasText: /基本情報/ }).first().click().catch(() => undefined);
    // 下流ボタンを押す
    await page.getByRole("button", { name: /下流/ }).click();
    // 警告バナー出現
    await expect(page.getByRole("alert").filter({ hasText: "下流モードで未確定" })).toBeVisible();
  });
});

test.describe("処理フロー一覧のカード成熟度 + フィルタ (#187/#219/#233)", () => {
  // setupList は元 spec で list view 用の setup だったが realWorkspace 移植時に
  // setupEditor 統一しその関数が落ちた。一覧ページ navigate を直接行う。
  async function gotoList(page: Page) {
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 10000 });
  }

  test("カードに maturity バッジが表示される", async ({ page }) => {
    await gotoList(page);
    const cards = page.locator(".data-list-card");
    await expect(cards.first().locator(".maturity-badge")).toBeVisible();
  });

  test("成熟度フィルタで絞り込める (committed のみ)", async ({ page }) => {
    await gotoList(page);
    await page.locator("select").filter({ hasText: /すべて/ }).first().selectOption("committed");
    await expect(page.locator(".data-list-card")).toHaveCount(1);
    await expect(page.locator(".data-list-card").first()).toContainText("確定フロー");
  });

  test("プロジェクト全体サマリが表示される (#233)", async ({ page }) => {
    await gotoList(page);
    // groups load を待つ (groups.length > 0 で初めて 全体: が render される)
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".process-flow-list-header").getByText("全体:")).toBeVisible();
  });
});
