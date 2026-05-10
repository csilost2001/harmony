/**
 * 画面フロー (FlowEditor) E2E テスト
 *
 * #933: realWorkspace + 実 backend 経由。
 * 7 test: node D&D 位置永続化 / edge 作成 / edge trigger 編集 /
 *         edge 削除 (右クリック) / node 削除 (Delete key) /
 *         画面間 anchor マーカー (未実装 → skip) / 画面名変更
 *
 * helper は save-reset-flow.spec.ts のパターンを本ファイル内にコピーして使用。
 * 既存ファイルは一切変更しない。
 */

import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject } from "./__fixtures__/builders";

// ── fixtures ────────────────────────────────────────────────────────────────

const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト (flow-editor #933)",
});

// ── selectors ───────────────────────────────────────────────────────────────

const toolbarSave = ".save-reset-buttons button.srb-btn-save";

// ── state ────────────────────────────────────────────────────────────────────

const WS_KEY = "issue-933-flow-editor";
let mcpAvailable = false;
let ws: OpenedWorkspace;

// ── helpers (コピー from save-reset-flow.spec.ts, 本ファイル内に閉じる) ────

async function setupFlowEditor(page: Page): Promise<void> {
  ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  await ws.gotoActive(page, "/screen/flow");
  await expect(page.locator(".flow-root")).toBeVisible();
  // ResumeOrDiscardDialog 遅延表示への retry-loop (#683 edit-session-draft 残骸対応)
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() =>
        (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click()
      );
      await page
        .locator(".edit-mode-modal-backdrop")
        .waitFor({ state: "hidden", timeout: 5000 })
        .catch(() => undefined);
    } else {
      break;
    }
  }
  // edit-mode-start または edit-mode-save のどちらかが表示されるまで待つ
  await Promise.race([
    page.getByTestId("edit-mode-start").waitFor({ state: "visible", timeout: 10000 }),
    page.getByTestId("edit-mode-save").waitFor({ state: "visible", timeout: 10000 }),
  ]).catch(() => undefined);
  // 前回の edit session が残っていて editing mode のまま開いた場合: discard して readonly に戻す
  if (await page.getByTestId("edit-mode-save").isVisible({ timeout: 100 }).catch(() => false)) {
    await page.getByTestId("edit-mode-discard").click();
    if (await page.getByTestId("discard-confirm").isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByTestId("discard-confirm").click();
    }
    await page
      .getByTestId("edit-mode-start")
      .waitFor({ state: "visible", timeout: 8000 })
      .catch(() => undefined);
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

/**
 * ReactFlow handle を drag して edge を作成するヘルパー。
 * puck DnD と同様に waitForTimeout を挟んだ slow drag で確実に動作させる。
 */
async function dragHandleToHandle(
  page: Page,
  sourceLoc: import("@playwright/test").Locator,
  targetLoc: import("@playwright/test").Locator,
): Promise<void> {
  const sBox = await sourceLoc.boundingBox();
  const tBox = await targetLoc.boundingBox();
  if (!sBox || !tBox) throw new Error("handle の boundingBox が取得できません");
  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + sBox.height / 2;
  const tx = tBox.x + tBox.width / 2;
  const ty = tBox.y + tBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.waitForTimeout(50);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const STEPS = 20;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(sx + ((tx - sx) * i) / STEPS, sy + ((ty - sy) * i) / STEPS);
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function addScreenViaModal(
  page: Page,
  name: string,
  options?: { editorKind?: "grapesjs" | "puck"; cssFramework?: "bootstrap" | "tailwind" },
): Promise<void> {
  // 画面 0 件時は「最初の画面を追加」(empty state)、1件以上では「画面を追加」(toolbar)
  const addBtn = page.locator("button.flow-btn-primary").filter({ hasText: /画面を追加/ }).first();
  await addBtn.click();
  await page.locator("#screen-name").fill(name);
  if (options?.editorKind) {
    await page.locator(`input[name="screen-editor-kind"][value="${options.editorKind}"]`).click();
  }
  if (options?.cssFramework) {
    await page.locator(`input[name="screen-css-framework"][value="${options.cssFramework}"]`).click();
  }
  await page.locator('.flow-modal button[type="submit"]').click();
  // node が canvas に出現するまで待機
  await expect(page.locator(".react-flow__node-screenNode").filter({ hasText: name })).toBeVisible({
    timeout: 10000,
  });
  // ReactFlow が handle を内部 nodeLookup に登録するまで 1 frame 待機
  await page.waitForTimeout(300);
}

// ── describe ─────────────────────────────────────────────────────────────────

test.describe("画面フロー — node D&D / edge / marker / 削除動線", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  // ── (A+G) node 配置 D&D → 保存 → reload で position 永続化 ─────────────

  test("(A+G) node 配置 D&D → 保存 → reload で position 永続化", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "ドラッグ検証画面");

    const node = page.locator(".react-flow__node-screenNode").first();
    await expect(node).toBeVisible();
    const before = await node.boundingBox();
    if (!before) throw new Error("node の boundingBox が取得できません");

    // ReactFlow 内蔵のドラッグ (mousedown → move → up)
    // header 部分 (上端から 20px 以内) を狙う
    const cx = before.x + before.width / 2;
    const cy = before.y + 20;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // 10 step かけてゆっくり移動 (ReactFlow の threshold を超えるため)
    await page.mouse.move(cx + 200, cy + 150, { steps: 10 });
    await page.mouse.up();

    // drag 後に位置が変化していることを確認 (±50px の許容差)
    const after = await node.boundingBox();
    if (!after) throw new Error("drag 後の boundingBox が取得できません");
    expect(after.x).toBeGreaterThan(before.x + 50);

    // drag 後 syncAndSave の debounce (300ms) が走って isDirty が立つまで待機
    await expect(page.locator(toolbarSave)).toBeEnabled({ timeout: 5000 });

    // 保存: srb-btn-save を押して disabled に戻るのを待つ
    await page.locator(toolbarSave).click();
    await expect(page.locator(toolbarSave)).toBeDisabled({ timeout: 15000 });

    // drag 後のノード内部 position (ReactFlow style.transform) を記録する
    // fitView が viewport を変換するため、pixel 座標ではなく transform の translate 値を比較
    const getNodeTransform = async () => {
      return page.evaluate(() => {
        const el = document.querySelector(".react-flow__node-screenNode") as HTMLElement | null;
        return el ? el.style.transform : null;
      });
    };
    const transformAfterDrag = await getNodeTransform();

    // reload 後も position が復元されることを確認
    await ws.gotoActive(page, "/screen/flow");
    await expect(page.locator(".flow-root")).toBeVisible();
    await expect(page.locator(".react-flow__node-screenNode")).toBeVisible({ timeout: 10000 });

    const transformAfterReload = await getNodeTransform();
    // transform 文字列が一致すれば position が永続化されている
    // (fitView で viewport zoom は変わっても node の内部 position は変わらない)
    expect(transformAfterReload).toBe(transformAfterDrag);
  });

  // ── (B) handle drag で edge 作成 ─────────────────────────────────────────

  test("(B) handle drag で edge 作成", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "画面A");
    await addScreenViaModal(page, "画面B");

    await expect(page.locator(".react-flow__node-screenNode")).toHaveCount(2, { timeout: 10000 });

    // 初期 edge カウント
    const initialEdgeCount = await page.locator(".react-flow__edge").count();

    // 画面A の bottom handle → 画面B の top handle をドラッグして edge を作成
    const nodeA = page.locator(".react-flow__node-screenNode").filter({ hasText: "画面A" });
    const nodeB = page.locator(".react-flow__node-screenNode").filter({ hasText: "画面B" });

    // ScreenNode: bottom handle = source (data-handleid="bottom"), top handle = target (data-handleid="top")
    // ReactFlow renders handles with data-handleid, not id attribute
    const sourceHandle = nodeA.locator('.react-flow__handle[data-handleid="bottom"]');
    const targetHandle = nodeB.locator('.react-flow__handle[data-handleid="top"]');

    // handle が visible かどうか確認 (connection mode では handles が表示される)
    await expect(sourceHandle).toBeVisible({ timeout: 5000 });
    await expect(targetHandle).toBeVisible({ timeout: 5000 });

    // ReactFlow が nodeLookup に handleBounds を登録するまで十分待機する
    // 登録前は getHandle() が null を返し接続が開始されない
    await page.waitForTimeout(1000);

    // handle drag でエッジを作成 (slow drag ヘルパー使用)
    const sBox = await sourceHandle.boundingBox();
    const tBox = await targetHandle.boundingBox();
    if (!sBox || !tBox) throw new Error("handle の boundingBox が取得できません");
    await dragHandleToHandle(page, sourceHandle, targetHandle);

    // edge が 1 本増えたことを確認
    await expect(page.locator(".react-flow__edge")).toHaveCount(initialEdgeCount + 1, {
      timeout: 5000,
    });

    // 保存 → reload → edge が永続化されている
    await expect(page.locator(toolbarSave)).toBeEnabled({ timeout: 5000 });
    await page.locator(toolbarSave).click();
    await expect(page.locator(toolbarSave)).toBeDisabled({ timeout: 15000 });

    await ws.gotoActive(page, "/screen/flow");
    await expect(page.locator(".flow-root")).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(initialEdgeCount + 1, {
      timeout: 10000,
    });
  });

  // ── (D) edge trigger 編集 — EdgeEditModal ────────────────────────────────

  test("(D) edge trigger 編集 — default → submit", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "遷移元画面");
    await addScreenViaModal(page, "遷移先画面");

    await expect(page.locator(".react-flow__node-screenNode")).toHaveCount(2, { timeout: 10000 });

    // edge を handle drag で作成
    const nodeA = page.locator(".react-flow__node-screenNode").filter({ hasText: "遷移元画面" });
    const nodeB = page.locator(".react-flow__node-screenNode").filter({ hasText: "遷移先画面" });
    await dragHandleToHandle(
      page,
      nodeA.locator('.react-flow__handle[data-handleid="bottom"]'),
      nodeB.locator('.react-flow__handle[data-handleid="top"]'),
    );
    await expect(page.locator(".react-flow__edge")).toHaveCount(1, { timeout: 5000 });

    // edge を double-click して EdgeEditModal を開く
    // ReactFlow の edge は SVG path。双方を覆う中間点付近を狙う
    const edge = page.locator(".react-flow__edge").first();
    await edge.dblclick({ timeout: 5000 });
    await expect(page.locator(".flow-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".flow-modal h3")).toHaveText("遷移の編集");

    // trigger select を "submit" に変更
    await page.locator("#edge-trigger").selectOption("submit");

    // 保存
    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator(".flow-modal")).not.toBeVisible({ timeout: 5000 });

    // edge label が更新されている ("フォーム送信" = TRIGGER_LABELS["submit"])
    // ReactFlow はラベルを SVG text として描画するため、page 全体で検索
    await expect(page.getByText("フォーム送信")).toBeVisible({ timeout: 5000 });
  });

  // ── (E-edge) edge 削除 — 右クリックメニュー ─────────────────────────────

  test("(E-edge) edge 削除 — 右クリックメニュー", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "削除元画面");
    await addScreenViaModal(page, "削除先画面");

    await expect(page.locator(".react-flow__node-screenNode")).toHaveCount(2, { timeout: 10000 });

    // edge を handle drag で作成
    const nodeA = page.locator(".react-flow__node-screenNode").filter({ hasText: "削除元画面" });
    const nodeB = page.locator(".react-flow__node-screenNode").filter({ hasText: "削除先画面" });
    await dragHandleToHandle(
      page,
      nodeA.locator('.react-flow__handle[data-handleid="bottom"]'),
      nodeB.locator('.react-flow__handle[data-handleid="top"]'),
    );
    await expect(page.locator(".react-flow__edge")).toHaveCount(1, { timeout: 5000 });

    // edge を右クリックして context menu を開く
    const edge = page.locator(".react-flow__edge").first();
    await edge.click({ button: "right" });
    await expect(page.locator(".flow-context-menu")).toBeVisible({ timeout: 5000 });

    // 「遷移を削除」をクリック
    await page.locator(".flow-context-menu-item").filter({ hasText: "遷移を削除" }).click();

    // edge が消えることを確認
    await expect(page.locator(".react-flow__edge")).toHaveCount(0, { timeout: 5000 });
  });

  // ── (E-node) node 削除 — Delete key ─────────────────────────────────────

  test("(E-node) node 削除 — Delete key", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "削除検証画面");

    await expect(page.locator(".react-flow__node-screenNode")).toHaveCount(1, { timeout: 10000 });

    // node を click して selected 状態にする
    const node = page.locator(".react-flow__node-screenNode").first();
    await node.click();
    // selected class が付くまで待機
    await expect(node.locator(".screen-node.selected")).toBeVisible({ timeout: 3000 });

    // Delete key で削除ダイアログが出るので accept する
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Delete");

    // node が消えることを確認
    await expect(page.locator(".react-flow__node-screenNode")).toHaveCount(0, { timeout: 5000 });
  });

  // ── (C) 画面間 anchor マーカー追加 → 解決 (#1003 で実装) ────────────────

  test("(C) 画面間 anchor マーカー追加 → 解決", async ({ page }) => {
    await setupFlowEditor(page);

    // 1. 画面を 1 つ作成
    await addScreenViaModal(page, "marker test");

    // 2. FlowSubToolbar の「マーカー」ボタンをクリック → FlowMarkerPanel が開く
    await page.getByTestId("marker-panel-toggle-btn").click();
    await expect(page.getByTestId("flow-marker-panel")).toBeVisible({ timeout: 5000 });

    // 3. 対象画面を select で選び、kind=todo / body 入力 → 「追加」ボタン
    const screenSelect = page.getByTestId("marker-screen-select");
    await expect(screenSelect).toBeVisible({ timeout: 5000 });
    // select には「marker test」が option として入っているはず
    await screenSelect.selectOption({ label: "marker test" });
    await page.getByTestId("marker-kind-select").selectOption("todo");
    await page.getByTestId("marker-body-input").fill("ヘッダー統一して");
    await page.getByTestId("marker-add-btn").click();

    // 4. パネルに未解決 marker (1 件) が表示されることを assert
    await expect(page.getByText("ヘッダー統一して")).toBeVisible({ timeout: 5000 });

    // 4b. screen node に未解決 marker バッジ (数字 1) が表示されることを assert (#1003 Should-fix)
    const screenNode = page.locator(".react-flow__node-screenNode").filter({ hasText: "marker test" });
    const markerBadge = screenNode.getByTestId("screen-node-marker-badge");
    await expect(markerBadge).toBeVisible({ timeout: 5000 });
    await expect(markerBadge).toContainText("1");

    // 5. 「解決」ボタン → 解決メモ入力 → confirm → resolved 状態
    const markerRows = page.locator(".marker-row");
    const firstRow = markerRows.first();
    await expect(firstRow).toBeVisible({ timeout: 5000 });
    const resolveBtn = firstRow.locator(".marker-resolve-btn");
    await resolveBtn.click();
    await page.getByTestId("resolve-note-textarea").fill("対応完了");
    await page.getByTestId("resolve-confirm-btn").click();

    // resolved になると行が非表示になる (showResolved=false のため)
    await expect(page.locator(".marker-row:not(.resolved)")).toHaveCount(0, { timeout: 5000 });

    // 5b. resolve 後はバッジが非表示になる (unresolvedCount=0) (#1003 Should-fix)
    await expect(markerBadge).not.toBeVisible({ timeout: 5000 });

    // 6. 「解決済みも表示」を on にして resolved 件数 1 件を assert
    await page.getByTestId("show-resolved-checkbox").click();
    await expect(page.locator(".marker-row.resolved")).toHaveCount(1, { timeout: 5000 });
  });

  // ── (F) 画面名変更 → screen entity 反映 ─────────────────────────────────

  test("(F) 画面名変更 → screen entity 反映・一覧伝搬", async ({ page }) => {
    await setupFlowEditor(page);
    await addScreenViaModal(page, "元画面名");

    await expect(page.locator(".react-flow__node-screenNode").filter({ hasText: "元画面名" })).toBeVisible();

    // 右クリック → 「プロパティ編集」でスクリーン編集モーダルを開く
    const node = page.locator(".react-flow__node-screenNode").filter({ hasText: "元画面名" });
    await node.click({ button: "right" });
    await expect(page.locator(".flow-context-menu")).toBeVisible({ timeout: 5000 });
    await page.locator(".flow-context-menu-item").filter({ hasText: "プロパティ編集" }).click();

    // ScreenEditModal が開く
    await expect(page.locator(".flow-modal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".flow-modal h3")).toHaveText("画面の編集");

    // 画面名を変更
    await page.locator("#screen-name").clear();
    await page.locator("#screen-name").fill("変更後画面名");
    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator(".flow-modal")).not.toBeVisible({ timeout: 5000 });

    // node header が更新される
    await expect(
      page.locator(".react-flow__node-screenNode").filter({ hasText: "変更後画面名" })
    ).toBeVisible({ timeout: 5000 });

    // 保存
    await expect(page.locator(toolbarSave)).toBeEnabled({ timeout: 5000 });
    await page.locator(toolbarSave).click();
    await expect(page.locator(toolbarSave)).toBeDisabled({ timeout: 15000 });

    // 画面一覧に遷移して名称が反映されていることを確認
    await ws.gotoActive(page, "/screen/list");
    await expect(page.getByText("変更後画面名")).toBeVisible({ timeout: 10000 });
  });
});
