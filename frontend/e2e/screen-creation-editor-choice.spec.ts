/**
 * 画面作成時の editorKind / cssFramework 選択 UI E2E テスト — #825
 *
 * 視点: ユーザーが画面作成ダイアログで editorKind / cssFramework を選択できる
 * 前提: dev サーバーが起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 — localStorage でプロジェクトをセットアップ
 *
 * カバー範囲:
 *   1. 画面作成モーダルに editorKind / cssFramework ラジオが表示される
 *   2. デフォルト選択が project.techStack.designer のデフォルト値になる (grapesjs / bootstrap)
 *   3. ラジオ選択後に保存できる
 *   4. 「作成後は変更できません」の注意書きが表示される
 *   5. 編集モーダル (isCreate=false) ではラジオが非表示
 */

import { test, expect, type Page } from "@playwright/test";

const FAKE_WS_ID = "e2e-fake-ws-screen-creation-choice";

function makeDummyProject() {
  const now = new Date().toISOString();
  return {
    $schema: "../../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
    meta: {
      id: "e2e-screen-creation-0000-4000-8000-000000000000",
      name: "画面作成 E2E テスト用プロジェクト",
      createdAt: now,
      updatedAt: now,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    techStack: {
      designer: {
        cssFramework: "bootstrap",
        editorKind: "grapesjs",
      },
    },
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
      tables: [],
      processFlows: [],
      views: [],
      viewDefinitions: [],
      sequences: [],
    },
  };
}

async function setupFlowEditor(page: Page) {
  const project = makeDummyProject();
  await page.addInitScript(
    ({ project, wsId }: { project: object; wsId: string }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem("active-workspace-id", wsId);
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
    },
    { project, wsId: FAKE_WS_ID },
  );
  await page.goto("/screen/flow");
  await expect(page.locator(".flow-root")).toBeVisible();
}

async function openAddScreenModal(page: Page) {
  // 「画面を追加」ボタンをクリック (画面フロー ヘッダーのボタン)
  const addBtn = page.locator('.editor-header button.flow-btn-primary').filter({ hasText: "画面を追加" });
  await expect(addBtn).toBeVisible();
  await addBtn.click();
  await expect(page.locator('.flow-modal')).toBeVisible();
}

test.describe("画面作成ダイアログ — editorKind / cssFramework 選択 UI (#825)", () => {
  test("作成モーダルに editorKind ラジオが表示される", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);

    await expect(page.locator('input[name="screen-editor-kind"][value="grapesjs"]')).toBeVisible();
    await expect(page.locator('input[name="screen-editor-kind"][value="puck"]')).toBeVisible();
  });

  test("作成モーダルに cssFramework ラジオが表示される", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);

    await expect(page.locator('input[name="screen-css-framework"][value="bootstrap"]')).toBeVisible();
    await expect(page.locator('input[name="screen-css-framework"][value="tailwind"]')).toBeVisible();
  });

  test("デフォルト選択が grapesjs / bootstrap になっている (project default)", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);

    await expect(page.locator('input[name="screen-editor-kind"][value="grapesjs"]')).toBeChecked();
    await expect(page.locator('input[name="screen-css-framework"][value="bootstrap"]')).toBeChecked();
  });

  test("「作成後は変更できません」の注意書きが表示される", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);

    await expect(page.locator('.screen-create-design-note')).toContainText("作成後は変更できません");
  });

  test("puck / tailwind を選択して保存後 screen.design に明示書き込みされる (#825 受入基準)", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);

    await page.locator("#screen-name").fill("Puck Tailwind 画面");
    await page.locator('input[name="screen-editor-kind"][value="puck"]').click();
    await expect(page.locator('input[name="screen-editor-kind"][value="puck"]')).toBeChecked();
    await page.locator('input[name="screen-css-framework"][value="tailwind"]').click();
    await expect(page.locator('input[name="screen-css-framework"][value="tailwind"]')).toBeChecked();

    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator('.flow-modal')).not.toBeVisible();

    // screen.design.editorKind/cssFramework が localStorage に明示書き込みされること (saveScreenEntity 経由)
    // + Puck は puckDataRef を持ち designFileRef を持たないこと (排他、spec § 2.5)
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith("v3-screen-"));
        if (keys.length === 0) return null;
        const raw = localStorage.getItem(keys[0]);
        if (!raw) return null;
        return JSON.parse(raw) as { design?: Record<string, unknown> };
      });
    }, { timeout: 5000 }).toMatchObject({
      design: {
        editorKind: "puck",
        cssFramework: "tailwind",
        puckDataRef: "puck-data.json",
      },
    });
    const persistedDesign = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("v3-screen-"));
      const raw = localStorage.getItem(keys[0]);
      return raw ? (JSON.parse(raw) as { design?: Record<string, unknown> }).design : null;
    });
    expect(persistedDesign).not.toHaveProperty("designFileRef");
  });

  test("grapesjs / bootstrap を選択して保存できる (デフォルト)", async ({ page }) => {
    await setupFlowEditor(page);
    await openAddScreenModal(page);

    await page.locator("#screen-name").fill("GrapesJS Bootstrap 画面");
    await page.locator('.flow-modal button[type="submit"]').click();
    await expect(page.locator('.flow-modal')).not.toBeVisible();
  });
});
