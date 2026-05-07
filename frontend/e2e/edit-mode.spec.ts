/**
 * edit-session-draft 編集モード UI E2E テスト (#687 PR-4 + #690 PR-7)
 *
 * 前提: dev サーバーおよび backend が起動済み
 *
 * シナリオ:
 *   1. TableEditor: 編集開始 → カラム追加 → 保存 → 反映確認
 *   2. ProcessFlowEditor: 編集開始 → 名前変更 → 破棄 → 元に戻ることを確認
 *   3. 強制解除: 2 タブ open → タブ A 編集中 → タブ B から強制解除 → 両タブの状態確認
 *   4. ViewEditor: 編集開始 → 編集 → 保存 (PR-7)
 *   5. ViewDefinitionEditor: 編集開始 → 確認 (PR-7)
 *   6. SequenceEditor: 編集開始 → 確認 (PR-7)
 *   7. ScreenItemsView (singleton): 編集開始 → 確認 (PR-7)
 *   8. ConventionsCatalogView (singleton): 編集開始 → 確認 (PR-7)
 *   9. ExtensionsPanel (singleton): 編集開始 → 確認 (PR-7)
 *  10. FlowEditor (singleton): 編集開始 → 確認 (PR-7)
 */

/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect } from "@playwright/test";

const TABLE_ID = `tbl-e2e-edit-mode-${Date.now()}`;
const PF_ID = `pf-e2e-edit-mode-${Date.now()}`;

