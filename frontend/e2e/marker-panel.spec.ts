/**
 * MarkerPanel E2E (#261 リアルタイム編集ワークフロー)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
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
import type { HarmonyEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const groupId = "ag-marker";
const dummyGroupBody = buildProcessFlow({
  id: groupId,
  name: "marker test",
  flowType: "screen",
  mode: "upstream",
  actions: [{ id: "act-1", name: "ボタン", trigger: "click", maturity: "draft", steps: [] }] as ReturnType<typeof buildProcessFlow>["actions"],
});
const dummyProject = buildProject({
  name: "marker",
  entities: {
    processFlows: [{ id: groupId, no: 1, name: "marker test", flowType: "screen", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
  } as HarmonyEntities,
});

const WS_KEY = "issue-926-marker-panel";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setup(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
  // #1145 で MarkerPanel は ActionMetaTabBar (edit-only) に移動。readonly では描画されない。
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else { break; }
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
  await page.locator(".marker-panel .catalog-panel-toggle").click();
  await expect(page.locator(".marker-panel .catalog-panel-body")).toBeVisible();
}

test.describe("MarkerPanel (#261)", { tag: ["@regression"] }, () => {
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

  test("パネル既定折りたたみ、展開後に 0 件メッセージ表示", async ({ page }) => {
    await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
    await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
    // #1145 で MarkerPanel は ActionMetaTabBar (edit-only) に移動。readonly では描画されない。
    await page.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
    await expect(page.locator(".marker-panel").first()).toBeVisible();
    await expect(page.locator(".marker-panel .catalog-panel-toggle")).toContainText("0 未解決");
    await page.locator(".marker-panel .catalog-panel-toggle").click();
    await expect(page.locator(".marker-panel .catalog-empty")).toBeVisible();
  });

  test("新規マーカー追加 (質問 kind)", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel select").selectOption("question");
    const input = page.locator(".marker-panel .marker-add-row input");
    await input.fill("この SQL を条件付き UPDATE に書き換えて");
    // React controlled input の onChange → setNewBody が完了するまで wait
    // (button の disabled={!newBody.trim()} が enabled になる)
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    // Playwright の click は button center 座標で hit test を行うが、bootstrap .btn の高さ (24px)
    // + .catalog-row の padding 構造で button center が parent div に hit されるため
    // force: true でも onClick が fire しない (event dispatch 先が parent div になる)。
    // dispatchEvent('click') で button 要素に直接 click event を送り React onClick を起動する。
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(1);
    await expect(page.locator(".marker-panel .marker-row.marker-kind-question")).toBeVisible();
    await expect(page.locator(".marker-panel .marker-kind-badge")).toContainText("質問");
    await expect(page.locator(".marker-panel .marker-body")).toContainText("条件付き UPDATE");
  });

  test("解決ボタンでインライン解決フォームが開く", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-btn").first().dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-resolve-form")).toBeVisible();
    await expect(page.locator(".marker-panel .marker-resolve-form textarea")).toBeFocused();
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(0);
  });

  test("解決フォームでメモを記入して 解決 ボタン押下で resolved に", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-btn").first().dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-form textarea").fill("自分で対応済み");
    await page.locator(".marker-panel .marker-resolve-form button:has-text('解決')").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(0);
    await page.locator(".marker-panel input[type='checkbox']").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(1);
    await expect(page.locator(".marker-panel .marker-resolution")).toContainText("自分で対応済み");
  });

  test("解決フォームで キャンセル 押下でフォームを閉じる (未解決のまま)", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-btn").first().dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-form textarea").fill("中止する");
    await page.locator(".marker-panel .marker-resolve-form button:has-text('キャンセル')").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-resolve-form")).toHaveCount(0);
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(0);
    await page.locator(".marker-panel .marker-resolve-btn").first().dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-resolve-form textarea")).toHaveValue("");
  });

  test("メモ空のまま解決するとデフォルトメモが入る", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-btn").first().dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-form button:has-text('解決')").dispatchEvent("click");
    await page.locator(".marker-panel input[type='checkbox']").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-resolution")).toContainText("人間が手動で解決");
  });

  test("解決済み marker の チェック済アイコン押下で未解決に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("A");
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-btn").first().dispatchEvent("click");
    await page.locator(".marker-panel .marker-resolve-form button:has-text('解決')").dispatchEvent("click");
    await page.locator(".marker-panel input[type='checkbox']").dispatchEvent("click");
    await page.locator(".marker-panel .marker-row.resolved .bi-check-circle-fill").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-row.resolved")).toHaveCount(0);
  });

  test("削除ボタンで marker 消去", async ({ page }) => {
    await setup(page);
    await page.locator(".marker-panel .marker-add-row input").fill("消すよ");
    await expect(page.getByTestId("marker-add-btn")).toBeEnabled();
    await page.getByTestId("marker-add-btn").dispatchEvent("click");
    await page.locator(".marker-panel .marker-row .bi-trash").dispatchEvent("click");
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(0);
    await expect(page.locator(".marker-panel .catalog-panel-toggle")).toContainText("0 未解決");
  });

  test("Enter キーで追加", async ({ page }) => {
    await setup(page);
    const input = page.locator(".marker-panel .marker-add-row input");
    await input.fill("Enter で追加");
    await input.press("Enter");
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(1);
  });
});
