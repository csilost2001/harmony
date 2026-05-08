/**
 * 描画マーカーの DOM アンカリング (#261)
 *
 * anchor 付き marker が対象 step/field の bbox を追従することを検証。
 * MarkerPanel 展開などで step の画面内位置が変わっても、描画の視覚位置が
 * step と一緒に動くこと (ずれないこと) が肝。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";


const groupId = "ag-anchor";

const dummyGroup = {
  id: groupId, name: "anchor test", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [{ id: "201-ok", status: 201 }],
    steps: [
      {
        id: "step-sql-anchor",
        type: "dbAccess",
        description: "在庫更新",
        tableName: "inventory",
        operation: "UPDATE",
        sql: "UPDATE inventory SET qty = qty - 1 WHERE id = @itemId",
        maturity: "draft",
      },
    ],
  }],
  markers: [
    // anchor 付き描画マーカー (step-sql-anchor の sql フィールドに紐付く)
    {
      id: "mk-anchored",
      kind: "todo",
      body: "SQL を条件付き UPDATE に修正",
      stepId: "step-sql-anchor",
      fieldPath: "sql",
      author: "human",
      createdAt: "2026-04-21T00:00:00Z",
      shape: {
        type: "path",
        d: "M 5 20 L 95 20 L 95 80 L 5 80 L 5 20",
        anchorStepId: "step-sql-anchor",
        anchorFieldPath: "sql",
      },
    },
    // anchor なしの旧形式マーカー (overlay 全体に描画される)
    {
      id: "mk-floating",
      kind: "attention",
      body: "前方互換: overlay 相対",
      author: "human",
      createdAt: "2026-04-21T00:00:00Z",
      shape: {
        type: "path",
        d: "M 10 10 L 30 30",
      },
    },
    // orphan: 存在しない stepId にアンカー (オーファン表示テスト用)
    {
      id: "mk-orphan",
      kind: "todo",
      body: "孤児になったマーカー",
      stepId: "step-deleted",
      author: "human",
      createdAt: "2026-04-21T00:00:00Z",
      shape: {
        type: "path",
        d: "M 5 5 L 95 95",
        anchorStepId: "step-deleted",
      },
    },
  ],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

const dummyProject = {
  version: 1, name: "anchor", screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, type: dummyGroup.type, actionCount: 1, updatedAt: dummyGroup.updatedAt, maturity: "draft" }],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
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
const dummyGroupBody: Record<string, unknown> = {
  id: groupId,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: groupId, name: dummyGroup.name, kind: dummyGroup.type ?? dummyGroup.kind ?? "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: dummyGroup.createdAt ?? "2026-05-08T00:00:00.000Z", updatedAt: dummyGroup.updatedAt ?? "2026-05-08T00:00:00.000Z" },
  actions: dummyGroup.actions,
  ...((dummyGroup as Record<string, unknown>).markers !== undefined ? { authoring: { markers: (dummyGroup as Record<string, unknown>).markers } } : {}),
};

const WS_KEY = "issue-926-drawing-anchor";
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
test.describe("描画マーカー DOM anchor (#261)", () => {
  test("anchor 付き marker が対象 step の field bbox に位置合わせされる", async ({ page }) => {
    await setup(page);

    // step を展開して sql フィールドを可視化
    await page.locator('[data-step-id="step-sql-anchor"] .step-card-header').click();
    await expect(page.locator('[data-step-id="step-sql-anchor"] [data-field-path="sql"]')).toBeVisible();

    // 描画マーカーの SVG が sql フィールドの上に fixed positioned される
    const anchored = page.locator('.drawing-anchored-shape[data-marker-id="mk-anchored"]');
    await expect(anchored).toBeVisible();

    const rects = await page.evaluate(() => {
      const a = document.querySelector('.drawing-anchored-shape[data-marker-id="mk-anchored"]');
      const s = document.querySelector('[data-step-id="step-sql-anchor"] [data-field-path="sql"]');
      const ar = a?.getBoundingClientRect();
      const sr = s?.getBoundingClientRect();
      return { a: ar, s: sr };
    });
    // 1px 以内の誤差で一致 (fixed positioning + getBoundingClientRect)
    expect(Math.abs(rects.a!.left - rects.s!.left)).toBeLessThan(1);
    expect(Math.abs(rects.a!.top - rects.s!.top)).toBeLessThan(1);
    expect(Math.abs(rects.a!.width - rects.s!.width)).toBeLessThan(1);
    expect(Math.abs(rects.a!.height - rects.s!.height)).toBeLessThan(1);
  });

  test("MarkerPanel 展開で step が下にずれても anchor 付き marker は追従する", async ({ page }) => {
    await setup(page);
    await page.locator('[data-step-id="step-sql-anchor"] .step-card-header').click();
    await expect(page.locator('[data-step-id="step-sql-anchor"] [data-field-path="sql"]')).toBeVisible();

    // 展開前の top 位置
    const beforeTop = await page.evaluate(() => {
      return document.querySelector('[data-step-id="step-sql-anchor"] [data-field-path="sql"]')!.getBoundingClientRect().top;
    });

    // MarkerPanel を展開 → 上部に複数の marker 行が追加されて step が下にずれる
    await page.locator('.marker-panel .catalog-panel-toggle').click();
    await expect(page.locator('.marker-panel .catalog-panel-body')).toBeVisible();

    // 追従判定: step が動いたことを確認、かつ anchored SVG も同じだけ動いた
    await expect.poll(async () => {
      return page.evaluate(() => {
        const a = document.querySelector('.drawing-anchored-shape[data-marker-id="mk-anchored"]');
        const s = document.querySelector('[data-step-id="step-sql-anchor"] [data-field-path="sql"]');
        if (!a || !s) return { shifted: false, match: false };
        const ar = a.getBoundingClientRect();
        const sr = s.getBoundingClientRect();
        return { shifted: sr.top !== 0, match: Math.abs(ar.top - sr.top) < 1 };
      });
    }, { timeout: 5000 }).toEqual({ shifted: true, match: true });

    const afterTop = await page.evaluate(() => {
      return document.querySelector('[data-step-id="step-sql-anchor"] [data-field-path="sql"]')!.getBoundingClientRect().top;
    });
    expect(afterTop).not.toBe(beforeTop); // 実際にずれていることを確認
  });

  test("anchor なしの旧形式 marker は overlay 内に描画される (前方互換)", async ({ page }) => {
    await setup(page);
    // mk-floating は overlay SVG 内の path として描画される
    const floating = page.locator('.drawing-overlay path.drawing-existing-shape').first();
    await expect(floating).toBeVisible();
  });

  test("anchor 対象 step が存在しない (orphan) marker は画面上に表示されないが MarkerPanel に残る", async ({ page }) => {
    await setup(page);

    // orphan marker は AnchoredMarker として描画されない
    await expect(page.locator('.drawing-anchored-shape[data-marker-id="mk-orphan"]')).toHaveCount(0);

    // MarkerPanel を展開して orphan バッジ確認
    await page.locator('.marker-panel .catalog-panel-toggle').click();
    const orphanRow = page.locator('.marker-panel .marker-row').filter({ hasText: "孤児になったマーカー" });
    await expect(orphanRow).toBeVisible();
    await expect(orphanRow.locator('.marker-orphan-badge')).toBeVisible();
  });
});
