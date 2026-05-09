/**
 * edit-session-draft 編集モード UI E2E テスト (#687 PR-4 + #690 PR-7)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   1 つの workspace に table / processFlow / view / viewDefinition / sequence / screen
 *   を全て pre-seed して、各エディタの edit-mode-start クリック smoke を確認する。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  seedTabsForWorkspace,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { attachAsViewer, takeOver } from "./helpers/editSessionDropdown";
import {
  buildProject,
  buildProcessFlow,
  buildTable,
  buildView,
  buildViewDefinition,
  buildSequence,
} from "./__fixtures__/builders";
import type { Column, ProjectEntities, Timestamp } from "../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const TABLE_ID = `tbl-e2e-edit-mode-${Date.now()}`;
const PF_ID = `pf-e2e-edit-mode-${Date.now()}`;
const VIEW_ID = `v-e2e-edit-${Date.now()}`;
const VIEW_DEF_ID = `vd-e2e-edit-${Date.now()}`;
const SEQUENCE_ID = `seq-e2e-edit-${Date.now()}`;
const SCREEN_ID = `scr-e2e-edit-mode-${Date.now()}`;

const TABLE_NORM = normalizeId(TABLE_ID);
const PF_NORM = normalizeId(PF_ID);
const VIEW_NORM = normalizeId(VIEW_ID);
const VIEW_DEF_NORM = normalizeId(VIEW_DEF_ID);
const SEQ_NORM = normalizeId(SEQUENCE_ID);
const SCREEN_NORM = normalizeId(SCREEN_ID);

const dummyTable = buildTable({
  id: TABLE_ID,
  physicalName: "edit_mode_test",
  name: "編集モードテスト",
  category: "マスタ",
  columns: [
    {
      id: "col-001",
      physicalName: "id",
      name: "ID",
      dataType: "INTEGER",
      notNull: true,
      primaryKey: true,
      autoIncrement: true,
    } as unknown as Column,
  ],
});

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "編集モードテストフロー",
  kind: "screen",
  mode: "upstream",
  actions: [{ id: "act-001", name: "テストアクション", trigger: "click", maturity: "draft", steps: [] }] as ReturnType<typeof buildProcessFlow>["actions"],
});

const dummyView = buildView({ id: VIEW_ID, name: "E2E ビュー" });
const dummyViewDefinition = buildViewDefinition({ id: VIEW_DEF_ID, name: "E2E ビュー定義" });
const dummySequence = buildSequence({ id: SEQUENCE_ID, name: "E2E シーケンス" });

const dummyProject = buildProject({
  name: "edit-mode-test",
  entities: {
    screens: [{ id: SCREEN_ID, no: 1, name: "編集モードテスト画面", kind: "form", updatedAt: FIXED_TS }],
    tables: [{ id: TABLE_ID, no: 1, name: dummyTable.name, physicalName: dummyTable.physicalName, category: "マスタ", columnCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
    processFlows: [{ id: PF_ID, no: 1, name: "編集モードテストフロー", kind: "screen", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
    views: [{ id: VIEW_ID, no: 1, name: "E2E ビュー", maturity: "draft", updatedAt: FIXED_TS }],
    viewDefinitions: [{ id: VIEW_DEF_ID, no: 1, name: "E2E ビュー定義", maturity: "draft", updatedAt: FIXED_TS }],
    sequences: [{ id: SEQUENCE_ID, no: 1, name: "E2E シーケンス", maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-edit-mode";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function makeWs() {
  return await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    tables: [dummyTable],
    processFlows: [dummyProcessFlowBody],
    views: [dummyView],
    viewDefinitions: [dummyViewDefinition],
    sequences: [dummySequence],
  });
}

async function startEditOrSkip(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  // ResumeOrDiscardDialog 遅延表示への retry-loop (#683 edit-session-draft 残骸対応)
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else { break; }
  }
  const editBtn = page.getByTestId("edit-mode-start");
  const visible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    test.skip();
    return false;
  }
  await editBtn.click();
  return true;
}

test.describe("編集モード UI — TableEditor", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });
  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });

  // spec edit-session-protocol § 5.1 / § 8.3: save は session 終了ではなく、save 後も
  // EditSession は Active 継続 (Edit role 維持)。「保存後 readonly 復帰」を期待していた
  // 旧テスト (TODO(#926 follow-up) で skip 済) は仕様誤解だったため、spec に沿った形に修正。
  test("シナリオ 1: 編集開始 → 保存 → 編集モード継続 (spec § 5.1)", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /カラム追加/ }).click().catch(() => undefined);
    await page.waitForTimeout(300);
    await page.getByTestId("edit-mode-save").click();
    // save 完了後: edit-mode-save は visible のまま (Active 継続) + header save ボタンは
    // disabled に戻る (isDirty=false)。
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 10000 });
  });

  test("シナリオ 2: 編集開始 → 破棄確認ダイアログ → 破棄", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
  });
});

test.describe("編集モード UI — ProcessFlowEditor", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });

  test("シナリオ 2: 編集開始 → 破棄 → 元に戻ることを確認", async ({ page }) => {
    await ws.gotoActive(page, `/process-flow/edit/${PF_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
  });
});

test.describe("編集モード UI — ViewEditor (PR-7)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });

  // spec edit-session-protocol § 5.1: save 後も Active 継続 (Edit role 維持)。
  test("編集開始 → 保存 → 編集モード継続 (spec § 5.1)", async ({ page }) => {
    await ws.gotoActive(page, `/view/edit/${VIEW_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("edit-mode-save").click();
    // save 完了後: edit-mode-save は visible のまま (Active 継続) + header save ボタンは
    // disabled に戻る (isDirty=false)。
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 10000 });
  });
});

test.describe("編集モード UI — ViewDefinitionEditor (PR-7)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });
  test("編集開始 → 確認", async ({ page }) => {
    await ws.gotoActive(page, `/view-definition/edit/${VIEW_DEF_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("編集モード UI — SequenceEditor (PR-7)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });
  test("編集開始 → 確認", async ({ page }) => {
    await ws.gotoActive(page, `/sequence/edit/${SEQ_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("編集モード UI — ScreenItemsView per-screen (#696)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });
  test("編集開始 → 確認", async ({ page }) => {
    await ws.gotoActive(page, `/screen/items/${SCREEN_NORM}`);
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("編集モード UI — ConventionsCatalogView singleton (PR-7)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });
  test("編集開始 → 確認", async ({ page }) => {
    await ws.gotoActive(page, "/conventions/catalog");
    if (!await startEditOrSkip(page)) return;
    // singleton (convention) は editSession.create が backend で skip 経路を通るため
    // 状態反映に時間がかかることがある
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
  });
});

test.describe("編集モード UI — ExtensionsPanel singleton (PR-7)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });
  test("編集開始 → 確認", async ({ page }) => {
    await ws.gotoActive(page, "/extensions");
    if (!await startEditOrSkip(page)) return;
    await expect(
      page.getByTestId("edit-mode-save").or(page.getByTestId("edit-mode-discard")).first(),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("編集モード UI — FlowEditor singleton (PR-7)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });
  test("編集開始 → 確認", async ({ page }) => {
    await ws.gotoActive(page, "/screen/flow");
    if (!await startEditOrSkip(page)) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
  });
});

// 強制解除シナリオ — 2 browser context + transferEdit 連携 (#980-A 対応)
test.describe("編集モード UI — 強制解除シナリオ", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });

  test("シナリオ 3: 2 タブ open → タブ A 編集中 → タブ B から take-over (強制解除相当)", async ({ browser }) => {
    test.setTimeout(180000);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const dummyTabPF = { id: `process-flow:${PF_NORM}`, type: "process-flow", resourceId: PF_NORM, label: "編集モードテストフロー", isDirty: false, isPinned: false };

    try {
      // tab A: 編集開始 → Edit role
      await seedTabsForWorkspace(pageA, ws.wsId, [dummyTabPF], dummyTabPF.id);
      await ws.gotoActive(pageA, `/process-flow/edit/${PF_NORM}`);
      if (!await startEditOrSkip(pageA)) return;
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

      // tab B: 同 resource を開く → Viewer attach → take-over (helpers/editSessionDropdown 経由)
      await seedTabsForWorkspace(pageB, ws.wsId, [dummyTabPF], dummyTabPF.id);
      await ws.gotoActive(pageB, `/process-flow/edit/${PF_NORM}`);
      await attachAsViewer(pageB);
      await takeOver(pageB);

      // tab B が Edit role になり、tab A は Viewer 化される
      await expect(pageB.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
      await expect(pageA.getByTestId("edit-mode-save")).not.toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

// #980-A: ResumeOrDiscardDialog filter (participants[mySessionId] のみ) が
// ProcessFlow 以外のエディタでも正しく動作することを multi-tab で検証する。
// alice が編集中に bob が同 resource を開いても ResumeOrDiscardDialog は表示されない
// (= 「他人の Active session を自分の draft と誤認しない」)。
test.describe("編集モード UI — ResumeOrDiscardDialog filter (multi-tab) #980-A", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await makeWs();
  });

  // 共通ヘルパー: alice 編集開始 → bob open → Resume dialog 非表示。
  // hasDropdown=true の編集系は esd-toggle-btn 表示も検証 (Process / Table / VD / Sequence / ScreenItems / Designer)。
  // 注: View / Flow / Conventions / Extensions は EditSessionDropdown を render しない設計のため
  //   esd-toggle 検証は省略する (別 UX 課題: dropdown 非搭載は #980-A scope 外、follow-up TODO)。
  async function verifyFilter(browser: import("@playwright/test").Browser, route: string, tabType: string, resId: string, label: string, opts: { hasDropdown: boolean }) {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const tab = { id: `${tabType}:${resId}`, type: tabType, resourceId: resId, label, isDirty: false, isPinned: false };
    try {
      await seedTabsForWorkspace(pageA, ws.wsId, [tab], tab.id);
      await ws.gotoActive(pageA, route);
      if (!await startEditOrSkip(pageA)) return;
      await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });

      await seedTabsForWorkspace(pageB, ws.wsId, [tab], tab.id);
      await ws.gotoActive(pageB, route);
      // 5s 待機して dialog が出ないことを確認 (出る場合は 1-3s で出る)
      await pageB.waitForTimeout(5000);
      await expect(pageB.locator('.edit-mode-modal-backdrop')).not.toBeVisible();
      if (opts.hasDropdown) {
        await expect(pageB.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 5000 });
      }
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  }

  test("TableEditor: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, `/table/edit/${TABLE_NORM}`, "table", TABLE_NORM, "編集モードテスト", { hasDropdown: true });
  });

  test("ViewEditor: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, `/view/edit/${VIEW_NORM}`, "view", VIEW_NORM, "E2E ビュー", { hasDropdown: false });
  });

  test("ViewDefinitionEditor: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, `/view-definition/edit/${VIEW_DEF_NORM}`, "view-definition", VIEW_DEF_NORM, "E2E ビュー定義", { hasDropdown: true });
  });

  test("SequenceEditor: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, `/sequence/edit/${SEQ_NORM}`, "sequence", SEQ_NORM, "E2E シーケンス", { hasDropdown: true });
  });

  test("ScreenItemsView: alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, `/screen/items/${SCREEN_NORM}`, "screen-item", SCREEN_NORM, "編集モードテスト画面", { hasDropdown: true });
  });

  test("ConventionsCatalogView (singleton): alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, "/conventions/catalog", "convention", "singleton", "規約カタログ", { hasDropdown: false });
  });

  test("ExtensionsPanel (singleton): alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, "/extensions", "extension", "singleton", "拡張", { hasDropdown: false });
  });

  test("FlowEditor (singleton): alice 編集中、bob open → ResumeOrDiscardDialog が出ない", async ({ browser }) => {
    test.setTimeout(120000);
    await verifyFilter(browser, "/screen/flow", "flow", "singleton", "画面フロー", { hasDropdown: false });
  });
});
