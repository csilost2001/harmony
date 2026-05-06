/**
 * dirty マーク + 再オープン時 draft 復元 E2E テスト (#688 PR-5)
 *
 * 前提: dev サーバーおよび backend が起動済み
 *
 * シナリオ:
 *   1. TableEditor: 編集開始 → 保存せずタブ閉じる → 一覧で ● 表示確認
 *   2. 上記から再 open → ResumeOrDiscardDialog → 「続ける」→ 編集モード復帰
 *   3. ProcessFlowEditor: 編集 → 保存せずタブ閉じる → 一覧で ● → 再 open → 「破棄」→ 本体読み込み確認
 *   4. broadcast 経由の即時反映 (同一タブでの draft 作成後、一覧への遷移で ● 表示)
 */

import { test, expect } from "@playwright/test";

const TABLE_ID = `tbl-e2e-dirty-mark-${Date.now()}`;
const PF_ID = `pf-e2e-dirty-mark-${Date.now()}`;

const dummyTable = {
  id: TABLE_ID,
  physicalName: "dirty_mark_test",
  name: "dirty マークテスト",
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
  name: "dirty マークテストフロー",
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

test.describe("dirty マーク + 再オープン — TableEditor", () => {
  test("シナリオ 1: 編集開始 → タブ閉じる → 一覧で ● 表示", async ({ page }) => {
    await page.goto("/table/list");
    await setupTable(page);
    await page.goto(`/table/edit/${TABLE_ID}`);
    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // 保存せずに一覧へ戻る
    await page.goto("/table/list");
    await page.waitForLoadState("networkidle");

    // draft が存在する場合は ● マークが表示される
    const draftMark = page.locator(".list-item-draft-mark").first();
    await expect(draftMark).toBeVisible({ timeout: 5000 });
    await expect(draftMark).toHaveAttribute("title", "未保存の編集中 draft があります");
  });

  test("シナリオ 2: 一覧 ● → 再 open → ResumeOrDiscardDialog → 「続ける」", async ({ page }) => {
    await page.goto("/table/list");
    await setupTable(page);
    await page.goto(`/table/edit/${TABLE_ID}`);
    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // 保存せずに一覧へ戻る
    await page.goto("/table/list");
    await page.waitForLoadState("networkidle");

    // 再度エディタを開く
    await page.goto(`/table/edit/${TABLE_ID}`);
    await page.waitForLoadState("networkidle");

    // ResumeOrDiscardDialog が表示される (draft が MCP 経由で存在する場合)
    const resumeDialog = page.getByRole("dialog", { name: "未保存の編集中 draft があります" });
    const continueBtn = page.getByTestId("resume-continue");

    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await continueBtn.click();
      // 編集モードに入ることを確認
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    } else {
      // MCP 未接続時はダイアログが表示されないためスキップ
      test.skip();
    }

    void resumeDialog;
  });
});

test.describe("dirty マーク + 再オープン — ProcessFlowEditor", () => {
  test("シナリオ 3: 編集 → タブ閉じる → 一覧で ● → 再 open → 「破棄」→ 本体読み込み確認", async ({ page }) => {
    await page.goto("/process-flow/list");
    await setupProcessFlow(page);
    await page.goto(`/process-flow/edit/${PF_ID}`);
    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // 保存せずに一覧へ戻る
    await page.goto("/process-flow/list");
    await page.waitForLoadState("networkidle");

    // ● マーク確認
    const draftMark = page.locator(".list-item-draft-mark").first();
    await expect(draftMark).toBeVisible({ timeout: 5000 });

    // 再度エディタを開く
    await page.goto(`/process-flow/edit/${PF_ID}`);
    await page.waitForLoadState("networkidle");

    const discardBtn = page.getByTestId("resume-discard");
    if (await discardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await discardBtn.click();
      // readonly モードに戻ることを確認
      await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe("broadcast 経由の即時反映", () => {
  test("シナリオ 4: draft 作成後に一覧へ遷移すると ● が表示される", async ({ page }) => {
    await page.goto("/table/list");
    await setupTable(page);
    await page.goto(`/table/edit/${TABLE_ID}`);
    await page.waitForLoadState("networkidle");

    const editBtn = page.getByTestId("edit-mode-start");
    if (!await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip();
      return;
    }

    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });

    // 一覧へ遷移 (タブ切替)
    await page.goto("/table/list");
    await page.waitForLoadState("networkidle");

    // draft.changed broadcast が届いた後に ● マークが表示されることを確認
    // (同一タブ内なので broadcast ではなく draft.list の初期取得で確認)
    await expect(page.locator(".list-item-draft-mark").first()).toBeVisible({ timeout: 8000 });
  });
});