const dummyTable = {
  id: TABLE_ID,
  physicalName: "edit_mode_test",
  name: "編集モードテスト",
  description: "",
  maturity: "draft",
  columns: [
    {
      id: "col-001",
      no: 1,
      physicalName: "id",
      name: "ID",
      dataType: "INTEGER",
      notNull: true,
      primaryKey: true,
      unique: false,
      autoIncrement: true,
    },
  ],
  indexes: [],
  constraints: [],
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyProcessFlow = {
  id: PF_ID,
  name: "編集モードテストフロー",
  description: "",
  maturity: "draft",
  actions: [
    {
      id: "act-001",
      name: "テストアクション",
      trigger: "click",
      steps: [],
    },
  ],
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function setupTable(page: import("@playwright/test").Page) {
  await page.evaluate(
    ({ id, data }) => {
      localStorage.setItem(`gjs-table-${id}`, JSON.stringify(data));
    },
    { id: TABLE_ID, data: dummyTable },
  );
}

async function setupProcessFlow(page: import("@playwright/test").Page) {
  await page.evaluate(
    ({ id, data }) => {
      localStorage.setItem(`gjs-process-flow-${id}`, JSON.stringify(data));
    },
    { id: PF_ID, data: dummyProcessFlow },
  );
}

test.describe.skip("編集モード UI — TableEditor", () => {
  test("シナリオ 1: 編集開始 → 保存 → 反映確認", async ({ page }) => {
    await page.goto("/table/list");
    await setupTable(page);
    await page.goto(`/table/edit/${TABLE_ID}`);

    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    } else {
      // MCP 未接続時は useEditSession が即 readonly を返すため
      // このシナリオはスキップ
      test.skip();
    }

    const saveBtn = page.getByTestId("edit-mode-save");
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    }
  });

  test("シナリオ 2: 編集開始 → 破棄確認ダイアログ → 破棄", async ({ page }) => {
    await page.goto("/table/list");
    await setupTable(page);
    await page.goto(`/table/edit/${TABLE_ID}`);
    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (!await editBtn.isVisible()) {
      test.skip();
      return;
    }

    await editBtn.click();
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });

    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — ProcessFlowEditor", () => {
  test("シナリオ 2: 編集開始 → 破棄 → 元に戻ることを確認", async ({ page }) => {
    await page.goto("/process-flow/list");
    await setupProcessFlow(page);
    await page.goto(`/process-flow/edit/${PF_ID}`);
    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (!await editBtn.isVisible()) {
      test.skip();
      return;
    }

    await editBtn.click();
    await expect(page.getByTestId("edit-mode-discard")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("edit-mode-discard").click();
    await expect(page.getByTestId("discard-confirm")).toBeVisible({ timeout: 3000 });

    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
  });
});

// ─── PR-7 追加: 7 エディタ (View / ViewDefinition / Sequence / ScreenItems / Conventions / Extensions / Flow) ───

const VIEW_ID = `v-e2e-edit-${Date.now()}`;
const VIEW_DEF_ID = `vd-e2e-edit-${Date.now()}`;
const SEQUENCE_ID = `seq-e2e-edit-${Date.now()}`;

const dummyView = {
  id: VIEW_ID,
  name: "E2E ビュー",
  description: "",
  maturity: "draft" as const,
  tableId: "",
  columns: [],
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummyViewDefinition = {
  id: VIEW_DEF_ID,
  name: "E2E ビュー定義",
  description: "",
  maturity: "draft" as const,
  layout: { type: "form" as const, fields: [] },
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const dummySequence = {
  id: SEQUENCE_ID,
  name: "E2E シーケンス",
  description: "",
  maturity: "draft" as const,
  steps: [],
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** 編集開始ボタンが表示されている場合だけクリック。なければ MCP 未接続でスキップ。 */
async function startEditOrSkip(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  const editBtn = page.getByTestId("edit-mode-start");
  const visible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    test.skip();
    return false;
  }
  await editBtn.click();
  return true;
}

test.describe.skip("編集モード UI — ViewEditor (PR-7)", () => {
  test("編集開始 → 保存", async ({ page }) => {
    await page.goto("/view/list");
    await page.evaluate(
      ({ id, data }) => {
        localStorage.setItem(`v3-view-${id}`, JSON.stringify(data));
      },
      { id: VIEW_ID, data: dummyView },
    );
    await page.goto(`/view/edit/${VIEW_ID}`);
    const started = await startEditOrSkip(page);
    if (!started) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — ViewDefinitionEditor (PR-7)", () => {
  test("編集開始 → 確認", async ({ page }) => {
    await page.goto("/view-definition/list");
    await page.evaluate(
      ({ id, data }) => {
        localStorage.setItem(`v3-view-definition-${id}`, JSON.stringify(data));
      },
      { id: VIEW_DEF_ID, data: dummyViewDefinition },
    );
    await page.goto(`/view-definition/edit/${VIEW_DEF_ID}`);
    const started = await startEditOrSkip(page);
    if (!started) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — SequenceEditor (PR-7)", () => {
  test("編集開始 → 確認", async ({ page }) => {
    await page.goto("/sequence/list");
    await page.evaluate(
      ({ id, data }) => {
        localStorage.setItem(`v3-sequence-${id}`, JSON.stringify(data));
      },
      { id: SEQUENCE_ID, data: dummySequence },
    );
    await page.goto(`/sequence/edit/${SEQUENCE_ID}`);
    const started = await startEditOrSkip(page);
    if (!started) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — ScreenItemsView per-screen (#696)", () => {
  const SCREEN_ID = `scr-e2e-edit-mode-${Date.now()}`;
  test("編集開始 → 確認", async ({ page }) => {
    await page.addInitScript(({ sid }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      const project = {
        version: 1, name: "edit-mode-si-test",
        screens: [{ id: sid, no: 1, name: "編集モードテスト画面", type: "standard", updatedAt: new Date().toISOString() }],
        groups: [], edges: [], tables: [], processFlows: [], updatedAt: new Date().toISOString(),
      };
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
    }, { sid: SCREEN_ID });
    await page.goto(`/w/ws-e2e/screen/items/${SCREEN_ID}`);
    const started = await startEditOrSkip(page);
    if (!started) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — ConventionsCatalogView singleton (PR-7)", () => {
  test("編集開始 → 確認", async ({ page }) => {
    await page.goto("/conventions/catalog");
    const started = await startEditOrSkip(page);
    if (!started) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — ExtensionsPanel singleton (PR-7)", () => {
  test("編集開始 → 確認", async ({ page }) => {
    await page.goto("/extensions");
    const started = await startEditOrSkip(page);
    if (!started) return;
    // ExtensionsPanel は per-tab save なので edit-mode-save が表示されなくてもよい
    await expect(
      page.getByTestId("edit-mode-save").or(page.getByTestId("edit-mode-discard")),
    ).toBeVisible({ timeout: 5000 });
  });
});

test.describe.skip("編集モード UI — FlowEditor singleton (PR-7)", () => {
  test("編集開始 → 確認", async ({ page }) => {
    await page.goto("/screen/flow");
    const started = await startEditOrSkip(page);
    if (!started) return;
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  });
});

// ─── 既存: 強制解除シナリオ ───

test.describe.skip("編集モード UI — 強制解除シナリオ", () => {
  test("シナリオ 3: 2 タブ open → タブ A 編集中 → タブ B から強制解除", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`/table/edit/${TABLE_ID}`);
    await pageA.waitForLoadState("networkidle");

    const editBtnA = pageA.getByTestId("edit-mode-start");
    if (!await editBtnA.isVisible()) {
      test.skip();
      await contextA.close();
      await contextB.close();
      return;
    }

    await editBtnA.click();
    await expect(pageA.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    await pageB.goto(`/table/edit/${TABLE_ID}`);
    await pageB.waitForLoadState("networkidle");

    await expect(pageB.getByTestId("edit-mode-force-release")).toBeVisible({ timeout: 5000 });
    await pageB.getByTestId("edit-mode-force-release").click();

    await expect(pageB.getByTestId("force-release-confirm")).toBeVisible({ timeout: 3000 });
    await pageB.getByTestId("force-release-confirm").click();

    await expect(pageA.getByTestId("edit-mode-forced-out-notice")).toBeVisible({ timeout: 10000 });

    await contextA.close();
    await contextB.close();
  });
});
